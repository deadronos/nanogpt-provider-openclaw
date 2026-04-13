import {
  NANOGPT_BASE_URL,
  NANOGPT_DEFAULT_COST,
  NANOGPT_FALLBACK_MODELS,
  NANOGPT_PERSONALIZED_BASE_URL,
  NANOGPT_PAID_BASE_URL,
  NANOGPT_SUBSCRIPTION_BASE_URL,
  applyNanoGptProviderPricing,
  buildNanoGptModelDefinition,
  type NanoGptCatalogSource,
  type NanoGptModelEntry,
  type NanoGptModelPricing,
  type NanoGptPluginConfig,
  type NanoGptRoutingMode,
} from "./models.js";
import {
  clampPercent,
  fetchJson,
  type ProviderUsageSnapshot,
  type UsageWindow,
} from "openclaw/plugin-sdk/provider-usage";
import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";
import type {
  ProviderResolveDynamicModelContext,
  ProviderFetchUsageSnapshotContext,
  ProviderRuntimeModel,
  ProviderResolveUsageAuthContext,
} from "openclaw/plugin-sdk/plugin-entry";

const SUBSCRIPTION_CACHE_TTL_MS = 60_000;
const NANOGPT_USAGE_PROVIDER_ID = "nanogpt" as const;
const NANOGPT_USAGE_DISPLAY_NAME = "NanoGPT";
const NANOGPT_USAGE_URL = `${NANOGPT_SUBSCRIPTION_BASE_URL}/usage`;
const NANOGPT_PROVIDER_SELECTION_BASE_URL = "https://nano-gpt.com/api";
const NANOGPT_PROVIDER_PRICING_BATCH_SIZE = 8;

const subscriptionCache = new Map<string, { active: boolean; expiresAt: number }>();

type NanoGptUsageWindowPayload = Record<string, unknown> | number | string | undefined;

type NanoGptUsagePayload = {
  active?: unknown;
  state?: unknown;
  plan?: unknown;
  graceUntil?: unknown;
  daily?: NanoGptUsageWindowPayload;
  monthly?: NanoGptUsageWindowPayload;
  limits?: Record<string, unknown> | undefined;
  period?: Record<string, unknown> | undefined;
};

type NanoGptProviderPricingEntry = {
  provider?: unknown;
  pricing?: unknown;
  available?: unknown;
};

