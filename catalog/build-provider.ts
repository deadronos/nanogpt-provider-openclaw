import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  buildNanoGptRequestHeaders,
  resolveCatalogSource,
  resolveNanoGptRoutingMode,
  resolveNanoGptSelectedProvider,
  resolveRequestBaseUrl,
} from "../runtime/routing.js";
import { discoverNanoGptModels } from "../runtime/discovery.js";
import {
  getNanoGptConfig,
  resolveNanoGptRequestApi,
} from "../runtime/config.js";
import { NANOGPT_PROVIDER_ID, type NanoGptPluginConfig } from "../models.js";

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
  const selectedProvider = resolveNanoGptSelectedProvider({
    config,
    routingMode,
  });
  const models = await discoverNanoGptModels({
    apiKey: params.apiKey,
    source: catalogSource,
    provider: selectedProvider,
  });

  const resolvedHeaders = buildNanoGptRequestHeaders({
    apiKey: params.apiKey,
    config,
    routingMode,
  });
  const { Authorization: _authorization, ...providerHeaders } = resolvedHeaders;

  return {
    baseUrl: resolveRequestBaseUrl({
      config,
      routingMode,
    }),
    api: resolveNanoGptRequestApi(config),
    apiKey: params.apiKey,
    ...(Object.keys(providerHeaders).length > 0 ? { headers: providerHeaders } : {}),
    models: models.map((model) => ({
      ...model,
      provider: NANOGPT_PROVIDER_ID,
    })),
  };
}
