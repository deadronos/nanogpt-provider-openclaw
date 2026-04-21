import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import { buildNanoGptProvider } from "./catalog/build-provider.js";
import { resolveNanoGptPluginConfigFromProviderCatalogContext } from "./provider-catalog.js";
import { NANOGPT_PROVIDER_ID } from "./models.js";

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
          pluginConfig: resolveNanoGptPluginConfigFromProviderCatalogContext(ctx),
        }),
      };
    },
  },
};

export default nanoGptProviderDiscovery;
