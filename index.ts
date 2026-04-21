import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { readConfiguredProviderCatalogEntries } from "openclaw/plugin-sdk/provider-catalog-shared";
import { buildNanoGptImageGenerationProvider } from "./image-generation-provider.js";
import {
  formatNanoGptErrorSurfaceDetails,
  inspectNanoGptErrorSurface,
} from "./nanogpt-errors.js";
import { applyNanoGptProviderAuthConfig, applyNanoGptProviderConfig } from "./onboard.js";
import { NANOGPT_DEFAULT_MODEL_REF, NANOGPT_PROVIDER_ID } from "./models.js";
import { buildNanoGptProvider, readNanoGptModelsJsonSnapshot } from "./provider-catalog.js";
import {
  fetchNanoGptUsageSnapshot,
  getNanoGptConfig,
  resolveNanoGptDynamicModel,
  resolveNanoGptUsageAuth,
} from "./runtime.js";
import { createNanoGptWebSearchProvider } from "./web-search.js";
import type {
  AnyAgentTool,
  ProviderCatalogContext,
  ProviderResolveDynamicModelContext,
  ProviderToolSchemaDiagnostic,
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

const NANOGPT_API_KEY_FLAG_NAME = "--nanogpt-api-key" as const;
const NANOGPT_API_KEY_ENV_VAR = "NANOGPT_API_KEY" as const;
const NANOGPT_API_KEY_OPTION_KEY = "nanogptApiKey" as const;

type NanoGptApiKeyAuthMethod = ReturnType<typeof createProviderApiKeyAuthMethod>;
type NanoGptApiKeyAuthContext = Parameters<NanoGptApiKeyAuthMethod["run"]>[0];
type NanoGptApiKeyNonInteractiveContext = Parameters<
  NonNullable<NanoGptApiKeyAuthMethod["runNonInteractive"]>
>[0];

function resolveNanoGptApiKeyOptionValue(ctx: NanoGptApiKeyNonInteractiveContext): string | undefined {
  const opts = ctx.opts as Record<string, unknown> | undefined;
  return typeof opts?.[NANOGPT_API_KEY_OPTION_KEY] === "string"
    ? opts[NANOGPT_API_KEY_OPTION_KEY]
    : undefined;
}

function createNanoGptApiKeyAuthMethod(): NanoGptApiKeyAuthMethod {
  const baseMethod = createProviderApiKeyAuthMethod({
    providerId: NANOGPT_PROVIDER_ID,
    methodId: "api-key",
    label: "NanoGPT API key",
    hint: "Subscription or pay-as-you-go",
    optionKey: NANOGPT_API_KEY_OPTION_KEY,
    flagName: NANOGPT_API_KEY_FLAG_NAME,
    envVar: NANOGPT_API_KEY_ENV_VAR,
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
  });
  const runNonInteractive = baseMethod.runNonInteractive;

  return {
    ...baseMethod,
    run: async (ctx: NanoGptApiKeyAuthContext) => {
      const result = await baseMethod.run(ctx);
      return {
        ...result,
        configPatch: applyNanoGptProviderAuthConfig(
          result.configPatch ?? ctx.config,
          result.profiles[0]?.credential,
        ),
      };
    },
    runNonInteractive: runNonInteractive
      ? async (ctx: NanoGptApiKeyNonInteractiveContext) => {
          const next = await runNonInteractive(ctx);
          if (!next) {
            return next;
          }

          const resolved = await ctx.resolveApiKey({
            provider: NANOGPT_PROVIDER_ID,
            flagValue: resolveNanoGptApiKeyOptionValue(ctx),
            flagName: NANOGPT_API_KEY_FLAG_NAME,
            envVar: NANOGPT_API_KEY_ENV_VAR,
          });
          if (!resolved || resolved.source === "profile") {
            return next;
          }

          const credential = ctx.toApiKeyCredential({
            provider: NANOGPT_PROVIDER_ID,
            resolved,
          });
          return credential ? applyNanoGptProviderAuthConfig(next, credential) : next;
        }
      : undefined,
  };
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
    if (model.compat?.supportsUsageInStreaming !== undefined) {
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

function detectNanoGptModelFamily(modelId: string): "kimi" | "glm" | "qwen" | "other" {
  const normalized = modelId.trim().toLowerCase();
  if (normalized.startsWith("moonshotai/kimi")) {
    return "kimi";
  }
  if (normalized.startsWith("zai-org/glm") || normalized.includes("/glm")) {
    return "glm";
  }
  if (normalized.includes("qwen")) {
    return "qwen";
  }
  return "other";
}

const NANOGPT_GLM_TOOL_SCHEMA_HINT_MARKER = "NanoGPT GLM tip:";
const NANOGPT_GLM_TOOL_SCHEMA_HINT =
  "NanoGPT GLM tip: include required ref/selector/fields arguments explicitly when the tool needs them.";
const NANOGPT_QWEN_TOOL_SCHEMA_HINT_MARKER = "NanoGPT Qwen tip:";

function getNanoGptToolSchemaSummary(tool: AnyAgentTool): {
  parameters?: Record<string, unknown>;
  required: string[];
  properties: string[];
} {
  const parameters = isRecord(tool.parameters) ? tool.parameters : undefined;
  const required = Array.isArray(parameters?.required)
    ? parameters.required.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const properties = isRecord(parameters?.properties) ? Object.keys(parameters.properties) : [];

  return { parameters, required, properties };
}

function shouldAnnotateNanoGptGlmToolSchema(tool: AnyAgentTool): boolean {
  const { parameters, required, properties } = getNanoGptToolSchemaSummary(tool);
  if (!parameters) {
    return /web[_-]?fetch|fetch[_-]?web|browser|page|extract|search/i.test(tool.name);
  }

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

function resolveNanoGptQwenPrimarySchemaField(tool: AnyAgentTool): string | undefined {
  const { required, properties } = getNanoGptToolSchemaSummary(tool);
  if (required.length === 1) {
    return required[0];
  }
  if (properties.length === 1) {
    return properties[0];
  }
  return undefined;
}

function appendNanoGptQwenToolSchemaHint(tool: AnyAgentTool): string {
  if (
    typeof tool.description === "string" &&
    tool.description.includes(NANOGPT_QWEN_TOOL_SCHEMA_HINT_MARKER)
  ) {
    return tool.description;
  }

  const primaryField = resolveNanoGptQwenPrimarySchemaField(tool);
  const { required, properties } = getNanoGptToolSchemaSummary(tool);
  const hintedKeys = [...new Set([...(required.length > 0 ? required : []), ...properties])].slice(0, 4);
  const argumentHint = primaryField
    ? ` Pass a JSON object like {"${primaryField}":"..."} when calling it.`
    : hintedKeys.length > 0
      ? ` Include JSON object arguments using keys like ${hintedKeys.join(", ")}.`
      : " Pass a JSON object with named arguments instead of plain text.";
  const qwenHint =
    `${NANOGPT_QWEN_TOOL_SCHEMA_HINT_MARKER} emit a direct tool call with JSON object arguments that match this schema; do not write plain text or XML-like wrappers such as ` +
    `<${tool.name}>...</${tool.name}> or <function=${tool.name}>.${argumentHint}`;

  if (typeof tool.description === "string" && tool.description.trim().length > 0) {
    return `${tool.description} ${qwenHint}`;
  }

  return qwenHint;
}

function inspectNanoGptQwenToolSchema(
  tool: AnyAgentTool,
  toolIndex: number,
): ProviderToolSchemaDiagnostic | null {
  const violations: string[] = [];
  const { parameters, properties } = getNanoGptToolSchemaSummary(tool);

  if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
    violations.push(
      "missing description; Qwen tool calling is more reliable when each tool has a short explicit one-line description",
    );
  }

  if (!parameters || parameters.type !== "object") {
    violations.push(
      "parameters should be a JSON object schema so NanoGPT can revalidate leaked tool text against named arguments",
    );
  } else if (properties.length === 0) {
    violations.push(
      "schema exposes no named properties; generic plain-text wrappers like <tool>...</tool> cannot be mapped back to arguments reliably",
    );
  }

  return violations.length > 0
    ? {
        toolName: tool.name,
        toolIndex,
        violations,
      }
    : null;
}

function normalizeNanoGptToolSchemas(
  ctx: ProviderNormalizeToolSchemasContext,
): AnyAgentTool[] | null {
  const family = detectNanoGptModelFamily(resolveNanoGptToolSchemaModelId(ctx));
  if (family !== "glm" && family !== "qwen") {
    return null;
  }

  let changed = false;
  const tools = ctx.tools.map((tool) => {
    if (family === "glm" && !shouldAnnotateNanoGptGlmToolSchema(tool)) {
      return tool;
    }
    const nextDescription =
      family === "glm"
        ? appendNanoGptGlmToolSchemaHint(tool.description)
        : appendNanoGptQwenToolSchemaHint(tool);
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

function inspectNanoGptToolSchemas(
  ctx: ProviderNormalizeToolSchemasContext,
): ProviderToolSchemaDiagnostic[] | null {
  const family = detectNanoGptModelFamily(resolveNanoGptToolSchemaModelId(ctx));
  if (family !== "qwen") {
    return null;
  }

  const diagnostics = ctx.tools
    .map((tool, toolIndex) => inspectNanoGptQwenToolSchema(tool, toolIndex))
    .filter(
      (diagnostic): diagnostic is ProviderToolSchemaDiagnostic => diagnostic !== null,
    );

  return diagnostics.length > 0 ? diagnostics : null;
}

function summarizeNanoGptErrorMessage(message: string | undefined): string {
  const normalized = message?.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "(no message)";
  }
  return normalized.length > 200 ? `${normalized.slice(0, 197)}...` : normalized;
}

export default definePluginEntry({
  id: NANOGPT_PROVIDER_ID,
  name: "NanoGPT Provider",
  description: "NanoGPT provider plugin for OpenClaw",
  register(api) {
    const pluginConfig = api.pluginConfig;
    const resolvedNanoGptConfig = getNanoGptConfig(pluginConfig);
    const warnedNanoGptErrorSignatures = new Set<string>();

    function warnNanoGptErrorSurface(params: {
      modelId?: string;
      kind: "mapped" | "context_overflow" | "recognized_unmapped" | "unknown_structured";
      details: string;
      message?: string;
      reason?: string;
    }): void {
      const modelId = params.modelId?.trim() || "(unknown model)";
      const routingMode = resolvedNanoGptConfig.routingMode ?? "auto";
      const providerOverride = resolvedNanoGptConfig.provider?.trim() || "auto";
      const signature = [
        params.kind,
        params.reason ?? "",
        modelId,
        routingMode,
        providerOverride,
        params.details,
      ].join("|");

      if (warnedNanoGptErrorSignatures.has(signature)) {
        return;
      }
      warnedNanoGptErrorSignatures.add(signature);

      const context = `[${params.details}, routingMode=${routingMode}, providerOverride=${providerOverride}]`;
      const summary = summarizeNanoGptErrorMessage(params.message);

      if (params.kind === "mapped") {
        api.logger.warn(
          `NanoGPT API error classified as ${params.reason} for model ${modelId} ${context}: ${summary}`,
        );
        return;
      }

      if (params.kind === "context_overflow") {
        api.logger.warn(
          `NanoGPT API error matched OpenClaw context overflow handling for model ${modelId} ${context}: ${summary}`,
        );
        return;
      }

      if (params.kind === "recognized_unmapped") {
        api.logger.warn(
          `NanoGPT API error recognized but not mapped to an OpenClaw failover reason for model ${modelId} ${context}: ${summary}. Falling back to OpenClaw generic classification.`,
        );
        return;
      }

      api.logger.warn(
        `Unknown NanoGPT API error envelope for model ${modelId} ${context}: ${summary}. Falling back to OpenClaw generic classification.`,
      );
    }

    api.registerProvider({
      id: NANOGPT_PROVIDER_ID,
      label: "NanoGPT",
      docsPath: "/providers/models",
      envVars: ["NANOGPT_API_KEY"],
      auth: [createNanoGptApiKeyAuthMethod()],
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
      inspectToolSchemas: (ctx) => inspectNanoGptToolSchemas(ctx),
      resolveDynamicModel: (ctx) => resolveNanoGptDynamicModelWithSnapshot(ctx),
      applyNativeStreamingUsageCompat: ({ providerConfig }) =>
        applyNanoGptNativeStreamingUsageCompat(providerConfig),
      resolveUsageAuth: async (ctx) => await resolveNanoGptUsageAuth(ctx),
      fetchUsageSnapshot: async (ctx) => await fetchNanoGptUsageSnapshot(ctx),
      wrapStreamFn: (ctx) => {
        if (ctx.streamFn) {
          return ctx.streamFn;
        }
        return undefined;
      },
      matchesContextOverflowError: (ctx) => {
        const inspection = inspectNanoGptErrorSurface(ctx.errorMessage);
        if (inspection?.kind !== "context_overflow") {
          return undefined;
        }

        warnNanoGptErrorSurface({
          modelId: ctx.modelId,
          kind: inspection.kind,
          details: formatNanoGptErrorSurfaceDetails(inspection.error),
          message: inspection.error.message ?? ctx.errorMessage,
        });
        return true;
      },
      classifyFailoverReason: (ctx) => {
        const inspection = inspectNanoGptErrorSurface(ctx.errorMessage);
        if (!inspection) {
          return undefined;
        }

        if (inspection.kind === "mapped") {
          warnNanoGptErrorSurface({
            modelId: ctx.modelId,
            kind: inspection.kind,
            reason: inspection.reason,
            details: formatNanoGptErrorSurfaceDetails(inspection.error),
            message: inspection.error.message ?? ctx.errorMessage,
          });
          return inspection.reason;
        }

        warnNanoGptErrorSurface({
          modelId: ctx.modelId,
          kind: inspection.kind,
          details: formatNanoGptErrorSurfaceDetails(inspection.error),
          message: inspection.error.message ?? ctx.errorMessage,
        });
        return undefined;
      },
    });

    api.registerWebSearchProvider(createNanoGptWebSearchProvider());
    api.registerImageGenerationProvider(buildNanoGptImageGenerationProvider());
  },
});
