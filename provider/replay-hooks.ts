import type {
  ProviderReasoningOutputMode,
  ProviderReasoningOutputModeContext,
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
  ProviderSanitizeReplayHistoryContext,
  ProviderValidateReplayTurnsContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { buildOpenAICompatibleReplayPolicy } from "openclaw/plugin-sdk/provider-model-shared";
import { isRecord } from "../shared/guards.js";
import {
  NANO_GPT_REASONING_TAG_PAIRS,
  NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS,
  NANO_GPT_FUNCTION_CALL_MARKERS,
  countNanoGptSubstringOccurrences,
} from "./markers.js";
import {
  createNanoGptAnomalyWarnOnceLogger,
  type NanoGptAnomalyWarning,
  type NanoGptWarnLogger,
} from "./anomaly-logger.js";
import {
  buildNanoGptExpectedShapeSummary,
  buildNanoGptObservedShapeSummary,
  resolveNanoGptModelIdentity,
} from "./anomaly-types.js";

type NanoGptReplayWarnFn = (warning: NanoGptAnomalyWarning) => void;

type NanoGptReplayAssistantToolCall = Readonly<{
  id: string;
  name: string;
  missingId: boolean;
}>;

type NanoGptReplayAssistantInspection = Readonly<{
  visibleText: string;
  visibleTextLength: number;
  textBlockCount: number;
  thinkingBlockCount: number;
  toolCallCount: number;
  toolCalls: readonly NanoGptReplayAssistantToolCall[];
  toolCallNames: readonly string[];
  reasoningMarkerNames: readonly string[];
  reasoningIsUnbalanced: boolean;
  xmlLikeToolWrapperMarkers: readonly string[];
  functionCallMarkers: readonly string[];
  toolLikeMarkers: readonly string[];
  missingToolCallIdCount: number;
  duplicateToolCallIdCount: number;
}>;

type NanoGptReplayToolResultInspection = Readonly<{
  toolCallId: string;
  toolName: string;
  missingToolCallId: boolean;
  missingToolName: boolean;
}>;

type NanoGptReplayWarningContext = Readonly<{
  warnNanoGptAnomaly: NanoGptReplayWarnFn;
  kind: NanoGptAnomalyWarning["kind"];
  stage: "replay_sanitize" | "replay_validate";
  modelId: string;
  modelFamily: NanoGptAnomalyWarning["modelFamily"];
  transportApi?: string;
  expectedHeadline: string;
  expectedCounts?: Record<string, number>;
  expectedToolNames?: readonly string[];
  expectedNotes?: readonly string[];
  observedHeadline: string;
  observedCounts?: Record<string, number>;
  observedMarkerNames?: readonly string[];
  observedToolNames?: readonly string[];
  observedNotes?: readonly string[];
  replayTurnIndexes?: readonly number[];
  replayRoles?: readonly string[];
}>;

const NANO_GPT_REPLAY_WARNING_LOGGER_CACHE = new WeakMap<
  NanoGptWarnLogger,
  NanoGptReplayWarnFn
>();

function normalizeNanoGptReplayText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

function isNanoGptAssistantReplayMessage(message: unknown): message is {
  role: "assistant";
  content: unknown[];
} {
  return isRecord(message) && message.role === "assistant" && Array.isArray(message.content);
}

function isNanoGptToolResultReplayMessage(message: unknown): message is {
  role: "toolResult";
  toolCallId?: unknown;
  toolName?: unknown;
} {
  return isRecord(message) && message.role === "toolResult";
}

function createNanoGptReplayAnomalyLogger(logger?: NanoGptWarnLogger): NanoGptReplayWarnFn | undefined {
  if (!logger?.warn) {
    return undefined;
  }

  const cachedLogger = NANO_GPT_REPLAY_WARNING_LOGGER_CACHE.get(logger);
  if (cachedLogger) {
    return cachedLogger;
  }

  const warnOnceLogger = createNanoGptAnomalyWarnOnceLogger({
    logger: {
      warn: (message: string) => logger.warn?.(message),
    },
  });

  NANO_GPT_REPLAY_WARNING_LOGGER_CACHE.set(logger, warnOnceLogger);
  return warnOnceLogger;
}

function collectNanoGptReplayAssistantInspection(
  message: unknown,
): NanoGptReplayAssistantInspection | null {
  if (!isNanoGptAssistantReplayMessage(message)) {
    return null;
  }

  let visibleText = "";
  let textBlockCount = 0;
  let thinkingBlockCount = 0;
  let toolCallCount = 0;
  let missingToolCallIdCount = 0;
  let duplicateToolCallIdCount = 0;
  const toolCalls: NanoGptReplayAssistantToolCall[] = [];
  const toolCallIds = new Set<string>();
  const toolCallNames = new Set<string>();

  for (const contentBlock of message.content) {
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

    if (contentBlock.type === "thinking") {
      thinkingBlockCount += 1;
      continue;
    }

    if (contentBlock.type === "toolCall") {
      toolCallCount += 1;

      const id = typeof contentBlock.id === "string" ? contentBlock.id.trim() : "";
      const name = typeof contentBlock.name === "string" ? contentBlock.name.trim() : "";

      if (id.length === 0) {
        missingToolCallIdCount += 1;
      } else if (toolCallIds.has(id)) {
        duplicateToolCallIdCount += 1;
      } else {
        toolCallIds.add(id);
      }

      if (name.length > 0) {
        toolCallNames.add(name);
      }

      toolCalls.push({
        id,
        name,
        missingId: id.length === 0,
      });
    }
  }

  const normalizedVisibleText = visibleText.toLowerCase();
  const reasoningMarkerNames = new Set<string>();
  let reasoningIsUnbalanced = false;

  for (const tagPair of NANO_GPT_REASONING_TAG_PAIRS) {
    const openTagCount = countNanoGptSubstringOccurrences(normalizedVisibleText, tagPair.open);
    const closeTagCount = countNanoGptSubstringOccurrences(normalizedVisibleText, tagPair.close);
    if (openTagCount === 0 && closeTagCount === 0) {
      continue;
    }

    reasoningMarkerNames.add(tagPair.open);
    reasoningMarkerNames.add(tagPair.close);
    if (openTagCount !== closeTagCount) {
      reasoningIsUnbalanced = true;
    }
  }

  const xmlLikeToolWrapperMarkers = NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS.filter((marker) =>
    normalizedVisibleText.includes(marker),
  );
  const functionCallMarkers = NANO_GPT_FUNCTION_CALL_MARKERS.filter((marker) =>
    normalizedVisibleText.includes(marker),
  );

  return {
    visibleText,
    visibleTextLength: normalizeNanoGptReplayText(visibleText)?.length ?? 0,
    textBlockCount,
    thinkingBlockCount,
    toolCallCount,
    toolCalls,
    toolCallNames: [...toolCallNames],
    reasoningMarkerNames: [...reasoningMarkerNames],
    reasoningIsUnbalanced,
    xmlLikeToolWrapperMarkers,
    functionCallMarkers,
    toolLikeMarkers: [...new Set([...xmlLikeToolWrapperMarkers, ...functionCallMarkers])],
    missingToolCallIdCount,
    duplicateToolCallIdCount,
  };
}

function collectNanoGptReplayToolResultInspection(
  message: unknown,
): NanoGptReplayToolResultInspection | null {
  if (!isNanoGptToolResultReplayMessage(message)) {
    return null;
  }

  const toolCallId = typeof message.toolCallId === "string" ? message.toolCallId.trim() : "";
  const toolName = typeof message.toolName === "string" ? message.toolName.trim() : "";

  return {
    toolCallId,
    toolName,
    missingToolCallId: toolCallId.length === 0,
    missingToolName: toolName.length === 0,
  };
}

function resolveNanoGptReplayTransportApi(context: ProviderReplayPolicyContext): string | undefined {
  const transportApi = context.modelApi ?? context.model?.api;
  if (typeof transportApi !== "string") {
    return undefined;
  }

  const normalized = transportApi.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function isNanoGptTaggedReasoningOutputMode(context: ProviderReasoningOutputModeContext): boolean {
  const compat = context.model?.compat;
  return isRecord(compat) && compat.requiresThinkingAsText === true;
}

function emitNanoGptReplayWarning(params: NanoGptReplayWarningContext): void {
  params.warnNanoGptAnomaly({
    kind: params.kind,
    stage: params.stage,
    providerId: "nanogpt",
    modelId: params.modelId,
    modelFamily: params.modelFamily,
    transportApi: params.transportApi,
    expectedShapeSummary: buildNanoGptExpectedShapeSummary({
      headline: params.expectedHeadline,
      counts: params.expectedCounts,
      groups:
        params.expectedToolNames && params.expectedToolNames.length > 0
          ? [{ label: "toolNames", values: params.expectedToolNames }]
          : undefined,
      notes: params.expectedNotes,
    }),
    observedShapeSummary: buildNanoGptObservedShapeSummary({
      headline: params.observedHeadline,
      counts: params.observedCounts,
      groups:
        params.observedToolNames && params.observedToolNames.length > 0
          ? [{ label: "toolNames", values: params.observedToolNames }]
          : undefined,
      notes: params.observedNotes,
    }),
    metadata: {
      toolNames: params.observedToolNames,
      toolCount: params.observedToolNames?.length,
      markerNames: params.observedMarkerNames,
      replayTurnIndexes: params.replayTurnIndexes,
      replayRoles: params.replayRoles,
      notes: params.observedNotes,
    },
  });
}

function emitNanoGptReplayOrderingWarning(params: {
  warnNanoGptAnomaly: NanoGptReplayWarnFn;
  modelId: string;
  modelFamily: NanoGptAnomalyWarning["modelFamily"];
  transportApi?: string;
  turnIndex: number;
  roles: readonly string[];
  note: string;
  observedCounts: Record<string, number>;
  observedToolNames?: readonly string[];
  expectedCounts?: Record<string, number>;
  expectedToolNames?: readonly string[];
}): void {
  emitNanoGptReplayWarning({
    warnNanoGptAnomaly: params.warnNanoGptAnomaly,
    kind: "replay_has_invalid_tool_ordering",
    stage: "replay_validate",
    modelId: params.modelId,
    modelFamily: params.modelFamily,
    transportApi: params.transportApi,
    expectedHeadline: "assistant/tool replay ordering remains canonical",
    expectedCounts: params.expectedCounts ?? {
      assistantTurns: 1,
      pendingToolCalls: 0,
    },
    expectedToolNames: params.expectedToolNames,
    observedHeadline: params.note,
    observedCounts: params.observedCounts,
    observedToolNames: params.observedToolNames,
    replayTurnIndexes: [params.turnIndex],
    replayRoles: params.roles,
    observedNotes: [params.note],
  });
}

function emitNanoGptReplayMissingIdWarning(params: {
  warnNanoGptAnomaly: NanoGptReplayWarnFn;
  modelId: string;
  modelFamily: NanoGptAnomalyWarning["modelFamily"];
  transportApi?: string;
  turnIndex: number;
  roles: readonly string[];
  toolNames: readonly string[];
  missingToolCallIdCount: number;
  observedHeadline: string;
}): void {
  emitNanoGptReplayWarning({
    warnNanoGptAnomaly: params.warnNanoGptAnomaly,
    kind: "replay_has_missing_tool_call_id",
    stage: "replay_validate",
    modelId: params.modelId,
    modelFamily: params.modelFamily,
    transportApi: params.transportApi,
    expectedHeadline: "assistant tool calls have stable ids",
    expectedCounts: {
      assistantToolCalls: params.toolNames.length,
      missingToolCallIds: 0,
    },
    expectedToolNames: params.toolNames,
    observedHeadline: params.observedHeadline,
    observedCounts: {
      assistantToolCalls: params.toolNames.length,
      missingToolCallIds: params.missingToolCallIdCount,
    },
    observedToolNames: params.toolNames,
    replayTurnIndexes: [params.turnIndex],
    replayRoles: params.roles,
  });
}

function emitNanoGptReplayToolStateWarning(params: {
  warnNanoGptAnomaly: NanoGptReplayWarnFn;
  modelId: string;
  modelFamily: NanoGptAnomalyWarning["modelFamily"];
  transportApi?: string;
  turnIndex: number;
  roles: readonly string[];
  note: string;
  counts: Record<string, number>;
  toolNames?: readonly string[];
}): void {
  emitNanoGptReplayWarning({
    warnNanoGptAnomaly: params.warnNanoGptAnomaly,
    kind: "replay_has_inconsistent_assistant_tool_state",
    stage: "replay_validate",
    modelId: params.modelId,
    modelFamily: params.modelFamily,
    transportApi: params.transportApi,
    expectedHeadline: "assistant and tool result state stays aligned",
    expectedCounts: {
      assistantTurns: 1,
      matchingToolResults: 0,
    },
    expectedToolNames: params.toolNames,
    observedHeadline: params.note,
    observedCounts: params.counts,
    observedToolNames: params.toolNames,
    replayTurnIndexes: [params.turnIndex],
    replayRoles: params.roles,
    observedNotes: [params.note],
  });
}

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
  if (!warnNanoGptAnomaly) {
    return undefined;
  }

  const { modelId, modelFamily } = resolveNanoGptModelIdentity(context);
  const transportApi = resolveNanoGptReplayTransportApi(context);
  const reasoningOutputMode = resolveReasoningOutputMode(context);

  context.messages.forEach((message, turnIndex) => {
    const inspection = collectNanoGptReplayAssistantInspection(message);
    if (!inspection) {
      return;
    }

    const reasoningLeakKinds: string[] = [];
    if (inspection.thinkingBlockCount > 0) {
      reasoningLeakKinds.push("thinkingBlocks");
    }
    if (inspection.reasoningMarkerNames.length > 0) {
      reasoningLeakKinds.push("reasoningTags");
    }

    if (reasoningLeakKinds.length > 0) {
      const observedHeadline =
        reasoningLeakKinds.length > 1
          ? "assistant replay turn preserves reasoning blocks and visible reasoning tags"
          : reasoningLeakKinds[0] === "thinkingBlocks"
            ? reasoningOutputMode === "tagged"
              ? "assistant replay turn preserves native thinking blocks in tagged mode"
              : "assistant replay turn preserves native thinking blocks"
            : "assistant replay turn contains visible reasoning tags";

      emitNanoGptReplayWarning({
        warnNanoGptAnomaly,
        kind: "replay_contains_reasoning_leak",
        stage: "replay_sanitize",
        modelId,
        modelFamily,
        transportApi,
        expectedHeadline:
          reasoningOutputMode === "tagged"
            ? "assistant replay turn without visible reasoning tags"
            : "assistant replay turn without preserved thinking blocks",
        expectedCounts: {
          assistantTurns: 1,
          thinkingBlocks: 0,
          reasoningMarkers: 0,
        },
        observedHeadline,
        observedCounts: {
          assistantTurns: 1,
          textBlocks: inspection.textBlockCount,
          thinkingBlocks: inspection.thinkingBlockCount,
          toolCalls: inspection.toolCallCount,
          visibleTextLength: inspection.visibleTextLength,
          reasoningMarkers: inspection.reasoningMarkerNames.length,
        },
        observedMarkerNames: inspection.reasoningMarkerNames,
        replayTurnIndexes: [turnIndex],
        replayRoles: ["assistant"],
        observedNotes: [
          `reasoningOutputMode=${reasoningOutputMode}`,
          `reasoningLeakKinds=${reasoningLeakKinds.join(",")}`,
        ],
      });
    }

    if (inspection.toolLikeMarkers.length > 0) {
      emitNanoGptReplayWarning({
        warnNanoGptAnomaly,
        kind: "replay_contains_tool_like_text",
        stage: "replay_sanitize",
        modelId,
        modelFamily,
        transportApi,
        expectedHeadline: "assistant replay turn without visible tool-like wrappers",
        expectedCounts: {
          assistantTurns: 1,
          toolLikeMarkers: 0,
        },
        observedHeadline: "assistant replay turn with tool-like visible text",
        observedCounts: {
          assistantTurns: 1,
          textBlocks: inspection.textBlockCount,
          thinkingBlocks: inspection.thinkingBlockCount,
          toolCalls: inspection.toolCallCount,
          visibleTextLength: inspection.visibleTextLength,
          toolLikeMarkerCount: inspection.toolLikeMarkers.length,
        },
        observedMarkerNames: inspection.toolLikeMarkers,
        observedToolNames: inspection.toolCallNames,
        replayTurnIndexes: [turnIndex],
        replayRoles: ["assistant"],
        observedNotes: [`reasoningOutputMode=${reasoningOutputMode}`],
      });
    }
  });

  return undefined;
}

export function validateReplayTurns(
  context: ProviderValidateReplayTurnsContext,
  warnNanoGptAnomaly?: NanoGptReplayWarnFn,
): ProviderValidateReplayTurnsContext["messages"] | null | undefined {
  if (!warnNanoGptAnomaly) {
    return undefined;
  }

  const { modelId, modelFamily } = resolveNanoGptModelIdentity(context);
  const transportApi = resolveNanoGptReplayTransportApi(context);
  const pendingToolCalls: Array<{
    id: string;
    name: string;
    assistantTurnIndex: number;
  }> = [];

  context.messages.forEach((message, turnIndex) => {
    const assistantInspection = collectNanoGptReplayAssistantInspection(message);
    if (assistantInspection) {
      if (pendingToolCalls.length > 0) {
        emitNanoGptReplayOrderingWarning({
          warnNanoGptAnomaly,
          modelId,
          modelFamily,
          transportApi,
          turnIndex,
          roles: ["assistant"],
          note: "assistant replay turn arrived before pending tool results were replayed",
          observedCounts: {
            assistantTurns: 1,
            pendingToolCalls: pendingToolCalls.length,
            assistantToolCalls: assistantInspection.toolCallCount,
          },
        });
        pendingToolCalls.length = 0;
      }

      if (assistantInspection.missingToolCallIdCount > 0) {
        emitNanoGptReplayMissingIdWarning({
          warnNanoGptAnomaly,
          modelId,
          modelFamily,
          transportApi,
          turnIndex,
          roles: ["assistant"],
          toolNames: assistantInspection.toolCallNames,
          missingToolCallIdCount: assistantInspection.missingToolCallIdCount,
          observedHeadline: "assistant tool calls are missing one or more ids",
        });
      }

      if (assistantInspection.duplicateToolCallIdCount > 0) {
        emitNanoGptReplayToolStateWarning({
          warnNanoGptAnomaly,
          modelId,
          modelFamily,
          transportApi,
          turnIndex,
          roles: ["assistant"],
          note: "assistant replay turn reuses one or more tool-call ids",
          counts: {
            assistantTurns: 1,
            assistantToolCalls: assistantInspection.toolCallCount,
            duplicateToolCallIds: assistantInspection.duplicateToolCallIdCount,
          },
          toolNames: assistantInspection.toolCallNames,
        });
      }

      for (const toolCall of assistantInspection.toolCalls) {
        pendingToolCalls.push({
          id: toolCall.id,
          name: toolCall.name,
          assistantTurnIndex: turnIndex,
        });
      }

      return;
    }

    const toolResultInspection = collectNanoGptReplayToolResultInspection(message);
    if (toolResultInspection) {
      if (toolResultInspection.missingToolCallId) {
        emitNanoGptReplayMissingIdWarning({
          warnNanoGptAnomaly,
          modelId,
          modelFamily,
          transportApi,
          turnIndex,
          roles: ["toolResult"],
          toolNames: toolResultInspection.toolName ? [toolResultInspection.toolName] : [],
          missingToolCallIdCount: 1,
          observedHeadline: "tool result is missing a tool-call id",
        });
      }

      if (pendingToolCalls.length === 0) {
        emitNanoGptReplayOrderingWarning({
          warnNanoGptAnomaly,
          modelId,
          modelFamily,
          transportApi,
          turnIndex,
          roles: ["toolResult"],
          note: "tool result appeared without a pending assistant tool call",
          observedCounts: {
            toolResultTurns: 1,
            pendingToolCalls: 0,
            missingToolCallIds: toolResultInspection.missingToolCallId ? 1 : 0,
          },
          observedToolNames: toolResultInspection.toolName ? [toolResultInspection.toolName] : undefined,
        });
        return;
      }

      const matchingIndex = toolResultInspection.toolCallId.length > 0
        ? pendingToolCalls.findIndex((toolCall) => toolCall.id === toolResultInspection.toolCallId)
        : -1;

      if (matchingIndex > 0) {
        const matchedToolCall = pendingToolCalls.splice(matchingIndex, 1)[0];
        emitNanoGptReplayOrderingWarning({
          warnNanoGptAnomaly,
          modelId,
          modelFamily,
          transportApi,
          turnIndex,
          roles: ["toolResult"],
          note: "tool result arrived out of order relative to the pending assistant tool calls",
          observedCounts: {
            toolResultTurns: 1,
            pendingToolCalls: pendingToolCalls.length + 1,
            outOfOrderToolCallIndex: matchingIndex,
          },
          observedToolNames: matchedToolCall.name ? [matchedToolCall.name] : undefined,
        });

        if (toolResultInspection.toolName.length > 0 && matchedToolCall.name !== toolResultInspection.toolName) {
          emitNanoGptReplayToolStateWarning({
            warnNanoGptAnomaly,
            modelId,
            modelFamily,
            transportApi,
            turnIndex,
            roles: ["toolResult"],
            note: "tool result metadata does not line up with the pending assistant tool call",
            counts: {
              toolResultTurns: 1,
              mismatchedToolNames: 1,
            },
            toolNames: matchedToolCall.name ? [matchedToolCall.name] : undefined,
          });
        }

        return;
      }

      const expectedToolCall = pendingToolCalls[0];
      if (!expectedToolCall) {
        return;
      }

      const counts: Record<string, number> = {
        toolResultTurns: 1,
        pendingToolCalls: pendingToolCalls.length,
      };
      let hasToolStateMismatch = false;

      if (toolResultInspection.toolCallId.length > 0 && expectedToolCall.id.length > 0 && toolResultInspection.toolCallId !== expectedToolCall.id) {
        counts.mismatchedToolCallIds = 1;
        hasToolStateMismatch = true;
      }

      if (toolResultInspection.toolName.length > 0 && expectedToolCall.name.length > 0 && toolResultInspection.toolName !== expectedToolCall.name) {
        counts.mismatchedToolNames = 1;
        hasToolStateMismatch = true;
      }

      if (toolResultInspection.missingToolName) {
        counts.missingToolNames = 1;
        hasToolStateMismatch = true;
      }

      if (toolResultInspection.missingToolCallId) {
        counts.missingToolCallIds = 1;
        hasToolStateMismatch = true;
      }

      if (hasToolStateMismatch) {
        emitNanoGptReplayToolStateWarning({
          warnNanoGptAnomaly,
          modelId,
          modelFamily,
          transportApi,
          turnIndex,
          roles: ["toolResult"],
          note: "tool result metadata does not line up with the pending assistant tool call",
          counts,
          toolNames: expectedToolCall.name ? [expectedToolCall.name] : undefined,
        });
      }

      pendingToolCalls.shift();
      return;
    }

    if (pendingToolCalls.length > 0) {
      emitNanoGptReplayOrderingWarning({
        warnNanoGptAnomaly,
        modelId,
        modelFamily,
        transportApi,
        turnIndex,
        roles: [typeof (message as { role?: unknown }).role === "string" ? String((message as { role: string }).role) : "unknown"],
        note: "non-tool replay turn appeared while tool results were still pending",
        observedCounts: {
          pendingToolCalls: pendingToolCalls.length,
        },
      });
      pendingToolCalls.length = 0;
    }
  });

  if (pendingToolCalls.length > 0) {
    emitNanoGptReplayOrderingWarning({
      warnNanoGptAnomaly,
      modelId,
      modelFamily,
      transportApi,
      turnIndex: pendingToolCalls[0].assistantTurnIndex,
      roles: ["assistant"],
      note: "replay history ended before pending tool results were replayed",
      observedCounts: {
        pendingToolCalls: pendingToolCalls.length,
      },
      observedToolNames: pendingToolCalls.map((toolCall) => toolCall.name).filter((toolName) => toolName.length > 0),
    });
  }

  return undefined;
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
  const warnNanoGptAnomaly = createNanoGptReplayAnomalyLogger(params.logger);

  return {
    buildReplayPolicy,
    sanitizeReplayHistory: (context) => sanitizeReplayHistory(context, warnNanoGptAnomaly),
    validateReplayTurns: (context) => validateReplayTurns(context, warnNanoGptAnomaly),
    resolveReasoningOutputMode,
  };
}
