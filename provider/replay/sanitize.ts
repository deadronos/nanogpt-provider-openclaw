import type {
  ProviderReasoningOutputMode,
  ProviderSanitizeReplayHistoryContext,
} from "openclaw/plugin-sdk/plugin-entry";
import { resolveNanoGptModelIdentity } from "../anomaly-types.js";
import {
  collectNanoGptReplayAssistantInspection,
  isNanoGptTaggedReasoningOutputMode,
  resolveNanoGptReplayTransportApi,
} from "./inspection.js";
import type { NanoGptReplayWarnFn } from "./types.js";
import { emitNanoGptReplayWarning } from "./warnings.js";

export function sanitizeReplayHistory(
  context: ProviderSanitizeReplayHistoryContext,
  warnNanoGptAnomaly?: NanoGptReplayWarnFn,
): ProviderSanitizeReplayHistoryContext["messages"] | null | undefined {
  if (!warnNanoGptAnomaly) {
    return undefined;
  }

  const { modelId, modelFamily } = resolveNanoGptModelIdentity(context);
  const transportApi = resolveNanoGptReplayTransportApi(context);
  const reasoningOutputMode: ProviderReasoningOutputMode = isNanoGptTaggedReasoningOutputMode(context)
    ? "tagged"
    : "native";

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