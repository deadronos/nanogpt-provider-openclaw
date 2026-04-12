import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  NANOGPT_FALLBACK_MODELS,
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

async function validateModelAvailabilityForApiChoice(params: {
  apiKey: string;
  config: NanoGptPluginConfig;
  routingMode: string;
  catalogSource: string;
  discoveredModels: unknown[];
}): Promise<string | null> {
  // Only validate when responses is explicitly requested
  if (params.config.requestApi !== "responses") {
    return null;
  }

  // Only validate if discovery returned fallback models (indicating failure)
  if (params.discoveredModels !== NANOGPT_FALLBACK_MODELS) {
    return null;
  }

  // Try to discover models with completions API
  const completionsModels = await discoverNanoGptModels({
    apiKey: params.apiKey,
    source: params.catalogSource as Exclude<import("./models.js").NanoGptCatalogSource, "auto">,
    provider: params.config.provider,
  });

  // If completions has real models, let user know responses doesn't have them
  if (completionsModels !== NANOGPT_FALLBACK_MODELS) {
    return (
      "NanoGPT models not available via Responses API endpoint. " +
      "These models are available via the Chat Completions API instead. " +
      "Either: (1) set requestApi to 'completions' or 'auto', " +
      "or (2) check if different model IDs are supported by the Responses endpoint."
    );
  }

  return null;
}

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

  // Validate API choice: if responses was requested but models aren't found,
  // check if they're available via completions and provide helpful error
  const validationError = await validateModelAvailabilityForApiChoice({
    apiKey: params.apiKey,
    config,
    routingMode,
    catalogSource,
    discoveredModels: models,
  });

  if (validationError) {
    throw new Error(validationError);
  }

  return {
    baseUrl: resolveRequestBaseUrl({
      config,
      routingMode,
    }),
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
