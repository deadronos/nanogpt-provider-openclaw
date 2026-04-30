import { isRecord } from "../shared/guards.js";
import {
  NANO_GPT_REASONING_TAG_PAIRS,
  NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS,
  NANO_GPT_FUNCTION_CALL_MARKERS,
  countNanoGptSubstringOccurrences,
} from "./markers.js";

export type NanoGptStreamMarkerInspection = Readonly<{
  reasoningMarkerNames: readonly string[];
  reasoningIsUnbalanced: boolean;
  xmlLikeToolWrapperMarkers: readonly string[];
  functionCallMarkers: readonly string[];
  toolLikeMarkers: readonly string[];
}>;

export function collectNanoGptStreamMarkerInspection(
  visibleText: string,
): NanoGptStreamMarkerInspection {
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
    reasoningMarkerNames: [...reasoningMarkerNames],
    reasoningIsUnbalanced,
    xmlLikeToolWrapperMarkers,
    functionCallMarkers,
    toolLikeMarkers: [...new Set([...xmlLikeToolWrapperMarkers, ...functionCallMarkers])],
  };
}

export type NanoGptContentBlocksInspection = Readonly<{
  visibleText: string;
  textBlockCount: number;
  thinkingBlockCount: number;
  toolCallCount: number;
}>;

export function collectNanoGptContentBlocksInspection(
  content: unknown[],
): NanoGptContentBlocksInspection {
  let visibleText = "";
  let textBlockCount = 0;
  let thinkingBlockCount = 0;
  let toolCallCount = 0;

  for (const contentBlock of content) {
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
      continue;
    }
  }

  return {
    visibleText,
    textBlockCount,
    thinkingBlockCount,
    toolCallCount,
  };
}
