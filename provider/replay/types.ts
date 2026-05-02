import type { NanoGptAnomalyWarning } from "../anomaly-logger.js";

export type NanoGptReplayWarnFn = (warning: NanoGptAnomalyWarning) => void;

export type NanoGptReplayAssistantToolCall = Readonly<{
  id: string;
  name: string;
  missingId: boolean;
}>;

export type NanoGptReplayAssistantInspection = Readonly<{
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

export type NanoGptReplayToolResultInspection = Readonly<{
  toolCallId: string;
  toolName: string;
  missingToolCallId: boolean;
  missingToolName: boolean;
}>;

export type NanoGptReplayWarningContext = Readonly<{
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