import {
  createNanoGptAnomalyWarnOnceLogger,
  type NanoGptAnomalyWarning,
} from "../anomaly-logger.js";
import {
  buildNanoGptExpectedShapeSummary,
  buildNanoGptObservedShapeSummary,
  type NanoGptModelFamily,
} from "../anomaly-types.js";
import {
  collectNanoGptStreamMarkerInspection,
  type NanoGptStreamMarkerInspection,
} from "../inspection.js";
import type { NanoGptLogger } from "../nanogpt-logger.js";
import { isRecord } from "../../shared/guards.js";
import {
  collectNanoGptStreamContentInspection,
} from "./inspection.js";
import type {
  NanoGptPluginLogger,
  NanoGptRequestToolMetadata,
  NanoGptUsage,
} from "./types.js";

type NanoGptStreamWarnFn = (warning: NanoGptAnomalyWarning) => void;

const NANO_GPT_STREAM_ANOMALY_LOGGER_CACHE = new WeakMap<
  NanoGptPluginLogger,
  NanoGptStreamWarnFn
>();

function buildNanoGptExpectedToolRequestShapeSummary(
  requestToolMetadata: NanoGptRequestToolMetadata,
) {
  return buildNanoGptExpectedShapeSummary({
    headline: requestToolMetadata.toolEnabled ? "tool-enabled request" : "tool-free request",
    counts: {
      toolCount: requestToolMetadata.toolCount,
    },
    groups:
      requestToolMetadata.toolNames.length > 0
        ? [{ label: "toolNames", values: requestToolMetadata.toolNames }]
        : undefined,
  });
}

function buildNanoGptObservedStreamShapeSummary(params: {
  headline: string;
  counts?: Record<string, number>;
  markerNames?: readonly string[];
}) {
  return buildNanoGptObservedShapeSummary({
    headline: params.headline,
    counts: params.counts,
    groups:
      params.markerNames && params.markerNames.length > 0
        ? [{ label: "markers", values: params.markerNames }]
        : undefined,
  });
}

function emitNanoGptStreamAnomaly(params: {
  warnNanoGptAnomaly: NanoGptStreamWarnFn;
  kind: NanoGptAnomalyWarning["kind"];
  modelId: string;
  modelFamily: NanoGptModelFamily;
  transportApi?: string;
  requestToolMetadata: NanoGptRequestToolMetadata;
  observedHeadline: string;
  observedCounts?: Record<string, number>;
  observedMarkerNames?: readonly string[];
  finishReason?: string;
}): void {
  params.warnNanoGptAnomaly({
    kind: params.kind,
    stage: "stream_result",
    providerId: "nanogpt",
    modelId: params.modelId,
    modelFamily: params.modelFamily,
    transportApi: params.transportApi,
    expectedShapeSummary: buildNanoGptExpectedToolRequestShapeSummary(
      params.requestToolMetadata,
    ),
    observedShapeSummary: buildNanoGptObservedStreamShapeSummary({
      headline: params.observedHeadline,
      counts: params.observedCounts,
      markerNames: params.observedMarkerNames,
    }),
    metadata: {
      toolNames: params.requestToolMetadata.toolNames,
      toolCount: params.requestToolMetadata.toolCount,
      finishReason: params.finishReason,
      markerNames: params.observedMarkerNames,
    },
  });
}