type NanoGptProviderPricingPayload = {
  supportsProviderSelection?: unknown;
  providers?: NanoGptProviderPricingEntry[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFiniteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function parseEpochMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? Math.floor(value * 1000) : Math.floor(value);
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeProviderId(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function normalizeComparableModelId(value: string): string {
  return value.trim().toLowerCase();
}

function stripNanoGptThinkingSuffix(value: string): string {
  return value.replace(/:(thinking|reasoning)$/i, "");
}

function resolveNanoGptDynamicModelTemplate(
  modelId: string,
  providerModels?: readonly ModelDefinitionConfig[],
) {
  const models = Array.isArray(providerModels) ? providerModels : [];
  if (models.length === 0) {
    return undefined;
  }

  const targetId = normalizeComparableModelId(modelId);
  const strippedTargetId = normalizeComparableModelId(stripNanoGptThinkingSuffix(modelId));

  return models.find((model) => {
    const candidateId = typeof model.id === "string" ? normalizeComparableModelId(model.id) : "";
    if (!candidateId) {
      return false;
    }
    return candidateId === targetId || candidateId === strippedTargetId;
  });
}

function buildNanoGptDynamicModelName(modelId: string, templateName?: string): string {
  if (templateName && /:(thinking|reasoning)$/i.test(modelId)) {
    return `${templateName} Thinking`;
  }
  return templateName ?? modelId;
}

function normalizeUsagePercent(value: number): number {
  return clampPercent(value <= 1 ? value * 100 : value);
}

function resolveNanoGptUsageWindow(params: {
  label: string;
  window: NanoGptUsageWindowPayload;
  limit?: unknown;
  fallbackResetAt?: unknown;
}): UsageWindow | null {
  const record = isRecord(params.window) ? params.window : {};
  const limit = parseFiniteNumber(params.limit) ?? parseFiniteNumber(record.limit) ?? parseFiniteNumber(record.total);
  const used =
    parseFiniteNumber(record.used) ?? parseFiniteNumber(record.usage) ?? parseFiniteNumber(record.consumed);
  const remaining =
    parseFiniteNumber(record.remaining) ??
    parseFiniteNumber(record.remain) ??
    parseFiniteNumber(record.left);
  const percentUsed =
    parseFiniteNumber(record.percentUsed) ??
    parseFiniteNumber(record.usedPercent) ??
    parseFiniteNumber(record.usagePercent) ??
    parseFiniteNumber(record.percent_used) ??
    parseFiniteNumber(record.used_percent);

  let usedPercent: number | undefined;
  if (typeof used === "number" && typeof limit === "number" && limit > 0) {
    usedPercent = clampPercent((used / limit) * 100);
  } else if (typeof remaining === "number" && typeof limit === "number" && limit > 0) {
    usedPercent = clampPercent(((limit - remaining) / limit) * 100);
  } else if (typeof percentUsed === "number") {
    usedPercent = normalizeUsagePercent(percentUsed);
  }

  if (typeof usedPercent !== "number") {
    return null;
  }

  const resetAt =
    parseEpochMillis(record.resetAt) ??
    parseEpochMillis(record.reset_at) ??
    parseEpochMillis(record.nextResetAt) ??
    parseEpochMillis(record.next_reset_at) ??
    parseEpochMillis(record.nextResetTime) ??
    parseEpochMillis(record.next_reset_time) ??
    parseEpochMillis(params.fallbackResetAt);

  return {
    label: params.label,
    usedPercent,
    ...(typeof resetAt === "number" ? { resetAt } : {}),
  };
}

function resolveNanoGptUsagePlan(payload: NanoGptUsagePayload): string | undefined {
  const state = typeof payload.state === "string" ? payload.state.trim() : "";
  if (state) {
    return state;
  }
  const plan = typeof payload.plan === "string" ? payload.plan.trim() : "";
  if (plan) {
    return plan;
  }
  return typeof payload.active === "boolean" ? (payload.active ? "active" : "inactive") : undefined;
}

function buildNanoGptUsageErrorSnapshot(error: string): ProviderUsageSnapshot {
  return {
    provider: NANOGPT_USAGE_PROVIDER_ID as ProviderUsageSnapshot["provider"],
    displayName: NANOGPT_USAGE_DISPLAY_NAME,
    windows: [],
    error,
  };
}

export function resolveNanoGptDynamicModel(
  ctx: ProviderResolveDynamicModelContext,
): ProviderRuntimeModel | undefined {
  const modelId = ctx.modelId.trim();
  if (!modelId) {
    return undefined;
  }

  const template = resolveNanoGptDynamicModelTemplate(modelId, ctx.providerConfig?.models);
  const reasoning = /:(thinking|reasoning)$/i.test(modelId) || template?.reasoning === true;
  const input = Array.isArray(template?.input) && template.input.length > 0 ? [...template.input] : ["text"];

  return {
    id: modelId,
    name: buildNanoGptDynamicModelName(modelId, template?.name),
    api: ctx.providerConfig?.api ?? "openai-completions",
    provider: "nanogpt",
    baseUrl: ctx.providerConfig?.baseUrl ?? NANOGPT_BASE_URL,
    reasoning,
    input,
    cost: template?.cost ?? { ...NANOGPT_DEFAULT_COST },
    contextWindow: template?.contextWindow ?? 200000,
    maxTokens: template?.maxTokens ?? 32768,
    ...(template?.compat ? { compat: { ...template.compat } } : {}),
  } as ProviderRuntimeModel;
}

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

  try {
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
  } catch (error) {
    subscriptionCache.set(apiKey, { active: false, expiresAt: now + 5000 });
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

export function resolveRequestBaseUrl(params: {
  config: NanoGptPluginConfig;
  routingMode: Exclude<NanoGptRoutingMode, "auto">;
}): string {
  if (params.config.requestApi === "responses" && params.routingMode === "subscription") {
    return NANOGPT_BASE_URL;
  }

  return params.routingMode === "subscription" ? NANOGPT_SUBSCRIPTION_BASE_URL : NANOGPT_BASE_URL;
}

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

export async function fetchNanoGptSelectedProviderPricing(params: {
  apiKey: string;
  modelId: string;
  provider: string;
}): Promise<NanoGptModelPricing | null> {
  const providerId = normalizeProviderId(params.provider);
  if (!providerId) {
    return null;
  }

  try {
    const url = new URL(
      `${NANOGPT_PROVIDER_SELECTION_BASE_URL}/models/${encodeURIComponent(params.modelId)}/providers`,
    );
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
    });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as NanoGptProviderPricingPayload | null;
    if (!payload || !isRecord(payload) || payload.supportsProviderSelection === false) {
      return null;
    }

    const providers = Array.isArray(payload.providers) ? payload.providers : [];
    const match = providers.find(
      (entry) =>
        isRecord(entry) &&
        normalizeProviderId(entry.provider) === providerId &&
        entry.available !== false,
    );
    return match && isRecord(match.pricing) ? (match.pricing as NanoGptModelPricing) : null;
  } catch {
    return null;
  }
}

async function applyNanoGptSelectedProviderPricing(params: {
  apiKey: string;
  provider?: string;
  models: NonNullable<Awaited<ReturnType<typeof buildNanoGptModelDefinition>>>[];
}) {
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

export async function resolveNanoGptUsageAuth(
  ctx: ProviderResolveUsageAuthContext,
): Promise<{ token: string } | null> {
  const token = ctx.resolveApiKeyFromConfigAndStore({
    providerIds: [NANOGPT_USAGE_PROVIDER_ID],
    envDirect: [ctx.env.NANOGPT_API_KEY],
  });
  return token ? { token } : null;
}

export async function fetchNanoGptUsageSnapshot(
  ctx: ProviderFetchUsageSnapshotContext,
): Promise<ProviderUsageSnapshot> {
  const response = await fetchJson(
    NANOGPT_USAGE_URL,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/json",
      },
    },
    ctx.timeoutMs,
    ctx.fetchFn,
  );

  if (!response.ok) {
    return buildNanoGptUsageErrorSnapshot(`HTTP ${response.status}${response.statusText ? `: ${response.statusText}` : ""}`);
  }

  const payload = (await response.json().catch(() => null)) as NanoGptUsagePayload | null;
  if (!payload || !isRecord(payload)) {
    return buildNanoGptUsageErrorSnapshot("Invalid JSON");
  }

  const limits = isRecord(payload.limits) ? payload.limits : {};
  const daily = resolveNanoGptUsageWindow({
    label: "Daily",
    window: payload.daily,
    limit: limits.daily,
    fallbackResetAt: isRecord(payload.period) ? payload.period.currentPeriodEnd : undefined,
  });
  const monthly = resolveNanoGptUsageWindow({
    label: "Monthly",
    window: payload.monthly,
    limit: limits.monthly,
    fallbackResetAt: isRecord(payload.period) ? payload.period.currentPeriodEnd : undefined,
  });
  const windows = [daily, monthly].filter((window): window is UsageWindow => window !== null);

  return {
    provider: NANOGPT_USAGE_PROVIDER_ID as ProviderUsageSnapshot["provider"],
    displayName: NANOGPT_USAGE_DISPLAY_NAME,
    ...(windows.length > 0 ? { windows } : { windows: [] }),
    ...(resolveNanoGptUsagePlan(payload) ? { plan: resolveNanoGptUsagePlan(payload) } : {}),
  };
}

export function resetNanoGptRuntimeState(): void {
  subscriptionCache.clear();
}
