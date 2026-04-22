import {
  NANOGPT_BASE_URL,
  NANOGPT_PAID_BASE_URL,
  NANOGPT_PERSONALIZED_BASE_URL,
  NANOGPT_SUBSCRIPTION_BASE_URL,
  type NanoGptCatalogSource,
  type NanoGptPluginConfig,
  type NanoGptRoutingMode,
} from "../models.js";
import { sanitizeApiKey, sanitizeHeaderValue } from "../shared/http.js";
import {
  resolveNanoGptSubscriptionActive,
  type NanoGptSubscriptionPayload,
} from "./subscription.js";

const SUBSCRIPTION_CACHE_TTL_MS = 60_000;
export const NANOGPT_SUBSCRIPTION_PROBE_TIMEOUT_MS = 10_000;

const subscriptionCache = new Map<string, { active: boolean; expiresAt: number }>();

export async function probeNanoGptSubscription(apiKey: string): Promise<boolean> {
  const now = Date.now();
  const cached = subscriptionCache.get(apiKey);
  if (cached && cached.expiresAt > now) {
    return cached.active;
  }

  try {
    const response = await fetch(`${NANOGPT_SUBSCRIPTION_BASE_URL}/usage`, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${sanitizeApiKey(apiKey)}`,
      },
      signal: AbortSignal.timeout(NANOGPT_SUBSCRIPTION_PROBE_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`NanoGPT subscription probe failed with HTTP ${response.status}`);
    }

    const payload = (await response.json()) as NanoGptSubscriptionPayload;
    const active = resolveNanoGptSubscriptionActive(payload);
    subscriptionCache.set(apiKey, { active, expiresAt: now + SUBSCRIPTION_CACHE_TTL_MS });
    return active;
  } catch (error) {
    subscriptionCache.delete(apiKey);
    throw error;
  }
}

export async function resolveNanoGptRoutingMode(params: {
  config: NanoGptPluginConfig;
  apiKey: string;
}): Promise<Exclude<NanoGptRoutingMode, "auto">> {
  const routingMode = params.config.routingMode ?? "auto";
  if (routingMode === "paygo" || routingMode === "subscription") {
    return routingMode;
  }

  try {
    return (await probeNanoGptSubscription(params.apiKey)) ? "subscription" : "paygo";
  } catch {
    return "subscription";
  }
}

export function resolveCatalogSource(params: {
  config: NanoGptPluginConfig;
  routingMode: Exclude<NanoGptRoutingMode, "auto">;
}): Exclude<NanoGptCatalogSource, "auto"> {
  const catalogSource = params.config.catalogSource ?? "auto";
  if (catalogSource !== "auto") {
    return catalogSource;
  }

  return params.routingMode === "subscription" ? "subscription" : "canonical";
}

export function resolveCatalogBaseUrl(source: Exclude<NanoGptCatalogSource, "auto">): string {
  switch (source) {
    case "subscription":
      return NANOGPT_SUBSCRIPTION_BASE_URL;
    case "paid":
      return NANOGPT_PAID_BASE_URL;
    case "personalized":
      return NANOGPT_PERSONALIZED_BASE_URL;
    case "canonical":
    default:
      return NANOGPT_BASE_URL;
  }
}

export function resolveRequestBaseUrl(params: {
  config: NanoGptPluginConfig;
  routingMode: Exclude<NanoGptRoutingMode, "auto">;
}): string {
  if (params.config.requestApi === "responses" && params.routingMode === "subscription") {
    return NANOGPT_BASE_URL;
  }

  return params.routingMode === "subscription" ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL;
}

export function resolveNanoGptSelectedProvider(params: {
  config: NanoGptPluginConfig;
  routingMode: Exclude<NanoGptRoutingMode, "auto">;
}): string | undefined {
  return params.routingMode === "paygo" ? params.config.provider : undefined;
}

export function buildNanoGptRequestHeaders(params: {
  apiKey: string;
  config: NanoGptPluginConfig;
  routingMode: Exclude<NanoGptRoutingMode, "auto">;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${sanitizeApiKey(params.apiKey)}`,
  };

  const provider = resolveNanoGptSelectedProvider(params);
  if (provider) {
    headers["X-Provider"] = sanitizeHeaderValue(provider);
  }

  return headers;
}

export function resetNanoGptRoutingState(): void {
  subscriptionCache.clear();
}
