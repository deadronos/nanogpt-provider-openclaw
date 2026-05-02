import type { NanoGptPluginConfig } from "../models.js";
import type { AnyAgentTool, ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";
import {
  resolveNanoGptModelIdentity,
} from "./anomaly-types.js";
import { isRecord } from "../shared/guards.js";
import { buildNanoGptBridgeRetrySystemMessage } from "./bridge/retry.js";
import { createNanoGptLoggerSync } from "./nanogpt-logger.js";
import {
  buildNanoGptBridgeFailureMessage,
  rewriteNanoGptBridgeMessage,
} from "./stream/bridge.js";
import { collectNanoGptRequestToolMetadata } from "./stream/inspection.js";
import {
  ensureIncludeUsageInStreamingPayload,
  injectNanoGptBridgePayload,
  maybeInjectNanoGptResponseFormat,
  resolveNanoGptBridgeProtocol,
  shouldApplyNanoGptBridge,
} from "./stream/payload.js";
import { replayNanoGptAssistantMessage } from "./stream/replay.js";
import type {
  NanoGptPluginLogger,
  NanoGptWrappedStreamFn,
} from "./stream/types.js";
import {
  createNanoGptStreamAnomalyLogger,
  scheduleNanoGptStreamResultWarnings,
} from "./stream/warnings.js";

export function wrapNanoGptStreamFn(
  ctx: ProviderWrapStreamFnContext,
  logger?: NanoGptPluginLogger,
  resolvedConfig?: NanoGptPluginConfig,
): NanoGptWrappedStreamFn {
  if (ctx.streamFn) {
    const streamFn = ctx.streamFn;
    const modelApi = ctx.model?.api;
    if (modelApi !== "openai-completions") {
      return streamFn;
    }

    const nanogptLogger = createNanoGptLoggerSync("stream-hooks");
    const warnNanoGptAnomaly = createNanoGptStreamAnomalyLogger(logger);
    const { modelId, modelFamily } = resolveNanoGptModelIdentity({
      modelId: ctx.modelId,
      model: ctx.model,
    });

    const modelCompat = ctx.model?.compat;
    const shouldForceIncludeUsage = !(isRecord(modelCompat) && modelCompat.supportsUsageInStreaming === false);

    return async (model, context, options) => {
      let requestedIncludeUsage = false;
      const upstreamOnPayload = options?.onPayload;
      const requestToolMetadata = collectNanoGptRequestToolMetadata(context);
      const requestTools = Array.isArray((context as any)?.tools) ? ((context as any).tools as AnyAgentTool[]) : [];
      const bridgeEnabled = shouldApplyNanoGptBridge(resolvedConfig, requestToolMetadata);
      const bridgeProtocol = resolveNanoGptBridgeProtocol(resolvedConfig);

      const runAttempt = async (retryMessage?: string) => {
        const patchedOptions = {
          ...options,
          onPayload: async (payload: unknown, payloadModel: unknown) => {
            const upstreamPayload =
              typeof upstreamOnPayload === "function"
                ? ((await upstreamOnPayload(payload, payloadModel as never)) ?? payload)
                : payload;

            const ensured = ensureIncludeUsageInStreamingPayload(upstreamPayload, shouldForceIncludeUsage);
            if (ensured.requested) {
              requestedIncludeUsage = true;
            }

            let nextPayload = maybeInjectNanoGptResponseFormat(
              ensured.payload ?? upstreamPayload,
              requestToolMetadata.toolEnabled ? resolvedConfig?.responseFormat : undefined,
            );

            if (bridgeEnabled) {
              nextPayload = injectNanoGptBridgePayload({
                payload: nextPayload,
                tools: requestTools,
                protocol: bridgeProtocol,
                retryMessage,
              });
            }

            return nextPayload;
          },
        };

        return await streamFn(model, context, patchedOptions);
      };

      let stream = await runAttempt();
      nanogptLogger.info("stream result received", { modelId, family: modelFamily, bridgeEnabled });
      if (bridgeEnabled) {
        let finalMessage = await stream.result();
        let rewrittenMessage = rewriteNanoGptBridgeMessage({
          finalMessage,
          protocol: bridgeProtocol,
          tools: requestTools,
        });

        if (!rewrittenMessage) {
          nanogptLogger.warn("bridge failed to parse, retrying", { modelId });
          stream = await runAttempt(buildNanoGptBridgeRetrySystemMessage(bridgeProtocol));
          finalMessage = await stream.result();
          rewrittenMessage = rewriteNanoGptBridgeMessage({
            finalMessage,
            protocol: bridgeProtocol,
            tools: requestTools,
          });
          stream = replayNanoGptAssistantMessage(rewrittenMessage ?? buildNanoGptBridgeFailureMessage(finalMessage));
        } else if (rewrittenMessage !== finalMessage) {
          stream = replayNanoGptAssistantMessage(rewrittenMessage);
        } else {
          stream = replayNanoGptAssistantMessage(finalMessage);
        }
      }

      scheduleNanoGptStreamResultWarnings({
        stream,
        logger,
        nanogptLogger,
        warnNanoGptAnomaly,
        modelId,
        modelFamily,
        transportApi: modelApi,
        requestedIncludeUsage,
        requestToolMetadata,
      });

      return stream as any;
    };
  }
  return undefined;
}
