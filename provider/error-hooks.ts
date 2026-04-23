import { createNanoGptLogger, createNanoGptLoggerSync } from "./nanogpt-logger.js";
import type { NanoGptPluginConfig } from "../models.js";
import {
  createNanoGptWarnOnceLogger as createNanoGptSharedWarnOnceLogger,
  summarizeNanoGptFreeformMessage,
} from "./anomaly-logger.js";
import { detectNanoGptModelFamily } from "./anomaly-types.js";
import {
  formatNanoGptErrorSurfaceDetails,
  inspectNanoGptErrorSurface,
} from "../nanogpt-errors.js";
import type { ProviderFailoverErrorContext } from "openclaw/plugin-sdk/plugin-entry";

type FailoverReason =
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

type NanoGptErrorSurfaceWarningParams = {
  modelId?: string;
  kind: "mapped" | "context_overflow" | "recognized_unmapped" | "unknown_structured";
  details: string;
  message?: string;
  reason?: string;
};

type NanoGptErrorSurfaceWarnFn = (params: NanoGptErrorSurfaceWarningParams) => void;

export function summarizeNanoGptErrorMessage(message: string | undefined): string {
  return summarizeNanoGptFreeformMessage(message);
}

function buildNanoGptErrorSurfaceSignature(
  resolvedNanoGptConfig: NanoGptPluginConfig,
  params: NanoGptErrorSurfaceWarningParams,
): string {
  const modelId = params.modelId?.trim() || "(unknown model)";
  const modelFamily = detectNanoGptModelFamily(modelId);
  const routingMode = resolvedNanoGptConfig.routingMode ?? "auto";
  const providerOverride = resolvedNanoGptConfig.provider?.trim() || "auto";
  return [
    params.kind,
    params.reason ?? "",
    modelId,
    modelFamily,
    routingMode,
    providerOverride,
    params.details,
  ].join("|");
}

function formatNanoGptErrorSurfaceWarning(
  resolvedNanoGptConfig: NanoGptPluginConfig,
  warning: NanoGptErrorSurfaceWarningParams,
): string {
  const modelId = warning.modelId?.trim() || "(unknown model)";
  const modelFamily = detectNanoGptModelFamily(modelId);
  const routingMode = resolvedNanoGptConfig.routingMode ?? "auto";
  const providerOverride = resolvedNanoGptConfig.provider?.trim() || "auto";
  const context = `[${warning.details}, routingMode=${routingMode}, providerOverride=${providerOverride}, family=${modelFamily}]`;
  const summary = summarizeNanoGptErrorMessage(warning.message);

  if (warning.kind === "mapped") {
    return `NanoGPT API error classified as ${warning.reason} for model ${modelId} ${context}: ${summary}`;
  }

  if (warning.kind === "context_overflow") {
    return `NanoGPT API error matched OpenClaw context overflow handling for model ${modelId} ${context}: ${summary}`;
  }

  if (warning.kind === "recognized_unmapped") {
    return `NanoGPT API error recognized but not mapped to an OpenClaw failover reason for model ${modelId} ${context}: ${summary}. Falling back to OpenClaw generic classification.`;
  }

  return `Unknown NanoGPT API error envelope for model ${modelId} ${context}: ${summary}. Falling back to OpenClaw generic classification.`;
}

export function createNanoGptWarnOnceLogger(params: {
  logger: { warn: (message: string) => void };
  resolvedNanoGptConfig: NanoGptPluginConfig;
}): NanoGptErrorSurfaceWarnFn {
  return createNanoGptSharedWarnOnceLogger({
    logger: params.logger,
    buildSignature: (warning) => buildNanoGptErrorSurfaceSignature(params.resolvedNanoGptConfig, warning),
    formatMessage: (warning) => formatNanoGptErrorSurfaceWarning(params.resolvedNanoGptConfig, warning),
  });
}

export function matchesContextOverflowError(
  ctx: ProviderFailoverErrorContext,
  warnNanoGptErrorSurface: NanoGptErrorSurfaceWarnFn,
): boolean | undefined {
  const inspection = inspectNanoGptErrorSurface(ctx.errorMessage);
  if (inspection?.kind !== "context_overflow") {
    return undefined;
  }

  warnNanoGptErrorSurface({
    modelId: ctx.modelId,
    kind: inspection.kind,
    details: formatNanoGptErrorSurfaceDetails(inspection.error),
    message: inspection.error.message ?? ctx.errorMessage,
  });
  return true;
}

export function classifyFailoverReason(
  ctx: ProviderFailoverErrorContext,
  warnNanoGptErrorSurface: NanoGptErrorSurfaceWarnFn,
): FailoverReason | null | undefined {
  const inspection = inspectNanoGptErrorSurface(ctx.errorMessage);
  if (!inspection) {
    return undefined;
  }

  if (inspection.kind === "mapped") {
    warnNanoGptErrorSurface({
      modelId: ctx.modelId,
      kind: inspection.kind,
      reason: inspection.reason,
      details: formatNanoGptErrorSurfaceDetails(inspection.error),
      message: inspection.error.message ?? ctx.errorMessage,
    });
    return inspection.reason;
  }

  warnNanoGptErrorSurface({
    modelId: ctx.modelId,
    kind: inspection.kind,
    details: formatNanoGptErrorSurfaceDetails(inspection.error),
    message: inspection.error.message ?? ctx.errorMessage,
  });
  return undefined;
}

export function createNanoGptErrorSurfaceHooks(params: {
  logger: { warn: (message: string) => void };
  resolvedNanoGptConfig: NanoGptPluginConfig;
}): {
  warnNanoGptErrorSurface: NanoGptErrorSurfaceWarnFn;
  matchesContextOverflowError: (ctx: ProviderFailoverErrorContext) => boolean | undefined;
  classifyFailoverReason: (ctx: ProviderFailoverErrorContext) => FailoverReason | null | undefined;
} {
  const nanogptLogger = createNanoGptLoggerSync("error-hooks");
  nanogptLogger.info("error surface hooks created", {
    routingMode: params.resolvedNanoGptConfig.routingMode,
    bridgeMode: params.resolvedNanoGptConfig.bridgeMode,
  });
  const warnNanoGptErrorSurface = createNanoGptWarnOnceLogger(params);
  return {
    warnNanoGptErrorSurface,
    matchesContextOverflowError: (ctx) => {
      const result = matchesContextOverflowError(ctx, warnNanoGptErrorSurface);
      if (result === true) {
        nanogptLogger.warn("context overflow error matched", { modelId: ctx.modelId });
      }
      return result;
    },
    classifyFailoverReason: (ctx) => {
      const inspection = inspectNanoGptErrorSurface(ctx.errorMessage);
      const result = classifyFailoverReason(ctx, warnNanoGptErrorSurface);
      if (inspection?.kind === "mapped" && inspection.reason) {
        nanogptLogger.warn(`error mapped to failover reason`, {
          modelId: ctx.modelId,
          reason: inspection.reason,
        });
      } else if (inspection && inspection.kind !== "mapped") {
        nanogptLogger.warn(`error not mapped`, {
          modelId: ctx.modelId,
          kind: inspection.kind,
        });
      }
      return result;
    },
  };
}
