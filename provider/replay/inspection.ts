import { isRecord } from "../../shared/guards.js";
import { collectNanoGptStreamMarkerInspection } from "../inspection.js";
import type {
  NanoGptReplayAssistantInspection,
  NanoGptReplayToolResultInspection,
} from "./types.js";

type NanoGptReplayTransportContext = {
  modelApi?: unknown;
  model?: unknown;
};

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

export function collectNanoGptReplayAssistantInspection(
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
  const toolCalls = [];
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

  const markerInspection = collectNanoGptStreamMarkerInspection(visibleText);

  return {
    visibleText,
    visibleTextLength: normalizeNanoGptReplayText(visibleText)?.length ?? 0,
    textBlockCount,
    thinkingBlockCount,
    toolCallCount,
    toolCalls,
    toolCallNames: [...toolCallNames],
    reasoningMarkerNames: markerInspection.reasoningMarkerNames,
    reasoningIsUnbalanced: markerInspection.reasoningIsUnbalanced,
    xmlLikeToolWrapperMarkers: markerInspection.xmlLikeToolWrapperMarkers,
    functionCallMarkers: markerInspection.functionCallMarkers,
    toolLikeMarkers: markerInspection.toolLikeMarkers,
    missingToolCallIdCount,
    duplicateToolCallIdCount,
  };
}

export function collectNanoGptReplayToolResultInspection(
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

export function resolveNanoGptReplayTransportApi(
  context: NanoGptReplayTransportContext,
): string | undefined {
  const modelApi = isRecord(context.model) ? context.model.api : undefined;
  const transportApi = context.modelApi ?? modelApi;
  if (typeof transportApi !== "string") {
    return undefined;
  }

  const normalized = transportApi.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function isNanoGptTaggedReasoningOutputMode(
  context: Pick<NanoGptReplayTransportContext, "model">,
): boolean {
  const compat = isRecord(context.model) ? context.model.compat : undefined;
  return isRecord(compat) && compat.requiresThinkingAsText === true;
}