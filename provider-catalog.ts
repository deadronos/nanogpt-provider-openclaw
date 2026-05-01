import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
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
