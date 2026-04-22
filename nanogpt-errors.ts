import { isRecord } from "./shared/guards.js";

type NanoGptFailoverReason =
  | "auth"
  | "auth_permanent"
  | "format"
  | "rate_limit"
  | "overloaded"
  | "billing"
  | "timeout"
  | "model_not_found"
  | "session_expired"
  | "unknown";

type NanoGptRecognizedEnvelope = "openai" | "anthropic" | "legacy" | "sse";

export type NanoGptRecognizedError = {
  envelope: NanoGptRecognizedEnvelope;
  status?: number;
  type?: string;
  code?: string;
  message?: string;
  param?: string;
  retryAfterSeconds?: number;
  raw: string;
};

export type NanoGptUnknownStructuredError = {
  envelope: "unknown_structured";
  status?: number;
  type?: string;
  code?: string;
  message?: string;
  jsonKeys: string[];
  raw: string;
};

export type NanoGptErrorSurfaceInspection =
  | {
      kind: "mapped";
      reason: NanoGptFailoverReason;
      error: NanoGptRecognizedError;
    }
  | {
      kind: "context_overflow";
      error: NanoGptRecognizedError;
    }
  | {
      kind: "recognized_unmapped";
      error: NanoGptRecognizedError;
    }
  | {
      kind: "unknown_structured";
      error: NanoGptUnknownStructuredError;
    };

const FORMAT_ERROR_CODES = new Set([
  "missing_required_parameter",
  "invalid_parameter_value",
  "invalid_json",
  "invalid_json_schema",
  "tool_choice_unsupported",
  "image_input_not_supported",
  "content_policy_violation",
  "empty_response",
  "no_fallback_available",
  "fallback_blocked_for_cache_consistency",
]);

const BILLING_ERROR_CODES = new Set([
  "insufficient_quota",
  "memory_balance_required",
  "websearch_balance_required",
  "both_balance_required",
]);

const RATE_LIMIT_ERROR_CODES = new Set([
  "rate_limit_exceeded",
  "daily_rpd_limit_exceeded",
  "daily_usd_limit_exceeded",
]);

const MODEL_NOT_FOUND_ERROR_CODES = new Set([
  "model_not_found",
  "model_not_allowed",
  "model_not_available",
]);

const RATE_LIMIT_HINTS = [
  "rate limit",
  "too many requests",
  "quota limit",
  "usage limit",
  "automatic quota refresh",
  "rolling time window",
  "daily",
  "weekly",
  "monthly",
  "try again",
  "retry",
] as const;

const BILLING_HINTS = [
  "insufficient balance",
  "insufficient quota",
  "insufficient credits",
  "credit balance",
  "plans & billing",
  "top up",
  "add more credits",
  "payment required",
  "balance required",
] as const;

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function readStatus(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return undefined;
}

function readRetryAfterSeconds(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeNanoGptErrorToken(value: string | undefined): string | undefined {
  return value?.trim().toLowerCase();
}

function extractLeadingHttpStatus(raw: string): number | undefined {
  const match = raw.match(/^\s*(?:http\s*)?(\d{3})\b/i);
  return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
}

function extractJsonRecord(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const candidates = [trimmed];
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      // Ignore parse failures and keep trying narrower candidates.
    }
  }

  return null;
}

function looksLikeNanoGptErrorishRecord(value: Record<string, unknown>): boolean {
  return ["error", "message", "status", "type", "code"].some((key) => key in value);
}

function parseRecognizedNanoGptError(raw: string): NanoGptRecognizedError | null {
  const statusFromLeadingText = extractLeadingHttpStatus(raw);
  const record = extractJsonRecord(raw);
  if (!record) {
    return null;
  }

  if (isRecord(record.error)) {
    const nested = record.error;
    const message = readString(nested.message);
    const type = readString(nested.type);
    const code = readString(nested.code);
    const param = readString(nested.param);
    if (message || type || code || param) {
      return {
        envelope: record.type === "error" ? "anthropic" : "openai",
        status: readStatus(record.status) ?? statusFromLeadingText,
        type,
        code,
        message,
        param,
        retryAfterSeconds:
          readRetryAfterSeconds(nested.retryAfter) ??
          readRetryAfterSeconds(nested.retry_after) ??
          readRetryAfterSeconds(record.retryAfter) ??
          readRetryAfterSeconds(record.retry_after),
        raw,
      };
    }
  }

  if (typeof record.error === "string" || typeof record.message === "string") {
    const legacyMessage = readString(record.error) ?? readString(record.message);
    const legacyStatus = readStatus(record.status) ?? statusFromLeadingText;
    if (legacyMessage) {
      return {
        envelope: "legacy",
        status: legacyStatus,
        message: legacyMessage,
        type: readString(record.type),
        code: readString(record.code),
        param: readString(record.param),
        retryAfterSeconds:
          readRetryAfterSeconds(record.retryAfter) ?? readRetryAfterSeconds(record.retry_after),
        raw,
      };
    }
  }

  const sseMessage = readString(record.message);
  const sseStatus = readStatus(record.status) ?? statusFromLeadingText;
  const sseCode = readString(record.code);
  if (sseMessage || sseCode) {
    return {
      envelope: "sse",
      status: sseStatus,
      message: sseMessage,
      type: readString(record.type),
      code: sseCode,
      param: readString(record.param),
      retryAfterSeconds:
        readRetryAfterSeconds(record.retryAfter) ?? readRetryAfterSeconds(record.retry_after),
      raw,
    };
  }

  return null;
}

