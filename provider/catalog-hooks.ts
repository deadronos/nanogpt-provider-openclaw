import { readConfiguredProviderCatalogEntries } from "openclaw/plugin-sdk/provider-catalog-shared";
import type {
  ProviderResolveDynamicModelContext,
  ProviderRuntimeModel,
} from "openclaw/plugin-sdk/plugin-entry";
import type {
  ModelProviderConfig,
  UnifiedModelCatalogEntry,
} from "openclaw/plugin-sdk/provider-model-shared";
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
    // The OpenClaw `ConfiguredProviderCatalogEntry` `input` enum has been
    // widened in 2026.5.20+ to include `video`/`audio`, but the merge only
    // reads `provider` + `id`, so a narrow cast is safe here.
    readConfiguredProviderCatalogEntries({
      config: params.config as import("openclaw/plugin-sdk/provider-onboard").OpenClawConfig | undefined,
      providerId: NANOGPT_PROVIDER_ID,
    }) as unknown as NanoGptCatalogEntry[],
  );
}

export function normalizeNanoGptResolvedModel(
  ctx: { agentDir?: string; model: ProviderRuntimeModel },
): ProviderRuntimeModel | undefined {
  const definition = readNanoGptModelsJsonSnapshot(ctx.agentDir).modelDefinitions.get(ctx.model.id);
  if (!definition) {
    return undefined;
  }

  // `ProviderRuntimeModel.input` is the narrow `("text" | "image")[]` union,
  // but OpenClaw's `ModelDefinitionConfig.input` was widened in 2026.5.20+ to
  // include `video`/`audio`. We only ever populate the narrow values via
  // `normalizeNanoGptProviderModelInput`, so the cast is safe.
  const nextModel: ProviderRuntimeModel = {
    ...ctx.model,
    name: definition.name,
    reasoning: definition.reasoning,
    input: [...(definition.input as Array<"text" | "image">)],
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

/**
 * Unified catalog source used when projecting the supplemental NanoGPT
 * `augmentModelCatalog` rows onto the unified model-catalog surface.
 */
export const NANOGPT_UNIFIED_STATIC_CATALOG_SOURCE = "configured" as const satisfies UnifiedModelCatalogEntry["source"];

/**
 * Project NanoGPT `NanoGptCatalogEntry` supplemental rows onto the unified
 * `UnifiedModelCatalogEntry` surface.
 *
 * Exposed so the migration can route the legacy `augmentModelCatalog` rows
 * through `api.registerModelCatalogProvider` (`staticCatalog`) without
 * abandoning the in-place `NanoGptCatalogEntry` shape used by NanoGPT tests
 * and the local discovery snapshot.
 */
export function projectNanoGptAugmentedEntriesToUnifiedTextRows(
  entries: readonly NanoGptCatalogEntry[],
): UnifiedModelCatalogEntry[] {
  const rows: UnifiedModelCatalogEntry[] = [];
  for (const entry of entries) {
    if (!entry || typeof entry.id !== "string" || entry.id.length === 0) {
      continue;
    }
    const provider = typeof entry.provider === "string" && entry.provider.length > 0
      ? entry.provider
      : NANOGPT_PROVIDER_ID;
    rows.push({
      kind: "text",
      provider,
      model: entry.id,
      ...(typeof entry.name === "string" && entry.name.length > 0 ? { label: entry.name } : {}),
      source: NANOGPT_UNIFIED_STATIC_CATALOG_SOURCE,
    });
  }
  return rows;
}

/**
 * Adapter that reads the supplemental NanoGPT catalog rows (models.json +
 * configured providers) and projects them onto the unified model-catalog
 * surface.
 *
 * Suitable for `api.registerModelCatalogProvider({ ..., staticCatalog })` in
 * `register(api)`. The returned rows are pure: identical inputs yield
 * identical outputs, so OpenClaw can safely cache the projection.
 */
export function readNanoGptUnifiedStaticCatalog(params: {
  agentDir?: string;
  config?: unknown;
  env?: Record<string, string | undefined>;
}): UnifiedModelCatalogEntry[] {
  return projectNanoGptAugmentedEntriesToUnifiedTextRows(
    readNanoGptAugmentedCatalogEntries(params),
  );
}
