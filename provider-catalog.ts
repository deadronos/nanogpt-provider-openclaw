import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  NANOGPT_PROVIDER_ID,
  type NanoGptPluginConfig,
} from "./models.js";
import {
  buildNanoGptRequestHeaders,
  discoverNanoGptModels,
  getNanoGptConfig,
  resolveCatalogSource,
  resolveNanoGptRequestApi,
  resolveNanoGptRoutingMode,
  resolveRequestBaseUrl,
} from "./runtime.js";

export async function buildNanoGptProvider(params: {
  apiKey: string;
  pluginConfig?: unknown;
}): Promise<ModelProviderConfig> {
  const config: NanoGptPluginConfig = getNanoGptConfig(params.pluginConfig);
  const routingMode = await resolveNanoGptRoutingMode({
    config,
    apiKey: params.apiKey,
  });
  const catalogSource = resolveCatalogSource({
    config,
    routingMode,
  });
  const models = await discoverNanoGptModels({
    apiKey: params.apiKey,
    source: catalogSource,
    provider: config.provider,
  });

  return {
    baseUrl: resolveRequestBaseUrl(routingMode),
    api: resolveNanoGptRequestApi(config),
    apiKey: params.apiKey,
    headers: buildNanoGptRequestHeaders({
      apiKey: params.apiKey,
      config,
      routingMode,
    }),
    models: models.map((model) => ({
      ...model,
      provider: NANOGPT_PROVIDER_ID,
    })),
  };
}