function parseUnknownNanoGptStructuredError(raw: string): NanoGptUnknownStructuredError | null {
  const statusFromLeadingText = extractLeadingHttpStatus(raw);
  const record = extractJsonRecord(raw);
  if (!record || !looksLikeNanoGptErrorishRecord(record)) {
    return null;
  }

  const nested = isRecord(record.error) ? record.error : undefined;
  return {
    envelope: "unknown_structured",
    status: readStatus(record.status) ?? readStatus(nested?.status) ?? statusFromLeadingText,
    type: readString(nested?.type) ?? readString(record.type),
    code: readString(nested?.code) ?? readString(record.code),
    message:
      readString(nested?.message) ??
      readString(record.message) ??
      readString(record.error),
    jsonKeys: Object.keys(record).sort(),
    raw,
  };
}

function includesAnyHint(value: string, hints: readonly string[]): boolean {
  return hints.some((hint) => value.includes(hint));
}

function hasBillingSignal(error: {
  code?: string;
  message?: string;
  status?: number;
}): boolean {
  const normalizedCode = normalizeNanoGptErrorToken(error.code);
  if (normalizedCode && BILLING_ERROR_CODES.has(normalizedCode)) {
    return true;
  }

  const normalizedMessage = normalizeNanoGptErrorToken(error.message);
  if (normalizedMessage && includesAnyHint(normalizedMessage, BILLING_HINTS)) {
    return true;
  }

  return error.status === 402 && normalizedMessage === "insufficient balance";
}

function hasRateLimitSignal(error: {
  code?: string;
  message?: string;
  status?: number;
}): boolean {
  const normalizedCode = normalizeNanoGptErrorToken(error.code);
  if (normalizedCode && RATE_LIMIT_ERROR_CODES.has(normalizedCode)) {
    return true;
  }

  const normalizedMessage = normalizeNanoGptErrorToken(error.message);
  if (normalizedMessage && includesAnyHint(normalizedMessage, RATE_LIMIT_HINTS)) {
    return true;
  }

  return error.status === 429;
}

function mapNanoGptRecognizedError(
  error: NanoGptRecognizedError,
): NanoGptFailoverReason | "context_overflow" | null {
  const normalizedCode = normalizeNanoGptErrorToken(error.code);
  const normalizedType = normalizeNanoGptErrorToken(error.type);

  if (normalizedCode === "context_length_exceeded") {
    return "context_overflow";
  }
  if (normalizedCode && FORMAT_ERROR_CODES.has(normalizedCode)) {
    return "format";
  }
  if (normalizedCode && BILLING_ERROR_CODES.has(normalizedCode)) {
    return "billing";
  }
  if (normalizedCode && RATE_LIMIT_ERROR_CODES.has(normalizedCode)) {
    return "rate_limit";
  }
  if (normalizedCode && MODEL_NOT_FOUND_ERROR_CODES.has(normalizedCode)) {
    return "model_not_found";
  }
  if (normalizedCode === "all_fallbacks_failed") {
    return null;
  }

  if (normalizedType === "authentication_error") {
    return "auth";
  }
  if (normalizedType === "permission_denied_error" || normalizedType === "permission_error") {
    return "auth";
  }
  if (normalizedType === "not_found_error") {
    return "model_not_found";
  }
  if (normalizedType === "rate_limit_error") {
    return "rate_limit";
  }
  if (normalizedType === "service_unavailable") {
    return "overloaded";
  }
  if (normalizedType === "invalid_request_error") {
    return "format";
  }
  if (normalizedType === "server_error" || normalizedType === "api_error") {
    return error.status === 503 ? "overloaded" : "timeout";
  }

  switch (error.status) {
    case 400:
    case 413:
    case 422:
      return "format";
    case 401:
      return "auth";
    case 402:
      if (hasBillingSignal(error)) {
        return "billing";
      }
      if (hasRateLimitSignal(error)) {
        return "rate_limit";
      }
      return null;
    case 403:
      return "auth";
    case 404:
      return "model_not_found";
    case 408:
    case 504:
      return "timeout";
    case 429:
      return "rate_limit";
    case 500:
      return "timeout";
    case 503:
      return "overloaded";
    default:
      return null;
  }
}

export function inspectNanoGptErrorSurface(raw: string): NanoGptErrorSurfaceInspection | null {
  const recognized = parseRecognizedNanoGptError(raw);
  if (recognized) {
    const mapped = mapNanoGptRecognizedError(recognized);
    if (mapped === "context_overflow") {
      return {
        kind: "context_overflow",
        error: recognized,
      };
    }
    if (mapped) {
      return {
        kind: "mapped",
        reason: mapped,
        error: recognized,
      };
    }
    return {
      kind: "recognized_unmapped",
      error: recognized,
    };
  }

  const unknown = parseUnknownNanoGptStructuredError(raw);
  if (unknown) {
    return {
      kind: "unknown_structured",
      error: unknown,
    };
  }

  return null;
}

export function formatNanoGptErrorSurfaceDetails(error: {
  envelope: string;
  status?: number;
  type?: string;
  code?: string;
  param?: string;
  retryAfterSeconds?: number;
}): string {
  const parts = [`envelope=${error.envelope}`];
  if (typeof error.status === "number") {
    parts.push(`status=${error.status}`);
  }
  if (error.type) {
    parts.push(`type=${error.type}`);
  }
  if (error.code) {
    parts.push(`code=${error.code}`);
  }
  if (error.param) {
    parts.push(`param=${error.param}`);
  }
  if (typeof error.retryAfterSeconds === "number") {
    parts.push(`retryAfter=${error.retryAfterSeconds}s`);
  }
  return parts.join(", ");
}
