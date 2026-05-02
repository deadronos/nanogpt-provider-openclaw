import type { ProviderValidateReplayTurnsContext } from "openclaw/plugin-sdk/plugin-entry";
import { resolveNanoGptModelIdentity } from "../anomaly-types.js";
import {
  collectNanoGptReplayAssistantInspection,
  collectNanoGptReplayToolResultInspection,
  resolveNanoGptReplayTransportApi,
} from "./inspection.js";
import type { NanoGptReplayWarnFn } from "./types.js";
import {
  emitNanoGptReplayMissingIdWarning,
  emitNanoGptReplayOrderingWarning,
  emitNanoGptReplayToolStateWarning,
} from "./warnings.js";

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

        if (
          toolResultInspection.toolName.length > 0 &&
          matchedToolCall.name !== toolResultInspection.toolName
        ) {
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

      if (
        toolResultInspection.toolCallId.length > 0 &&
        expectedToolCall.id.length > 0 &&
        toolResultInspection.toolCallId !== expectedToolCall.id
      ) {
        counts.mismatchedToolCallIds = 1;
        hasToolStateMismatch = true;
      }

      if (
        toolResultInspection.toolName.length > 0 &&
        expectedToolCall.name.length > 0 &&
        toolResultInspection.toolName !== expectedToolCall.name
      ) {
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
      const role = typeof (message as { role?: unknown }).role === "string"
        ? String((message as { role: string }).role)
        : "unknown";

      emitNanoGptReplayOrderingWarning({
        warnNanoGptAnomaly,
        modelId,
        modelFamily,
        transportApi,
        turnIndex,
        roles: [role],
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
      observedToolNames: pendingToolCalls
        .map((toolCall) => toolCall.name)
        .filter((toolName) => toolName.length > 0),
    });
  }

  return undefined;
}