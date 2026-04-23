import { randomUUID } from "node:crypto";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type ToolCall,
} from "@mariozechner/pi-ai";
import type { NanoGptPluginConfig, NanoGptResponseFormat } from "../models.js";
import type { AnyAgentTool, ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";
import {
  createNanoGptAnomalyWarnOnceLogger,
  type NanoGptAnomalyWarning,
} from "./anomaly-logger.js";
import {
  buildNanoGptExpectedShapeSummary,
  buildNanoGptObservedShapeSummary,
  resolveNanoGptModelIdentity,
  type NanoGptModelFamily,
} from "./anomaly-types.js";
import { isRecord } from "../shared/guards.js";
import {
  NANO_GPT_REASONING_TAG_PAIRS,
  NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS,
  NANO_GPT_FUNCTION_CALL_MARKERS,
  countNanoGptSubstringOccurrences,
} from "./markers.js";
import {
  collectNanoGptStreamMarkerInspection,
  type NanoGptStreamMarkerInspection,
} from "./inspection.js";
import { parseObjectBridgeAssistantText } from "./bridge/object-parser.js";
import { buildNanoGptBridgeRetrySystemMessage } from "./bridge/retry.js";
import {
  buildNanoGptObjectBridgeSystemMessage,
  buildNanoGptXmlBridgeSystemMessage,
} from "./bridge/system-prompt.js";
import { parseXmlBridgeAssistantText } from "./bridge/xml-parser.js";

type NanoGptWrappedStreamFn = ProviderWrapStreamFnContext["streamFn"];

type NanoGptLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

type NanoGptRequestToolMetadata = Readonly<{
  toolEnabled: boolean;
  toolCount: number;
  toolNames: readonly string[];
}>;

type NanoGptStreamContentInspection = Readonly<{
  visibleText: string;
  visibleTextLength: number;
  textBlockCount: number;
  toolCallCount: number;
  thinkingBlockCount: number;
}>;

type NanoGptUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

const NANO_GPT_STREAM_ANOMALY_LOGGER_CACHE = new WeakMap<
  NanoGptLogger,
  (warning: NanoGptAnomalyWarning) => void
>();

function collectNanoGptRequestToolMetadata(context: unknown): NanoGptRequestToolMetadata {
  if (!isRecord(context) || !Array.isArray(context.tools)) {
    return {
      toolEnabled: false,
      toolCount: 0,
      toolNames: [],
    };
  }

  const toolNames = new Set<string>();
  for (const tool of context.tools) {
    if (!isRecord(tool) || typeof tool.name !== "string") {
      continue;
    }

    const normalizedName = tool.name.trim();
    if (normalizedName) {
      toolNames.add(normalizedName);
    }
  }

  return {
    toolEnabled: context.tools.length > 0,
    toolCount: context.tools.length,
    toolNames: [...toolNames],
  };
}

function collectNanoGptStreamContentInspection(finalMessage: unknown): NanoGptStreamContentInspection | null {
  if (!isRecord(finalMessage) || !Array.isArray(finalMessage.content)) {
    return null;
  }

  let visibleText = "";
  let textBlockCount = 0;
  let toolCallCount = 0;
  let thinkingBlockCount = 0;

  for (const contentBlock of finalMessage.content) {
    if (!isRecord(contentBlock) || typeof contentBlock.type !== "string") {
      continue;
    }

    if (contentBlock.type === "text") {
      textBlockCount += 1;
      if (typeof contentBlock.text === "string") {
        visibleText += contentBlock.text;
      }
      continue;
    }

    if (contentBlock.type === "toolCall") {
      toolCallCount += 1;
      continue;
    }

    if (contentBlock.type === "thinking") {
      thinkingBlockCount += 1;
    }
  }

  return {
    visibleText,
    visibleTextLength: visibleText.trim().length,
    textBlockCount,
    toolCallCount,
    thinkingBlockCount,
  };
}

function createNanoGptStreamAnomalyLogger(logger?: NanoGptLogger) {
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

function buildNanoGptExpectedToolRequestShapeSummary(requestToolMetadata: NanoGptRequestToolMetadata) {
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
  warnNanoGptAnomaly: (warning: NanoGptAnomalyWarning) => void;
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
    expectedShapeSummary: buildNanoGptExpectedToolRequestShapeSummary(params.requestToolMetadata),
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
  inspection: NanoGptStreamContentInspection;
  markerInspection: NanoGptStreamMarkerInspection;
}): boolean {
  return params.inspection.visibleTextLength === 0 || params.markerInspection.toolLikeMarkers.length > 0;
}

function scheduleNanoGptStreamResultWarnings(params: {
  stream: unknown;
  logger?: NanoGptLogger;
  warnNanoGptAnomaly?: (warning: NanoGptAnomalyWarning) => void;
  modelId: string;
  modelFamily: NanoGptModelFamily;
  transportApi?: string;
  requestedIncludeUsage: boolean;
  requestToolMetadata: NanoGptRequestToolMetadata;
}): void {
  if (!params.stream || typeof (params.stream as any).result !== "function") {
    return;
  }

  void (params.stream as any)
    .result()
    .then((finalMessage: unknown) => {
      if (params.requestedIncludeUsage && isRecord(finalMessage)) {
        const { empty, invalidFields } = inspectUsage(finalMessage.usage);
        if (empty || invalidFields.length > 0) {
          params.logger?.warn?.(
            `[nanogpt] requested stream_options.include_usage but received ${empty ? "empty" : "invalid"} usage in stream result`,
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

      const markerInspection = collectNanoGptStreamMarkerInspection(inspection.visibleText);
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

function ensureIncludeUsageInStreamingPayload(
  payload: unknown,
  forceIncludeUsage = true,
): { payload?: unknown; requested: boolean } {
  if (!isRecord(payload)) {
    return { requested: false };
  }

  const streamValue = payload.stream;
  const isStreaming = streamValue === true || streamValue === "true";
  const hasStreamOptionsKey = "stream_options" in payload;
  if (!isStreaming && !hasStreamOptionsKey) {
    return { requested: false };
  }

  const existingStreamOptions = isRecord(payload.stream_options) ? payload.stream_options : undefined;
  const existingIncludeUsage = existingStreamOptions?.include_usage;
  if (existingIncludeUsage === true) {
    return { requested: true };
  }

  if (!forceIncludeUsage) {
    return {
      requested: false,
      payload,
    };
  }

  return {
    requested: true,
    payload: {
      ...payload,
      stream_options: {
        ...(existingStreamOptions ? existingStreamOptions : {}),
        include_usage: true,
      },
    },
  };
}

function collectNanoGptThinkingText(finalMessage: unknown): string {
  if (!isRecord(finalMessage) || !Array.isArray(finalMessage.content)) {
    return "";
  }

  let thinking = "";
  for (const contentBlock of finalMessage.content) {
    if (isRecord(contentBlock) && contentBlock.type === "thinking" && typeof contentBlock.thinking === "string") {
      thinking += contentBlock.thinking;
    }
  }
  return thinking;
}

function hasParsedToolCalls(finalMessage: unknown): boolean {
  return Boolean(collectNanoGptStreamContentInspection(finalMessage)?.toolCallCount);
}

function resolveNanoGptBridgeProtocol(
  config: NanoGptPluginConfig | undefined,
): "object" | "xml" {
  return config?.bridgeProtocol === "xml" ? "xml" : "object";
}

function shouldApplyNanoGptBridge(
  config: NanoGptPluginConfig | undefined,
  requestToolMetadata: NanoGptRequestToolMetadata,
): boolean {
  return config?.bridgeMode === "always" && requestToolMetadata.toolEnabled;
}

function maybeInjectNanoGptResponseFormat(
  payload: unknown,
  responseFormat?: NanoGptResponseFormat,
): unknown {
  if (!responseFormat || !isRecord(payload)) {
    return payload;
  }

  const existing = payload.response_format;
  if (existing) {
    return payload;
  }

  if (responseFormat === "json_object") {
    return { ...payload, response_format: { type: "json_object" } };
  }
  if (typeof responseFormat === "object" && responseFormat.type === "json_schema") {
    return {
      ...payload,
      response_format: responseFormat.schema
        ? { type: "json_schema", json_schema: { schema: responseFormat.schema } }
        : { type: "json_schema" },
    };
  }
  return payload;
}

function injectNanoGptBridgePayload(params: {
  payload: unknown;
  tools: readonly AnyAgentTool[];
  protocol: "object" | "xml";
  retryMessage?: string;
}): unknown {
  if (!isRecord(params.payload)) {
    return params.payload;
  }

  const messages = Array.isArray(params.payload.messages) ? [...params.payload.messages] : [];
  const parallelAllowed = params.payload.parallel_tool_calls !== false;
  const bridgeSystemMessage =
    params.protocol === "xml"
      ? buildNanoGptXmlBridgeSystemMessage(params.tools, parallelAllowed)
      : buildNanoGptObjectBridgeSystemMessage(params.tools, parallelAllowed);

  return {
    ...params.payload,
    messages: [
      { role: "system", content: bridgeSystemMessage },
      ...messages,
      ...(params.retryMessage ? [{ role: "system", content: params.retryMessage }] : []),
    ],
  };
}

function buildNanoGptBridgeFailureMessage(finalMessage: AssistantMessage): AssistantMessage {
  return {
    ...finalMessage,
    content: [
      ...finalMessage.content.filter((block) => block.type === "thinking"),
      {
        type: "text",
        text: "[nanogpt bridge] upstream returned no visible content or tool call for a tool-enabled turn.",
      },
    ],
    stopReason: "stop",
  };
}

function buildNanoGptBridgeToolCall(toolCall: { name: string; arguments: Record<string, unknown> }): ToolCall {
  return {
    type: "toolCall",
    id: `call_${randomUUID().slice(0, 8)}`,
    name: toolCall.name,
    arguments: toolCall.arguments,
  };
}

function rewriteNanoGptBridgeMessage(params: {
  finalMessage: AssistantMessage;
  protocol: "object" | "xml";
  tools: readonly AnyAgentTool[];
}): AssistantMessage | null {
  if (hasParsedToolCalls(params.finalMessage)) {
    return params.finalMessage;
  }

  const inspection = collectNanoGptStreamContentInspection(params.finalMessage);
  const visibleText = inspection?.visibleText ?? "";
  const parsed =
    params.protocol === "xml"
      ? parseXmlBridgeAssistantText(visibleText, params.tools)
      : parseObjectBridgeAssistantText(visibleText, params.tools);

  if (parsed.kind === "invalid") {
    const trimmedVisibleText = visibleText.trim();
    if (
      trimmedVisibleText.length === 0 ||
      parsed.error.code === "invalid_empty_turn" ||
      parsed.error.code === "invalid_schema_turn" ||
      (params.protocol === "object" && trimmedVisibleText.startsWith("{")) ||
      (params.protocol === "xml" && trimmedVisibleText.includes("<"))
    ) {
      return null;
    }
    return params.finalMessage;
  }

  const content: AssistantMessage["content"] = [
    ...params.finalMessage.content.filter((block) => block.type === "thinking"),
  ];
  if (parsed.content) {
    content.push({ type: "text", text: parsed.content });
  }
  if (parsed.kind === "tool_calls") {
    content.push(...parsed.toolCalls.map(buildNanoGptBridgeToolCall));
  }

  return {
    ...params.finalMessage,
    content,
    stopReason: parsed.kind === "tool_calls" ? "toolUse" : params.finalMessage.stopReason === "toolUse" ? "stop" : params.finalMessage.stopReason,
  };
}

function replayNanoGptAssistantMessage(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();

  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    message.content.forEach((contentBlock, contentIndex) => {
      if (contentBlock.type === "text") {
        stream.push({ type: "text_start", contentIndex, partial: message });
        stream.push({
          type: "text_delta",
          contentIndex,
          delta: contentBlock.text,
          partial: message,
        });
        stream.push({
          type: "text_end",
          contentIndex,
          content: contentBlock.text,
          partial: message,
        });
        return;
      }

      if (contentBlock.type === "thinking") {
        stream.push({ type: "thinking_start", contentIndex, partial: message });
        stream.push({
          type: "thinking_delta",
          contentIndex,
          delta: contentBlock.thinking,
          partial: message,
        });
        stream.push({
          type: "thinking_end",
          contentIndex,
          content: contentBlock.thinking,
          partial: message,
        });
        return;
      }

      if (contentBlock.type === "toolCall") {
        const delta = JSON.stringify(contentBlock.arguments);
        stream.push({ type: "toolcall_start", contentIndex, partial: message });
        stream.push({
          type: "toolcall_delta",
          contentIndex,
          delta,
          partial: message,
        });
        stream.push({
          type: "toolcall_end",
          contentIndex,
          toolCall: contentBlock,
          partial: message,
        });
      }
    });
    stream.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : message.stopReason === "length" ? "length" : "stop",
      message,
    });
    stream.end();
  });

  return stream;
}

export function wrapNanoGptStreamFn(
  ctx: ProviderWrapStreamFnContext,
  logger?: NanoGptLogger,
  resolvedConfig?: NanoGptPluginConfig,
): NanoGptWrappedStreamFn {
  if (ctx.streamFn) {
    const streamFn = ctx.streamFn;
    const modelApi = ctx.model?.api;
    if (modelApi !== "openai-completions") {
      return streamFn;
    }

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
      const bridgeEnabled = shouldApplyNanoGptBridge(resolvedConfig, requestToolMetadata);
      const bridgeProtocol = resolveNanoGptBridgeProtocol(resolvedConfig);

      const runAttempt = async (retryMessage?: string) => {
        const patchedOptions = {
          ...(options ?? {}),
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
              resolvedConfig?.responseFormat,
            );

            if (bridgeEnabled) {
              nextPayload = injectNanoGptBridgePayload({
                payload: nextPayload,
                tools: Array.isArray((context as any)?.tools) ? ((context as any).tools as AnyAgentTool[]) : [],
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
      if (bridgeEnabled) {
        let finalMessage = await stream.result();
        let rewrittenMessage = rewriteNanoGptBridgeMessage({
          finalMessage,
          protocol: bridgeProtocol,
          tools: Array.isArray((context as any)?.tools) ? ((context as any).tools as AnyAgentTool[]) : [],
        });

        if (!rewrittenMessage) {
          stream = await runAttempt(buildNanoGptBridgeRetrySystemMessage(bridgeProtocol));
          finalMessage = await stream.result();
          rewrittenMessage = rewriteNanoGptBridgeMessage({
            finalMessage,
            protocol: bridgeProtocol,
            tools: Array.isArray((context as any)?.tools) ? ((context as any).tools as AnyAgentTool[]) : [],
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
