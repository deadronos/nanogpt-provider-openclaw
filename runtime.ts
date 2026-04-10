import {
  NANOGPT_BASE_URL,
  NANOGPT_FALLBACK_MODELS,
  NANOGPT_PERSONALIZED_BASE_URL,
  NANOGPT_PAID_BASE_URL,
  NANOGPT_SUBSCRIPTION_BASE_URL,
  buildNanoGptModelDefinition,
  type NanoGptCatalogSource,
  type NanoGptModelEntry,
  type NanoGptPluginConfig,
  type NanoGptRoutingMode,
} from "./models.js";

const SUBSCRIPTION_CACHE_TTL_MS = 60_000;

const subscriptionCache = new Map<string, { active: boolean; expiresAt: number }>();

export function getNanoGptConfig(config: unknown): NanoGptPluginConfig {
  if (!config || typeof config !== "object") {
    return {};
  }

  const candidate = config as Record<string, unknown>;
  const provider =
    typeof candidate.provider === "string" && candidate.provider.trim()
      ? candidate.provider.trim()
      : undefined;

  return {
    routingMode:
      candidate.routingMode === "auto" ||
      candidate.routingMode === "subscription" ||
      candidate.routingMode === "paygo"
        ? candidate.routingMode
        : undefined,
    catalogSource:
      candidate.catalogSource === "auto" ||
      candidate.catalogSource === "canonical" ||
      candidate.catalogSource === "subscription" ||
      candidate.catalogSource === "paid" ||
      candidate.catalogSource === "personalized"
        ? candidate.catalogSource
        : undefined,
    requestApi:
      candidate.requestApi === "auto" ||
      candidate.requestApi === "completions" ||
      candidate.requestApi === "responses"
        ? candidate.requestApi
        : undefined,
    ...(provider ? { provider } : {}),
  };
}

export function resolveNanoGptRequestApi(
  config: NanoGptPluginConfig,
): "openai-completions" | "openai-responses" {
  return config.requestApi === "responses" ? "openai-responses" : "openai-completions";
}

export async function probeNanoGptSubscription(apiKey: string): Promise<boolean> {
  const now = Date.now();
  const cached = subscriptionCache.get(apiKey);
  if (cached && cached.expiresAt > now) {
    return cached.active;
  }

  const response = await fetch(`${NANOGPT_SUBSCRIPTION_BASE_URL}/usage`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`NanoGPT subscription probe failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { subscribed?: boolean; active?: boolean };
  const active = Boolean(payload.subscribed ?? payload.active);
  subscriptionCache.set(apiKey, { active, expiresAt: now + SUBSCRIPTION_CACHE_TTL_MS });
  return active;
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
    return "paygo";
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

export function resolveRequestBaseUrl(routingMode: Exclude<NanoGptRoutingMode, "auto">): string {
  return routingMode === "subscription" ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL;
}

export async function discoverNanoGptModels(params: {
  apiKey: string;
  source: Exclude<NanoGptCatalogSource, "auto">;
}) {
  try {
    const url = new URL(`${resolveCatalogBaseUrl(params.source)}/models`);
    url.searchParams.set("detailed", "true");

    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
    });
    if (!response.ok) {
      return NANOGPT_FALLBACK_MODELS;
    }

    const payload = (await response.json()) as { data?: NanoGptModelEntry[] } | NanoGptModelEntry[];
    const entries = Array.isArray(payload)
      ? payload
      : Array.isArray(payload.data)
        ? payload.data
        : [];
    const models = entries
      .map((entry) => buildNanoGptModelDefinition(entry))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    return models.length > 0 ? models : NANOGPT_FALLBACK_MODELS;
  } catch {
    return NANOGPT_FALLBACK_MODELS;
  }
}

export function buildNanoGptRequestHeaders(params: {
  apiKey: string;
  config: NanoGptPluginConfig;
  routingMode: Exclude<NanoGptRoutingMode, "auto">;
}): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${params.apiKey}`,
  };

  if (params.config.provider) {
    headers["X-Provider"] = params.config.provider;
    if (params.routingMode === "subscription") {
      headers["X-Billing-Mode"] = "paygo";
    }
  }

  return headers;
}

export function resetNanoGptRuntimeState(): void {
  subscriptionCache.clear();
}
