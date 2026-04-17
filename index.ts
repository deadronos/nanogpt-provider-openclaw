import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { readConfiguredProviderCatalogEntries } from "openclaw/plugin-sdk/provider-catalog-shared";
import { buildNanoGptImageGenerationProvider } from "./image-generation-provider.js";
import { applyNanoGptProviderConfig } from "./onboard.js";
import { NANOGPT_DEFAULT_MODEL_REF, NANOGPT_PROVIDER_ID } from "./models.js";
import { buildNanoGptProvider, readNanoGptModelsJsonSnapshot } from "./provider-catalog.js";
import {
  fetchNanoGptUsageSnapshot,
  getNanoGptConfig,
  resolveNanoGptDynamicModel,
  resolveNanoGptUsageAuth,
} from "./runtime.js";
import {
  resolveNanoGptRepairProfile,
  wrapStreamWithMalformedToolCallGuard,
  wrapStreamWithToolCallRepair,
} from "./repair.js";
import { createNanoGptWebSearchProvider } from "./web-search.js";
import type {
  AnyAgentTool,
  ProviderCatalogContext,
  ProviderResolveDynamicModelContext,
  ProviderNormalizeToolSchemasContext,
  ProviderRuntimeModel,
} from "openclaw/plugin-sdk/plugin-entry";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";

