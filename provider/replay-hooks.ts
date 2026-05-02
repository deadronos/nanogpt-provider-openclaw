import type {
  ProviderReasoningOutputMode,
  ProviderReasoningOutputModeContext,
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
  ProviderSanitizeReplayHistoryContext,
  ProviderValidateReplayTurnsContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { buildOpenAICompatibleReplayPolicy } from "openclaw/plugin-sdk/provider-model-shared";
import type { NanoGptWarnLogger } from "./anomaly-logger.js";
import { createNanoGptLoggerSync } from "./nanogpt-logger.js";
import {
  isNanoGptTaggedReasoningOutputMode,
  resolveNanoGptReplayTransportApi,
} from "./replay/inspection.js";
import { sanitizeReplayHistory as sanitizeNanoGptReplayHistory } from "./replay/sanitize.js";
import type { NanoGptReplayWarnFn } from "./replay/types.js";
import { validateReplayTurns as validateNanoGptReplayTurns } from "./replay/validate.js";
import { createNanoGptReplayAnomalyLogger } from "./replay/warnings.js";

export function buildReplayPolicy(
  context: ProviderReplayPolicyContext,
): ProviderReplayPolicy | undefined {
  return buildOpenAICompatibleReplayPolicy(resolveNanoGptReplayTransportApi(context));
}

export function resolveReasoningOutputMode(
  context: ProviderReasoningOutputModeContext,
): ProviderReasoningOutputMode {
  return isNanoGptTaggedReasoningOutputMode(context) ? "tagged" : "native";
}

export function sanitizeReplayHistory(
  context: ProviderSanitizeReplayHistoryContext,
  warnNanoGptAnomaly?: NanoGptReplayWarnFn,
): ProviderSanitizeReplayHistoryContext["messages"] | null | undefined {
  return sanitizeNanoGptReplayHistory(context, warnNanoGptAnomaly);
}

export function validateReplayTurns(
  context: ProviderValidateReplayTurnsContext,
  warnNanoGptAnomaly?: NanoGptReplayWarnFn,
): ProviderValidateReplayTurnsContext["messages"] | null | undefined {
  return validateNanoGptReplayTurns(context, warnNanoGptAnomaly);
}

export function createNanoGptReplayHooks(params: { logger?: NanoGptWarnLogger }): {
  buildReplayPolicy: (context: ProviderReplayPolicyContext) => ProviderReplayPolicy | undefined;
  sanitizeReplayHistory: (
    context: ProviderSanitizeReplayHistoryContext,
  ) => ProviderSanitizeReplayHistoryContext["messages"] | null | undefined;
  validateReplayTurns: (
    context: ProviderValidateReplayTurnsContext,
  ) => ProviderValidateReplayTurnsContext["messages"] | null | undefined;
  resolveReasoningOutputMode: (
    context: ProviderReasoningOutputModeContext,
  ) => ProviderReasoningOutputMode;
} {
  const nanogptLogger = createNanoGptLoggerSync("replay-hooks");
  nanogptLogger.info("replay hooks created");
  const warnNanoGptAnomaly = createNanoGptReplayAnomalyLogger(params.logger);

  return {
    buildReplayPolicy: (ctx) => {
      const policy = buildReplayPolicy(ctx);
      nanogptLogger.info("replay policy built", { modelId: ctx.modelId });
      return policy;
    },
    sanitizeReplayHistory: (context) => sanitizeReplayHistory(context, warnNanoGptAnomaly),
    validateReplayTurns: (context) => validateReplayTurns(context, warnNanoGptAnomaly),
    resolveReasoningOutputMode,
  };
}
