import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  NANOGPT_FALLBACK_MODELS,
  buildNanoGptModelDefinition,
  type NanoGptModelEntry,
  type NanoGptCatalogSource,
} from "../models.js";
import { sanitizeApiKey } from "../shared/http.js";
import { applyNanoGptSelectedProviderPricing } from "./provider-pricing.js";
import { resolveCatalogBaseUrl } from "./routing.js";
import { createNanoGptLoggerSync } from "../provider/nanogpt-logger.js";

export const NANOGPT_MODEL_DISCOVERY_TIMEOUT_MS = 30_000;

const NANOGPT_MODEL_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type NanoGptDiscoveryPayload = { data?: NanoGptModelEntry[] } | NanoGptModelEntry[];

type DiscoveryCacheEntry = {
  expiresAt: number;
  models: ModelDefinitionConfig[];
};

const _discoveryCache = new Map<string, DiscoveryCacheEntry>();
const _discoveryLogger = createNanoGptLoggerSync("discovery");

function _buildDiscoveryCacheKey(apiKey: string, source: string, provider?: string): string {
  return `${apiKey}:${source}:${provider ?? ""}`;
}

export async function discoverNanoGptModels(params: {
  apiKey: string;
  source: Exclude<NanoGptCatalogSource, "auto">;
  provider?: string;
}): Promise<ModelDefinitionConfig[]> {
  const cacheKey = _buildDiscoveryCacheKey(params.apiKey, params.source, params.provider);
  const now = Date.now();

  // Check cache for valid entry
  const cached = _discoveryCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    _discoveryLogger.info("model discovery cached", { source: params.source, provider: params.provider });
    return cached.models;
  }

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
      _discoveryLogger.warn("model discovery HTTP error", { status: response.status, source: params.source });
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
      _discoveryLogger.warn("model discovery returned no models, using fallback", { source: params.source });
      return NANOGPT_FALLBACK_MODELS;
    }

    const pricedModels = await applyNanoGptSelectedProviderPricing({
      apiKey: params.apiKey,
      provider: params.provider,
      models,
    });

    _discoveryLogger.info("model discovery succeeded", { count: pricedModels.length, source: params.source });

    // Cache the result with TTL
    _discoveryCache.set(cacheKey, {
      expiresAt: now + NANOGPT_MODEL_DISCOVERY_CACHE_TTL_MS,
      models: pricedModels,
    });

    return pricedModels;
  } catch (err) {
    _discoveryLogger.error("model discovery failed", {
      error: String(err instanceof Error ? err.message : err).slice(0, 200),
      source: params.source,
    });
    return NANOGPT_FALLBACK_MODELS;
  }
}

export function resetNanoGptDiscoveryState(): void {
  _discoveryCache.clear();
  _discoveryLogger.info("discovery state reset");
}
