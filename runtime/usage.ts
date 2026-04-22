import {
  clampPercent,
  fetchJson,
  type ProviderUsageSnapshot,
  type UsageWindow,
} from "openclaw/plugin-sdk/provider-usage";
import type {
  ProviderFetchUsageSnapshotContext,
  ProviderResolveUsageAuthContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { isRecord } from "../shared/guards.js";
import { parseEpochMillis, parseFiniteNumber } from "../shared/parse.js";
import { sanitizeApiKey } from "../shared/http.js";

const NANOGPT_USAGE_PROVIDER_ID = "nanogpt" as const;
const NANOGPT_USAGE_DISPLAY_NAME = "NanoGPT";
const NANOGPT_USAGE_URL = "https://nano-gpt.com/api/subscription/v1/usage";

type NanoGptUsageWindowPayload = Record<string, unknown> | number | string | undefined;

type NanoGptUsagePayload = {
  subscribed?: unknown;
  active?: unknown;
  state?: unknown;
  plan?: unknown;
  graceUntil?: unknown;
  daily?: NanoGptUsageWindowPayload;
  monthly?: NanoGptUsageWindowPayload;
  limits?: Record<string, unknown> | undefined;
  period?: Record<string, unknown> | undefined;
};

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
        Authorization: `Bearer ${sanitizeApiKey(ctx.token)}`,
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
