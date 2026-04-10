import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { buildNanoGptImageGenerationProvider } from "./image-generation-provider.js";
import { applyNanoGptConfig } from "./onboard.js";
import { NANOGPT_DEFAULT_MODEL_REF, NANOGPT_PROVIDER_ID } from "./models.js";
import { buildNanoGptProvider } from "./provider-catalog.js";
import { createNanoGptWebSearchProvider } from "./web-search.js";
import type { ProviderCatalogContext } from "openclaw/plugin-sdk/plugin-entry";

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
          defaultModel: NANOGPT_DEFAULT_MODEL_REF,
          expectedProviders: [NANOGPT_PROVIDER_ID],
          applyConfig: (cfg) => applyNanoGptConfig(cfg),
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
    });

    api.registerWebSearchProvider(createNanoGptWebSearchProvider());
    api.registerImageGenerationProvider(buildNanoGptImageGenerationProvider());
  },
});
