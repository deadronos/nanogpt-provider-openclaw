import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import type {
  ModelProviderConfig,
  UnifiedModelCatalogEntry,
  UnifiedModelCatalogProviderContext,
} from "openclaw/plugin-sdk/provider-model-shared";
import { buildNanoGptProvider } from "./catalog/build-provider.js";
import { NANOGPT_PROVIDER_ID } from "./models.js";

export {
  readNanoGptModelsJsonSnapshot,
  type NanoGptCatalogEntry,
  type NanoGptModelsJsonSnapshot,
} from "./catalog/models-json-snapshot.js";
export { buildNanoGptProvider } from "./catalog/build-provider.js";

export function resolveNanoGptPluginConfigFromProviderCatalogContext(
  ctx: ProviderCatalogContext,
): unknown {
  const entries = (ctx.config.plugins?.entries ?? {}) as Record<string, { config?: unknown }>;
  return entries[NANOGPT_PROVIDER_ID]?.config;
}

export interface NanoGptProviderCatalog {
  order: "simple";
  run: (ctx: ProviderCatalogContext) => Promise<{ provider: ModelProviderConfig } | null>;
}

export const nanoGptProviderCatalog: NanoGptProviderCatalog = {
  order: "simple",
  run: async (ctx: ProviderCatalogContext) => {
    const apiKey = ctx.resolveProviderApiKey(NANOGPT_PROVIDER_ID).apiKey;
    if (!apiKey) {
      return null;
    }

    return {
      provider: await buildNanoGptProvider({
        apiKey,
        pluginConfig: resolveNanoGptPluginConfigFromProviderCatalogContext(ctx),
      }),
    };
  },
};

/**
 * Project a NanoGPT `ModelProviderConfig` into `UnifiedModelCatalogEntry` rows.
 *
 * Exposed for the `api.registerModelCatalogProvider` migration so the plugin
 * can register its text catalog on the unified model-catalog surface without
 * abandoning the legacy `catalog` runtime hook.
 */
export function projectNanoGptModelProviderConfigToUnifiedTextRows(params: {
  providerId: string;
  config: ModelProviderConfig | null | undefined;
  source: UnifiedModelCatalogEntry["source"];
}): UnifiedModelCatalogEntry[] {
  const config = params.config;
  if (!config || !Array.isArray(config.models)) {
    return [];
  }

  const rows: UnifiedModelCatalogEntry[] = [];
  for (const model of config.models) {
    if (!model || typeof model !== "object") {
      continue;
    }
    const modelId = (model as { id?: unknown }).id;
    if (typeof modelId !== "string" || modelId.length === 0) {
      continue;
    }
    const modelName = (model as { name?: unknown }).name;
    rows.push({
      kind: "text",
      provider: params.providerId,
      model: modelId,
      ...(typeof modelName === "string" && modelName.length > 0 ? { label: modelName } : {}),
      source: params.source,
    });
  }
  return rows;
}

/**
 * Unified text catalog source used when the plugin owns the live
 * `nanoGptProviderCatalog` projection.
 */
export const NANOGPT_UNIFIED_LIVE_CATALOG_SOURCE = "live" as const satisfies UnifiedModelCatalogEntry["source"];

/**
 * Adapter that runs the legacy `nanoGptProviderCatalog` hook and projects the
 * resulting `ModelProviderConfig` into `UnifiedModelCatalogEntry` rows.
 *
 * Suitable for `api.registerModelCatalogProvider({ ..., liveCatalog })` in
 * `register(api)`.
 */
export async function readNanoGptUnifiedLiveCatalog(
  ctx: UnifiedModelCatalogProviderContext,
): Promise<UnifiedModelCatalogEntry[]> {
  // `UnifiedModelCatalogProviderContext` extends `ProviderCatalogContext` with
  // optional fields (`signal`, `includeLive`, `timeoutMs`), so the superset
  // is structurally assignable to the narrower context expected by the legacy
  // `nanoGptProviderCatalog.run()` — no cast needed.
  const result = await nanoGptProviderCatalog.run(ctx);
  return projectNanoGptModelProviderConfigToUnifiedTextRows({
    providerId: NANOGPT_PROVIDER_ID,
    config: result?.provider,
    source: NANOGPT_UNIFIED_LIVE_CATALOG_SOURCE,
  });
}
