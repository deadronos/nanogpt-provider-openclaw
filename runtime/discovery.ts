import {
  NANOGPT_FALLBACK_MODELS,
  buildNanoGptModelDefinition,
  type NanoGptModelEntry,
  type NanoGptCatalogSource,
} from "../models.js";
import { sanitizeApiKey } from "../shared/http.js";
import { applyNanoGptSelectedProviderPricing } from "./provider-pricing.js";
import { resolveCatalogBaseUrl } from "./routing.js";

export const NANOGPT_MODEL_DISCOVERY_TIMEOUT_MS = 30_000;

type NanoGptDiscoveryPayload = { data?: NanoGptModelEntry[] } | NanoGptModelEntry[];

export async function discoverNanoGptModels(params: {
  apiKey: string;
  source: Exclude<NanoGptCatalogSource, "auto">;
  provider?: string;
}) {
  try {
    const url = new URL(`${resolveCatalogBaseUrl(params.source)}/models`);
    url.searchParams.set("detailed", "true");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${sanitizeApiKey(params.apiKey)}`,
      },
      signal: AbortSignal.timeout(NANOGPT_MODEL_DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return NANOGPT_FALLBACK_MODELS;
    }

    const payload = (await response.json()) as NanoGptDiscoveryPayload;
    const entries = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.data)
        ? payload.data
        : [];
    const models = entries
      .map((entry) => buildNanoGptModelDefinition(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    if (models.length === 0) {
      return NANOGPT_FALLBACK_MODELS;
    }

    return await applyNanoGptSelectedProviderPricing({
      apiKey: params.apiKey,
      provider: params.provider,
      models,
    });
  } catch {
    return NANOGPT_FALLBACK_MODELS;
  }
}
