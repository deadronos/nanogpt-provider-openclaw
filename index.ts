import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { readConfiguredProviderCatalogEntries } from "openclaw/plugin-sdk/provider-catalog-shared";
import { buildNanoGptImageGenerationProvider } from "./image-generation-provider.js";
import { applyNanoGptProviderConfig } from "./onboard.js";
import {
  NANOGPT_DEFAULT_MODEL_REF,
  NANOGPT_PROVIDER_ID,
  NANOGPT_WEB_FETCH_TOOL_ALIAS,
  shouldAliasNanoGptWebFetchTool,
} from "./models.js";
import { buildNanoGptProvider } from "./provider-catalog.js";
import {
  fetchNanoGptUsageSnapshot,
  getNanoGptConfig,
  resolveNanoGptDynamicModel,
  resolveNanoGptUsageAuth,
} from "./runtime.js";
import {
  shouldRepairNanoGptToolCallArguments,
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

type NanoGptModelsJsonSnapshot = {
  catalogEntries: NanoGptCatalogEntry[];
  modelDefinitions: Map<string, ModelProviderConfig["models"][number]>;
};

const emptyNanoGptModelsJsonSnapshot: NanoGptModelsJsonSnapshot = {
  catalogEntries: [],
  modelDefinitions: new Map<string, ModelProviderConfig["models"][number]>(),
};

const nanoGptModelsJsonCache = new Map<
  string,
  { mtimeMs: number; snapshot: NanoGptModelsJsonSnapshot }
>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNanoGptCatalogInput(
  input: unknown,
): NanoGptCatalogEntry["input"] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const normalized = input.filter(
    (item): item is "text" | "image" | "document" =>
      item === "text" || item === "image" || item === "document",
  );
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNanoGptProviderModelInput(
  input: unknown,
): Array<"text" | "image"> | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const normalized = input.filter(
    (item): item is "text" | "image" => item === "text" || item === "image",
  );
  return normalized.length > 0 ? normalized : undefined;
}

function parseFinitePositiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function buildNanoGptModelsJsonCost(
  value: unknown,
): ModelProviderConfig["models"][number]["cost"] {
  const record = isRecord(value) ? value : {};
  const input = typeof record.input === "number" && Number.isFinite(record.input) ? record.input : 0;
  const output = typeof record.output === "number" && Number.isFinite(record.output) ? record.output : 0;
  const cacheRead =
    typeof record.cacheRead === "number" && Number.isFinite(record.cacheRead) ? record.cacheRead : 0;
  const cacheWrite =
    typeof record.cacheWrite === "number" && Number.isFinite(record.cacheWrite) ? record.cacheWrite : 0;

  return { input, output, cacheRead, cacheWrite };
}

function buildNanoGptCatalogEntryFromModelDefinition(
  model: ModelProviderConfig["models"][number],
): NanoGptCatalogEntry {
  return {
    provider: NANOGPT_PROVIDER_ID,
    id: model.id,
    name: model.name,
    ...(typeof model.contextWindow === "number" && model.contextWindow > 0
      ? { contextWindow: model.contextWindow }
      : {}),
    ...(typeof model.reasoning === "boolean" ? { reasoning: model.reasoning } : {}),
    ...(Array.isArray(model.input) && model.input.length > 0 ? { input: [...model.input] } : {}),
  };
}

function resolveNanoGptAgentDir(agentDir?: string): string | undefined {
  const explicit = typeof agentDir === "string" && agentDir.trim() ? agentDir.trim() : undefined;
  if (explicit) {
    return explicit;
  }

  const envAgentDir = process.env.OPENCLAW_AGENT_DIR?.trim() || process.env.PI_CODING_AGENT_DIR?.trim();
  if (envAgentDir) {
    return envAgentDir;
  }

  const stateDir = process.env.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) {
    return path.join(stateDir, "agents", "default", "agent");
  }

  const homeDir = process.env.OPENCLAW_HOME?.trim() || process.env.HOME?.trim() || os.homedir();
  return homeDir ? path.join(homeDir, ".openclaw", "agents", "default", "agent") : undefined;
}

