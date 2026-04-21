import { readConfiguredProviderCatalogEntries } from "openclaw/plugin-sdk/provider-catalog-shared";
import type {
  ProviderResolveDynamicModelContext,
  ProviderRuntimeModel,
} from "openclaw/plugin-sdk/plugin-entry";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import { readNanoGptModelsJsonSnapshot, type NanoGptCatalogEntry } from "../catalog/models-json-snapshot.js";
import { resolveNanoGptDynamicModel } from "../runtime/dynamic-models.js";
import { NANOGPT_PROVIDER_ID } from "../models.js";

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

export function readNanoGptAugmentedCatalogEntries(params: {
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

export function normalizeNanoGptResolvedModel(
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

export function resolveNanoGptDynamicModelWithSnapshot(
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

export function applyNanoGptNativeStreamingUsageCompat(
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
