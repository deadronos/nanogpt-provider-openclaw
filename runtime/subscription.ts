export type NanoGptSubscriptionPayload = {
  subscribed?: unknown;
  active?: unknown;
  state?: unknown;
  plan?: unknown;
  graceUntil?: unknown;
};

export function resolveNanoGptSubscriptionState(value: unknown): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "active" ||
    normalized === "subscribed" ||
    normalized === "grace" ||
    normalized === "grace_period" ||
    normalized === "grace-period" ||
    normalized === "trial" ||
    normalized === "trialing"
  ) {
    return true;
  }

  if (
    normalized === "inactive" ||
    normalized === "expired" ||
    normalized === "unsubscribed" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "none"
  ) {
    return false;
  }

  return undefined;
}

export function hasNanoGptFutureGracePeriod(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > Date.now();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) && parsed > Date.now();
  }
  return false;
}

export function resolveNanoGptSubscriptionActive(payload: NanoGptSubscriptionPayload): boolean {
  const subscribed = typeof payload.subscribed === "boolean" ? payload.subscribed : undefined;
  const active = typeof payload.active === "boolean" ? payload.active : undefined;
  const state = resolveNanoGptSubscriptionState(payload.state);
  const plan = resolveNanoGptSubscriptionState(payload.plan);

  if (subscribed === true || active === true || state === true || plan === true) {
    return true;
  }

  if (hasNanoGptFutureGracePeriod(payload.graceUntil)) {
    return true;
  }

  if (subscribed === false || active === false || state === false || plan === false) {
    return false;
  }

  return false;
}