function readNanoGptModelsJsonSnapshot(agentDir?: string): NanoGptModelsJsonSnapshot {
  const resolvedAgentDir = resolveNanoGptAgentDir(agentDir);
  if (!resolvedAgentDir) {
    return emptyNanoGptModelsJsonSnapshot;
  }

  const modelsPath = path.join(resolvedAgentDir, "models.json");
  try {
    if (!fs.existsSync(modelsPath)) {
      nanoGptModelsJsonCache.delete(modelsPath);
      return emptyNanoGptModelsJsonSnapshot;
    }

    const stats = fs.statSync(modelsPath);
    const cached = nanoGptModelsJsonCache.get(modelsPath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.snapshot;
    }

    const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf8")) as unknown;
    const providers = isRecord(parsed) && isRecord(parsed.providers) ? parsed.providers : undefined;
    const provider = providers && isRecord(providers[NANOGPT_PROVIDER_ID])
      ? providers[NANOGPT_PROVIDER_ID]
      : undefined;
    const models = provider && Array.isArray(provider.models) ? provider.models : [];

    const catalogEntries: NanoGptCatalogEntry[] = [];
    const modelDefinitions = new Map<string, ModelProviderConfig["models"][number]>();
    for (const model of models) {
      if (!isRecord(model)) {
        continue;
      }

      const id = typeof model.id === "string" ? model.id.trim() : "";
      if (!id) {
        continue;
      }

      const name = (typeof model.name === "string" ? model.name : id).trim() || id;
      const contextWindow = parseFinitePositiveNumber(model.contextWindow) ?? 200000;
      const contextTokens = parseFinitePositiveNumber(model.contextTokens);
      const maxTokens = parseFinitePositiveNumber(model.maxTokens) ?? 32768;
      const reasoning = typeof model.reasoning === "boolean" ? model.reasoning : false;
      const catalogInput = normalizeNanoGptCatalogInput(model.input);
      const providerModelInput = normalizeNanoGptProviderModelInput(model.input);
      const rawCompat = isRecord(model.compat)
        ? {
            ...(model.compat as NonNullable<ModelProviderConfig["models"][number]["compat"]>),
          }
        : undefined;
      const compat = rawCompat ? { ...rawCompat } : undefined;

      const definition: ModelProviderConfig["models"][number] = {
        id,
        name,
        reasoning,
        input: providerModelInput ? [...providerModelInput] : ["text"],
        cost: buildNanoGptModelsJsonCost(model.cost),
        contextWindow,
        ...(contextTokens ? { contextTokens } : {}),
        maxTokens,
        ...(compat ? { compat } : {}),
        ...(typeof model.api === "string"
          ? { api: model.api as ModelProviderConfig["models"][number]["api"] }
          : {}),
      };

      catalogEntries.push({
        provider: NANOGPT_PROVIDER_ID,
        id,
        name,
        ...(contextWindow ? { contextWindow } : {}),
        ...(typeof reasoning === "boolean" ? { reasoning } : {}),
        ...(catalogInput ? { input: [...catalogInput] } : {}),
      });
      modelDefinitions.set(id, definition);
    }

    const snapshot = {
      catalogEntries,
      modelDefinitions,
    } satisfies NanoGptModelsJsonSnapshot;
    nanoGptModelsJsonCache.set(modelsPath, {
      mtimeMs: stats.mtimeMs,
      snapshot,
    });

    return snapshot;
  } catch {
    nanoGptModelsJsonCache.delete(modelsPath);
    return emptyNanoGptModelsJsonSnapshot;
  }
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
}): NanoGptCatalogEntry[] {
  return mergeNanoGptCatalogEntries(
    readNanoGptModelsJsonSnapshot(params.agentDir).catalogEntries,
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
  ctx: ProviderResolveDynamicModelContext,
): ProviderRuntimeModel | undefined {
  const snapshotModels = [...readNanoGptModelsJsonSnapshot(ctx.agentDir).modelDefinitions.values()];

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

function normalizeNanoGptToolSchemas(
  ctx: ProviderNormalizeToolSchemasContext,
): AnyAgentTool[] | null {
  if (!shouldAliasNanoGptWebFetchTool(resolveNanoGptToolSchemaModelId(ctx))) {
    return null;
  }

  let changed = false;
  const tools = ctx.tools.map((tool) => {
    if (tool.name !== "web_fetch") {
      return tool;
    }
    changed = true;
    return {
      ...tool,
      name: NANOGPT_WEB_FETCH_TOOL_ALIAS,
    } as AnyAgentTool;
  });

  return changed ? tools : null;
}

function shouldDebugNanoGptToolReliability(): boolean {
  const raw = process.env.NANOGPT_DEBUG_TOOL_RELIABILITY?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
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
          const reliabilityOptions = {
            debug: shouldDebugNanoGptToolReliability(),
          };
          if (!shouldRepairNanoGptToolCallArguments(repairModelId)) {
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