function shouldWarnNanoGptToolEnabledTurnWithoutToolCall(params: {
  inspection: NonNullable<ReturnType<typeof collectNanoGptStreamContentInspection>>;
  markerInspection: NanoGptStreamMarkerInspection;
}): boolean {
  return (
    params.inspection.visibleTextLength === 0 ||
    params.markerInspection.toolLikeMarkers.length > 0
  );
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function inspectUsage(usage: unknown): { empty: boolean; invalidFields: string[] } {
  if (!isRecord(usage)) {
    return { empty: true, invalidFields: ["usage"] };
  }

  const invalidFields: string[] = [];
  const numericFields: Array<keyof NanoGptUsage> = [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "totalTokens",
  ];
  for (const field of numericFields) {
    if (!isFiniteNonNegativeNumber(usage[field])) {
      invalidFields.push(`usage.${field}`);
    }
  }

  if (!isRecord(usage.cost)) {
    invalidFields.push("usage.cost");
  } else {
    const costFields: Array<keyof NanoGptUsage["cost"]> = [
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "total",
    ];
    for (const field of costFields) {
      if (!isFiniteNonNegativeNumber(usage.cost[field])) {
        invalidFields.push(`usage.cost.${field}`);
      }
    }
  }

  const empty =
    invalidFields.length === 0 &&
    usage.input === 0 &&
    usage.output === 0 &&
    usage.cacheRead === 0 &&
    usage.cacheWrite === 0 &&
    usage.totalTokens === 0 &&
    isRecord(usage.cost) &&
    usage.cost.input === 0 &&
    usage.cost.output === 0 &&
    usage.cost.cacheRead === 0 &&
    usage.cost.cacheWrite === 0 &&
    usage.cost.total === 0;

  return { empty, invalidFields };
}

export function createNanoGptStreamAnomalyLogger(
  logger?: NanoGptPluginLogger,
): NanoGptStreamWarnFn | undefined {
  if (!logger?.warn) {
    return undefined;
  }

  const cachedLogger = NANO_GPT_STREAM_ANOMALY_LOGGER_CACHE.get(logger);
  if (cachedLogger) {
    return cachedLogger;
  }

  const warnOnceLogger = createNanoGptAnomalyWarnOnceLogger({
    logger: {
      warn: (message: string) => logger.warn?.(message),
    },
  });

  NANO_GPT_STREAM_ANOMALY_LOGGER_CACHE.set(logger, warnOnceLogger);
  return warnOnceLogger;
}

export function scheduleNanoGptStreamResultWarnings(params: {
  stream: unknown;
  logger?: NanoGptPluginLogger;
  nanogptLogger?: NanoGptLogger;
  warnNanoGptAnomaly?: NanoGptStreamWarnFn;
  modelId: string;
  modelFamily: NanoGptModelFamily;
  transportApi?: string;
  requestedIncludeUsage: boolean;
  requestToolMetadata: NanoGptRequestToolMetadata;
}): void {
  const streamWithResult = params.stream as { result?: () => Promise<unknown> };
  if (!params.stream || typeof streamWithResult.result !== "function") {
    return;
  }

  void streamWithResult
    .result()
    .then((finalMessage: unknown) => {
      if (params.requestedIncludeUsage && isRecord(finalMessage)) {
        const { empty, invalidFields } = inspectUsage(finalMessage.usage);
        if (empty || invalidFields.length > 0) {
          params.logger?.warn?.(
            `[nanogpt] requested stream_options.include_usage but received ${
              empty ? "empty" : "invalid"
            } usage in stream result`,
            {
              modelId: params.modelId,
              ...(invalidFields.length > 0 ? { invalidFields } : {}),
            },
          );
          params.nanogptLogger?.warn(
            `[nanogpt] requested stream_options.include_usage but received ${
              empty ? "empty" : "invalid"
            } usage in stream result`,
            {
              modelId: params.modelId,
              ...(invalidFields.length > 0 ? { invalidFields } : {}),
            },
          );
        }
      }

      if (!params.warnNanoGptAnomaly) {
        return;
      }

      const inspection = collectNanoGptStreamContentInspection(finalMessage);
      if (!inspection) {
        return;
      }

      const markerInspection = collectNanoGptStreamMarkerInspection(
        inspection.visibleText,
      );
      const finishReason = isRecord(finalMessage) && typeof finalMessage.stopReason === "string"
        ? finalMessage.stopReason
        : undefined;

      if (
        params.requestToolMetadata.toolEnabled &&
        inspection.toolCallCount === 0 &&
        shouldWarnNanoGptToolEnabledTurnWithoutToolCall({
          inspection,
          markerInspection,
        })
      ) {
        emitNanoGptStreamAnomaly({
          warnNanoGptAnomaly: params.warnNanoGptAnomaly,
          kind: "tool_enabled_turn_without_tool_call",
          modelId: params.modelId,
          modelFamily: params.modelFamily,
          transportApi: params.transportApi,
          requestToolMetadata: params.requestToolMetadata,
          observedHeadline: "assistant result without parsed tool calls",
          observedCounts: {
            parsedToolCalls: inspection.toolCallCount,
            textBlocks: inspection.textBlockCount,
            thinkingBlocks: inspection.thinkingBlockCount,
            visibleTextLength: inspection.visibleTextLength,
          },
          finishReason,
        });

        if (inspection.visibleTextLength === 0) {
          emitNanoGptStreamAnomaly({
            warnNanoGptAnomaly: params.warnNanoGptAnomaly,
            kind: "tool_enabled_turn_with_empty_visible_output",
            modelId: params.modelId,
            modelFamily: params.modelFamily,
            transportApi: params.transportApi,
            requestToolMetadata: params.requestToolMetadata,
            observedHeadline: "tool-enabled turn with empty visible assistant output",
            observedCounts: {
              parsedToolCalls: inspection.toolCallCount,
              textBlocks: inspection.textBlockCount,
              thinkingBlocks: inspection.thinkingBlockCount,
              visibleTextLength: inspection.visibleTextLength,
            },
            finishReason,
          });
        }

        if (markerInspection.toolLikeMarkers.length > 0) {
          emitNanoGptStreamAnomaly({
            warnNanoGptAnomaly: params.warnNanoGptAnomaly,
            kind: "tool_enabled_turn_with_tool_like_text",
            modelId: params.modelId,
            modelFamily: params.modelFamily,
            transportApi: params.transportApi,
            requestToolMetadata: params.requestToolMetadata,
            observedHeadline: "tool-enabled turn with tool-like visible text",
            observedCounts: {
              parsedToolCalls: inspection.toolCallCount,
              textBlocks: inspection.textBlockCount,
              thinkingBlocks: inspection.thinkingBlockCount,
              visibleTextLength: inspection.visibleTextLength,
              toolLikeMarkerCount: markerInspection.toolLikeMarkers.length,
            },
            observedMarkerNames: markerInspection.toolLikeMarkers,
            finishReason,
          });
        }
      }

      if (markerInspection.reasoningIsUnbalanced) {
        emitNanoGptStreamAnomaly({
          warnNanoGptAnomaly: params.warnNanoGptAnomaly,
          kind: "visible_output_contains_unbalanced_reasoning_tags",
          modelId: params.modelId,
          modelFamily: params.modelFamily,
          transportApi: params.transportApi,
          requestToolMetadata: params.requestToolMetadata,
          observedHeadline: "visible assistant text contains unbalanced reasoning tags",
          observedCounts: {
            parsedToolCalls: inspection.toolCallCount,
            textBlocks: inspection.textBlockCount,
            thinkingBlocks: inspection.thinkingBlockCount,
            visibleTextLength: inspection.visibleTextLength,
            reasoningMarkerCount: markerInspection.reasoningMarkerNames.length,
          },
          observedMarkerNames: markerInspection.reasoningMarkerNames,
          finishReason,
        });
      } else if (markerInspection.reasoningMarkerNames.length > 0) {
        emitNanoGptStreamAnomaly({
          warnNanoGptAnomaly: params.warnNanoGptAnomaly,
          kind: "visible_output_contains_reasoning_tags",
          modelId: params.modelId,
          modelFamily: params.modelFamily,
          transportApi: params.transportApi,
          requestToolMetadata: params.requestToolMetadata,
          observedHeadline: "visible assistant text contains reasoning tags",
          observedCounts: {
            parsedToolCalls: inspection.toolCallCount,
            textBlocks: inspection.textBlockCount,
            thinkingBlocks: inspection.thinkingBlockCount,
            visibleTextLength: inspection.visibleTextLength,
            reasoningMarkerCount: markerInspection.reasoningMarkerNames.length,
          },
          observedMarkerNames: markerInspection.reasoningMarkerNames,
          finishReason,
        });
      }

      if (markerInspection.xmlLikeToolWrapperMarkers.length > 0) {
        emitNanoGptStreamAnomaly({
          warnNanoGptAnomaly: params.warnNanoGptAnomaly,
          kind: "visible_output_contains_xml_like_tool_wrappers",
          modelId: params.modelId,
          modelFamily: params.modelFamily,
          transportApi: params.transportApi,
          requestToolMetadata: params.requestToolMetadata,
          observedHeadline: "visible assistant text contains XML-like tool wrappers",
          observedCounts: {
            parsedToolCalls: inspection.toolCallCount,
            textBlocks: inspection.textBlockCount,
            thinkingBlocks: inspection.thinkingBlockCount,
            visibleTextLength: inspection.visibleTextLength,
            xmlLikeToolWrapperCount: markerInspection.xmlLikeToolWrapperMarkers.length,
          },
          observedMarkerNames: markerInspection.xmlLikeToolWrapperMarkers,
          finishReason,
        });
      }

      if (markerInspection.functionCallMarkers.length > 0) {
        emitNanoGptStreamAnomaly({
          warnNanoGptAnomaly: params.warnNanoGptAnomaly,
          kind: "visible_output_contains_function_call_markers",
          modelId: params.modelId,
          modelFamily: params.modelFamily,
          transportApi: params.transportApi,
          requestToolMetadata: params.requestToolMetadata,
          observedHeadline: "visible assistant text contains function-call markers",
          observedCounts: {
            parsedToolCalls: inspection.toolCallCount,
            textBlocks: inspection.textBlockCount,
            thinkingBlocks: inspection.thinkingBlockCount,
            visibleTextLength: inspection.visibleTextLength,
            functionCallMarkerCount: markerInspection.functionCallMarkers.length,
          },
          observedMarkerNames: markerInspection.functionCallMarkers,
          finishReason,
        });
      }
    })
    .catch(() => {
      // Non-blocking: stream warnings are best-effort.
    });
}