type NanoGptCatalogEntry = {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image" | "document">;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeNanoGptCatalogEntries(...groups: NanoGptCatalogEntry[][]): NanoGptCatalogEntry[] {
  const seen = new Set<string>();
  const merged: NanoGptCatalogEntry[] = [];

  for (const group of groups) {
    for (const entry of group) {
      const key = `${entry.provider}::${entry.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(entry);
    }
  }

  return merged;
}

function readNanoGptAugmentedCatalogEntries(params: {
  agentDir?: string;
  config?: unknown;
  env?: Record<string, string | undefined>;
}): NanoGptCatalogEntry[] {
  return mergeNanoGptCatalogEntries(
    readNanoGptModelsJsonSnapshot(params.agentDir, params.env).catalogEntries,
    readConfiguredProviderCatalogEntries({
      config: params.config as import("openclaw/plugin-sdk/provider-onboard").OpenClawConfig | undefined,
      providerId: NANOGPT_PROVIDER_ID,
    }),
  );
}

function normalizeNanoGptResolvedModel(
  ctx: { agentDir?: string; model: ProviderRuntimeModel },
): ProviderRuntimeModel | undefined {
  const definition = readNanoGptModelsJsonSnapshot(ctx.agentDir).modelDefinitions.get(ctx.model.id);
  if (!definition) {
    return undefined;
  }

  const nextModel: ProviderRuntimeModel = {
    ...ctx.model,
    name: definition.name,
    reasoning: definition.reasoning,
    input: [...definition.input],
    cost: { ...definition.cost },
    contextWindow: definition.contextWindow,
    maxTokens: definition.maxTokens,
    ...(definition.contextTokens ? { contextTokens: definition.contextTokens } : {}),
    ...(definition.compat
      ? {
          compat: {
            ...ctx.model.compat,
            ...definition.compat,
          },
        }
      : {}),
    ...(definition.api ? { api: definition.api } : {}),
  };

  const changed =
    nextModel.name !== ctx.model.name ||
    nextModel.reasoning !== ctx.model.reasoning ||
    nextModel.contextWindow !== ctx.model.contextWindow ||
    nextModel.maxTokens !== ctx.model.maxTokens ||
    nextModel.contextTokens !== ctx.model.contextTokens ||
    JSON.stringify(nextModel.input) !== JSON.stringify(ctx.model.input) ||
    JSON.stringify(nextModel.cost) !== JSON.stringify(ctx.model.cost) ||
    JSON.stringify(nextModel.compat ?? null) !== JSON.stringify(ctx.model.compat ?? null) ||
    nextModel.api !== ctx.model.api;

  return changed ? nextModel : undefined;
}

function resolveNanoGptDynamicModelWithSnapshot(
  ctx: ProviderResolveDynamicModelContext & { env?: Record<string, string | undefined> },
): ProviderRuntimeModel | undefined {
  const snapshotModels = [...readNanoGptModelsJsonSnapshot(ctx.agentDir, ctx.env).modelDefinitions.values()];

  return resolveNanoGptDynamicModel({
    ...ctx,
    providerConfig:
      ctx.providerConfig || snapshotModels.length > 0
        ? {
            ...ctx.providerConfig,
            models:
              Array.isArray(ctx.providerConfig?.models) && ctx.providerConfig.models.length > 0
                ? ctx.providerConfig.models
                : snapshotModels,
          }
        : ctx.providerConfig,
  });
}

function applyNanoGptNativeStreamingUsageCompat(
  providerConfig: ModelProviderConfig,
): ModelProviderConfig | null {
  if (providerConfig.api !== "openai-completions") {
    return null;
  }
  if (!Array.isArray(providerConfig.models) || providerConfig.models.length === 0) {
    return null;
  }

  let changed = false;
  const models = providerConfig.models.map((model) => {
    if (model.compat?.supportsUsageInStreaming === true) {
      return model;
    }
    changed = true;
    return {
      ...model,
      compat: {
        ...model.compat,
        supportsUsageInStreaming: true,
      },
    };
  });

  return changed ? { ...providerConfig, models } : null;
}

function resolveNanoGptToolSchemaModelId(ctx: ProviderNormalizeToolSchemasContext): string {
  if (typeof ctx.model?.id === "string" && ctx.model.id.trim()) {
    return ctx.model.id;
  }
  return typeof ctx.modelId === "string" ? ctx.modelId : "";
}

const NANOGPT_GLM_TOOL_SCHEMA_HINT_MARKER = "NanoGPT GLM tip:";
const NANOGPT_GLM_TOOL_SCHEMA_HINT =
  "NanoGPT GLM tip: include required ref/selector/fields arguments explicitly when the tool needs them.";

function shouldAnnotateNanoGptGlmToolSchema(tool: AnyAgentTool): boolean {
  const parameters = isRecord(tool.parameters) ? tool.parameters : undefined;
  if (!parameters) {
    return /web[_-]?fetch|fetch[_-]?web|browser|page|extract|search/i.test(tool.name);
  }

  const required = Array.isArray(parameters.required)
    ? parameters.required.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const properties = isRecord(parameters.properties) ? Object.keys(parameters.properties) : [];
  const fields = new Set([...required, ...properties]);
  if ([...fields].some((field) => ["ref", "selector", "fields", "inputRef", "element"].includes(field))) {
    return true;
  }

  if (required.length > 0) {
    return true;
  }

  return /web[_-]?fetch|fetch[_-]?web|browser|page|extract|search/i.test(tool.name);
}

function appendNanoGptGlmToolSchemaHint(description: string | undefined): string {
  if (typeof description === "string" && description.includes(NANOGPT_GLM_TOOL_SCHEMA_HINT_MARKER)) {
    return description;
  }

  if (typeof description === "string" && description.trim().length > 0) {
    return `${description} ${NANOGPT_GLM_TOOL_SCHEMA_HINT}`;
  }

  return NANOGPT_GLM_TOOL_SCHEMA_HINT;
}

function normalizeNanoGptToolSchemas(
  ctx: ProviderNormalizeToolSchemasContext,
): AnyAgentTool[] | null {
  const repairProfile = resolveNanoGptRepairProfile(resolveNanoGptToolSchemaModelId(ctx));
  if (!repairProfile.useToolSchemaHints) {
    return null;
  }

  let changed = false;
  const tools = ctx.tools.map((tool) => {
    if (!shouldAnnotateNanoGptGlmToolSchema(tool)) {
      return tool;
    }
    const nextDescription = appendNanoGptGlmToolSchemaHint(tool.description);
    if (nextDescription === tool.description) {
      return tool;
    }
    changed = true;
    return {
      ...tool,
      description: nextDescription,
    } as AnyAgentTool;
  });

  return changed ? tools : null;
}

export default definePluginEntry({
  id: NANOGPT_PROVIDER_ID,
  name: "NanoGPT Provider",
  description: "NanoGPT provider plugin for OpenClaw",
  register(api) {
    const pluginConfig = api.pluginConfig;

    api.registerProvider({
      id: NANOGPT_PROVIDER_ID,
      label: "NanoGPT",
      docsPath: "/providers/models",
      envVars: ["NANOGPT_API_KEY"],
      auth: [
        createProviderApiKeyAuthMethod({
          providerId: NANOGPT_PROVIDER_ID,
          methodId: "api-key",
          label: "NanoGPT API key",
          hint: "Subscription or pay-as-you-go",
          optionKey: "nanogptApiKey",
          flagName: "--nanogpt-api-key",
          envVar: "NANOGPT_API_KEY",
          promptMessage: "Enter NanoGPT API key",
          expectedProviders: [NANOGPT_PROVIDER_ID],
          applyConfig: (cfg) => applyNanoGptProviderConfig(cfg),
          wizard: {
            choiceId: "nanogpt-api-key",
            choiceLabel: "NanoGPT API key",
            groupId: "nanogpt",
            groupLabel: "NanoGPT",
            groupHint: "Subscription or pay-as-you-go",
          },
        }),
      ],
      catalog: {
        order: "simple",
        run: async (ctx: ProviderCatalogContext) => {
          const apiKey = ctx.resolveProviderApiKey(NANOGPT_PROVIDER_ID).apiKey;
          if (!apiKey) {
            return null;
          }

          return {
            provider: await buildNanoGptProvider({
              apiKey,
              pluginConfig,
            }),
          };
        },
      },
      augmentModelCatalog: (ctx) =>
        readNanoGptAugmentedCatalogEntries({
          agentDir: ctx.agentDir,
          config: ctx.config,
          env: ctx.env,
        }),
      normalizeResolvedModel: (ctx) =>
        normalizeNanoGptResolvedModel({
          agentDir: ctx.agentDir,
          model: ctx.model,
        }),
      normalizeToolSchemas: (ctx) => normalizeNanoGptToolSchemas(ctx),
      resolveDynamicModel: (ctx) => resolveNanoGptDynamicModelWithSnapshot(ctx),
      applyNativeStreamingUsageCompat: ({ providerConfig }) =>
        applyNanoGptNativeStreamingUsageCompat(providerConfig),
      resolveUsageAuth: async (ctx) => await resolveNanoGptUsageAuth(ctx),
      fetchUsageSnapshot: async (ctx) => await fetchNanoGptUsageSnapshot(ctx),
      wrapStreamFn: (ctx) => {
        if (ctx.streamFn) {
          const repairModelId =
            typeof ctx.model?.id === "string" && ctx.model.id.trim() ? ctx.model.id : ctx.modelId;
          const repairProfile = resolveNanoGptRepairProfile(repairModelId);
          const reliabilityOptions = {
            debug: Boolean(api.runtime?.logging?.shouldLogVerbose?.()),
          };
          if (!repairProfile.useBufferedRepair) {
            return wrapStreamWithMalformedToolCallGuard(
              ctx.streamFn,
              api.logger,
              reliabilityOptions,
            );
          }
          return wrapStreamWithToolCallRepair(ctx.streamFn, api.logger, reliabilityOptions);
        }
        return undefined;
      },
      classifyFailoverReason: (ctx) => {
        if (
          (ctx.errorMessage.includes("402") || ctx.errorMessage.includes("Insufficient balance")) &&
          !getNanoGptConfig(api.pluginConfig).provider
        ) {
          api.logger.warn(
            `NanoGPT upstream billing error on model ${ctx.modelId}. This typically means an hourly subscription limit was reached, or a provider failover misrouted to your empty PayGo wallet.`
          );
        }
        return undefined;
      },
    });

    api.registerWebSearchProvider(createNanoGptWebSearchProvider());
    api.registerImageGenerationProvider(buildNanoGptImageGenerationProvider());
  },
});
