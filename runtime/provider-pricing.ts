import {
  applyNanoGptProviderPricing,
  type NanoGptModelPricing,
} from "../models.js";
import { isRecord } from "../shared/guards.js";
import { sanitizeApiKey } from "../shared/http.js";
import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";

const NANOGPT_PROVIDER_SELECTION_BASE_URL = "https://nano-gpt.com/api";
const PROVIDER_PRICING_CACHE_TTL_MS = 300_000;
const SHORT_FAILURE_CACHE_TTL_MS = 30_000;
const VERY_SHORT_FAILURE_CACHE_TTL_MS = 5_000;
const NANOGPT_PROVIDER_PRICING_BATCH_SIZE = 8;

export const NANOGPT_PROVIDER_PRICING_TIMEOUT_MS = 10_000;

type NanoGptProviderPricingEntry = {
  provider?: unknown;
  pricing?: unknown;
  available?: unknown;
};

type NanoGptProviderPricingPayload = {
  supportsProviderSelection?: unknown;
  providers?: NanoGptProviderPricingEntry[];
};

const providerPricingCache = new Map<
  string,
  { pricing: NanoGptModelPricing | null; expiresAt: number }
>();
const providerPricingInFlight = new Map<string, Promise<NanoGptModelPricing | null>>();

function normalizeProviderId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function normalizeNanoGptProviderPricingEntry(entry: NanoGptProviderPricingEntry): NanoGptModelPricing | null {
  return isRecord(entry.pricing) ? (entry.pricing as NanoGptModelPricing) : null;
}

export async function fetchNanoGptSelectedProviderPricing(params: {
  apiKey: string;
  modelId: string;
  provider: string;
}): Promise<NanoGptModelPricing | null> {
  const providerId = normalizeProviderId(params.provider);
  if (!providerId) {
    return null;
  }

  const modelId = params.modelId.trim();
  if (!modelId) {
    return null;
  }

  const cacheKey = `${providerId}:${modelId}`;
  const now = Date.now();
  const cached = providerPricingCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.pricing;
  }

  const inFlight = providerPricingInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const deferred = createDeferred<NanoGptModelPricing | null>();
  providerPricingInFlight.set(cacheKey, deferred.promise);

  void (async () => {
    try {
      const url = new URL(
        `${NANOGPT_PROVIDER_SELECTION_BASE_URL}/models/${encodeURIComponent(modelId)}/providers`,
      );
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${sanitizeApiKey(params.apiKey)}`,
        },
        signal: AbortSignal.timeout(NANOGPT_PROVIDER_PRICING_TIMEOUT_MS),
      });
      if (!response.ok) {
        providerPricingCache.set(cacheKey, {
          pricing: null,
          expiresAt: Date.now() + SHORT_FAILURE_CACHE_TTL_MS,
        });
        deferred.resolve(null);
        return;
      }

      const payload = (await response.json()) as NanoGptProviderPricingPayload | null;
      if (!payload || !isRecord(payload) || payload.supportsProviderSelection === false) {
        providerPricingCache.set(cacheKey, {
          pricing: null,
          expiresAt: Date.now() + PROVIDER_PRICING_CACHE_TTL_MS,
        });
        deferred.resolve(null);
        return;
      }

      const providers = Array.isArray(payload.providers) ? payload.providers : [];
      const match = providers.find(
        (entry) =>
          isRecord(entry) &&
          normalizeProviderId(entry.provider) === providerId &&
          entry.available !== false,
      );
      const pricing = match ? normalizeNanoGptProviderPricingEntry(match) : null;
      providerPricingCache.set(cacheKey, {
        pricing,
        expiresAt: Date.now() + PROVIDER_PRICING_CACHE_TTL_MS,
      });
      deferred.resolve(pricing);
    } catch {
      providerPricingCache.set(cacheKey, {
        pricing: null,
        expiresAt: Date.now() + VERY_SHORT_FAILURE_CACHE_TTL_MS,
      });
      deferred.resolve(null);
    } finally {
      providerPricingInFlight.delete(cacheKey);
    }
  })();

  return deferred.promise;
}

export async function applyNanoGptSelectedProviderPricing(params: {
  apiKey: string;
  provider?: string;
  models: ModelDefinitionConfig[];
}): Promise<ModelDefinitionConfig[]> {
  const providerId = params.provider?.trim();
  if (!providerId) {
    return params.models;
  }

  const enriched = [...params.models];
  for (let start = 0; start < params.models.length; start += NANOGPT_PROVIDER_PRICING_BATCH_SIZE) {
    const chunk = params.models.slice(start, start + NANOGPT_PROVIDER_PRICING_BATCH_SIZE);
    const chunkResults = await Promise.all(
      chunk.map(async (model) =>
        applyNanoGptProviderPricing(
          model,
          await fetchNanoGptSelectedProviderPricing({
            apiKey: params.apiKey,
            modelId: model.id,
            provider: providerId,
          }),
        ),
      ),
    );
    enriched.splice(start, chunkResults.length, ...chunkResults);
  }

  return enriched;
}

export function resetNanoGptProviderPricingState(): void {
  providerPricingCache.clear();
  providerPricingInFlight.clear();
}
