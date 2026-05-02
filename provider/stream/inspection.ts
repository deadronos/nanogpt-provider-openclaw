import { isRecord } from "../../shared/guards.js";
import type {
  NanoGptRequestToolMetadata,
  NanoGptStreamContentInspection,
} from "./types.js";

export function collectNanoGptRequestToolMetadata(
  context: unknown,
): NanoGptRequestToolMetadata {
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

export function collectNanoGptStreamContentInspection(
  finalMessage: unknown,
): NanoGptStreamContentInspection | null {
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