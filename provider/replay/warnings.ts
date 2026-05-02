import {
  createNanoGptAnomalyWarnOnceLogger,
  type NanoGptWarnLogger,
} from "../anomaly-logger.js";
import {
  buildNanoGptExpectedShapeSummary,
  buildNanoGptObservedShapeSummary,
} from "../anomaly-types.js";
import type {
  NanoGptReplayWarnFn,
  NanoGptReplayWarningContext,
} from "./types.js";

const NANO_GPT_REPLAY_WARNING_LOGGER_CACHE = new WeakMap<
  NanoGptWarnLogger,
  NanoGptReplayWarnFn
>();

export function createNanoGptReplayAnomalyLogger(
  logger?: NanoGptWarnLogger,
): NanoGptReplayWarnFn | undefined {
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

export function emitNanoGptReplayWarning(params: NanoGptReplayWarningContext): void {
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

export function emitNanoGptReplayOrderingWarning(params: {
  warnNanoGptAnomaly: NanoGptReplayWarnFn;
  modelId: string;
  modelFamily: Parameters<NanoGptReplayWarnFn>[0]["modelFamily"];
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

export function emitNanoGptReplayMissingIdWarning(params: {
  warnNanoGptAnomaly: NanoGptReplayWarnFn;
  modelId: string;
  modelFamily: Parameters<NanoGptReplayWarnFn>[0]["modelFamily"];
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

export function emitNanoGptReplayToolStateWarning(params: {
  warnNanoGptAnomaly: NanoGptReplayWarnFn;
  modelId: string;
  modelFamily: Parameters<NanoGptReplayWarnFn>[0]["modelFamily"];
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