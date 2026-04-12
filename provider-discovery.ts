import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import { buildNanoGptProvider } from "./provider-catalog.js";
import { NANOGPT_PROVIDER_ID } from "./models.js";

function resolveNanoGptPluginConfig(ctx: ProviderCatalogContext): unknown {
  const entries = (ctx.config.plugins?.entries ?? {}) as Record<string, { config?: unknown }>;
  return entries[NANOGPT_PROVIDER_ID]?.config;
}

const nanoGptProviderDiscovery = {
  id: NANOGPT_PROVIDER_ID,
  label: "NanoGPT",
  docsPath: "/providers/models",
  auth: [],
  catalog: {
    order: "simple" as const,
    run: async (ctx: ProviderCatalogContext) => {
      const apiKey = ctx.resolveProviderApiKey(NANOGPT_PROVIDER_ID).apiKey;
      if (!apiKey) {
        return null;
      }

      return {
        provider: await buildNanoGptProvider({
          apiKey,
          pluginConfig: resolveNanoGptPluginConfig(ctx),
        }),
      };
    },
  },
};

export default nanoGptProviderDiscovery;