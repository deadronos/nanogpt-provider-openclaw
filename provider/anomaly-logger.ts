import type {
  NanoGptAnomalyKind,
  NanoGptAnomalyStage,
  NanoGptModelFamily,
  NanoGptShapeSummary,
} from "./anomaly-types.js";

export type NanoGptWarnLogger = {
  warn: (message: string, ...meta: unknown[]) => void;
};

export type NanoGptWarnOnceLoggerOptions<TWarning> = Readonly<{
  logger: NanoGptWarnLogger;
  buildSignature: (warning: TWarning) => string;
  formatMessage: (warning: TWarning) => string;
}>;

export type NanoGptAnomalySafeMetadata = Readonly<{
  markerNames?: readonly string[];
  toolNames?: readonly string[];
  toolCount?: number;
  finishReason?: string;
  replayTurnIndexes?: readonly number[];
  replayRoles?: readonly string[];
  notes?: readonly string[];
}>;

export type NanoGptAnomalyWarning = Readonly<{
  kind: NanoGptAnomalyKind;
  stage: NanoGptAnomalyStage;
  providerId: string;
  modelId: string;
  modelFamily: NanoGptModelFamily;
  transportApi?: string;
  expectedShapeSummary: NanoGptShapeSummary;
  observedShapeSummary: NanoGptShapeSummary;
  metadata?: NanoGptAnomalySafeMetadata;
  message?: string;
}>;

function normalizeNanoGptSafeText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

function truncateNanoGptSafeText(value: string, maxLength: number): string {
  if (!Number.isFinite(maxLength) || maxLength <= 0) {
    return value;
  }

  const normalizedMaxLength = Math.floor(maxLength);
  if (value.length <= normalizedMaxLength) {
    return value;
  }

  if (normalizedMaxLength <= 3) {
    return value.slice(0, normalizedMaxLength);
  }

  return `${value.slice(0, normalizedMaxLength - 3)}...`;
}

function normalizeNanoGptNameList(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const normalizedValues = new Set<string>();
  for (const value of values) {
    const normalizedValue = normalizeNanoGptSafeText(value);
    if (normalizedValue) {
      normalizedValues.add(normalizedValue);
    }
  }

  return [...normalizedValues];
}

function normalizeNanoGptNumberList(values: readonly number[] | undefined): number[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const normalizedValues = new Set<number>();
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      normalizedValues.add(Math.floor(value));
    }
  }

  return [...normalizedValues];
}

function summarizeNanoGptNameList(label: string, values: readonly string[] | undefined): string | undefined {
  const normalizedLabel = normalizeNanoGptSafeText(label);
  if (!normalizedLabel) {
    return undefined;
  }

  const normalizedValues = normalizeNanoGptNameList(values);
  if (normalizedValues.length === 0) {
    return undefined;
  }

  return `${normalizedLabel}=${normalizedValues.join(",")}`;
}

function summarizeNanoGptNumberList(label: string, values: readonly number[] | undefined): string | undefined {
  const normalizedLabel = normalizeNanoGptSafeText(label);
  if (!normalizedLabel) {
    return undefined;
  }

  const normalizedValues = normalizeNanoGptNumberList(values);
  if (normalizedValues.length === 0) {
    return undefined;
  }

  return `${normalizedLabel}=${normalizedValues.join(",")}`;
}

export function normalizeNanoGptFreeformMessage(message: string | undefined): string | undefined {
  return normalizeNanoGptSafeText(message);
}

export function summarizeNanoGptFreeformMessage(
  message: string | undefined,
  maxLength = 200,
): string {
  const normalizedMessage = normalizeNanoGptFreeformMessage(message);
  if (!normalizedMessage) {
    return "(no message)";
  }

  return truncateNanoGptSafeText(normalizedMessage, maxLength);
}

export function summarizeNanoGptMarkerNames(
  markerNames: readonly string[] | undefined,
): string | undefined {
  return summarizeNanoGptNameList("markers", markerNames);
}

export function summarizeNanoGptToolNames(
  toolNames: readonly string[] | undefined,
): string | undefined {
  return summarizeNanoGptNameList("toolNames", toolNames);
}

export function summarizeNanoGptToolCount(toolCount: number | undefined): string | undefined {
  if (typeof toolCount !== "number" || !Number.isFinite(toolCount) || toolCount < 0) {
    return undefined;
  }

  return `toolCount=${Math.floor(toolCount)}`;
}

export function summarizeNanoGptShapeSummary(summary: NanoGptShapeSummary): string {
  const details = summary.details.length > 0 ? ` | ${summary.details.join("; ")}` : "";
  return `${summary.kind}:${summary.headline}${details}`;
}

export function summarizeNanoGptAnomalyMetadata(
  metadata: NanoGptAnomalySafeMetadata | undefined,
): string[] {
  if (!metadata) {
    return [];
  }

  const details: string[] = [];
  const markerNames = summarizeNanoGptMarkerNames(metadata.markerNames);
  if (markerNames) {
    details.push(markerNames);
  }

  const toolNames = summarizeNanoGptToolNames(metadata.toolNames);
  if (toolNames) {
    details.push(toolNames);
  }

  const toolCount = summarizeNanoGptToolCount(metadata.toolCount);
  if (toolCount) {
    details.push(toolCount);
  }

  const finishReason = normalizeNanoGptFreeformMessage(metadata.finishReason);
  if (finishReason) {
    details.push(`finishReason=${summarizeNanoGptFreeformMessage(finishReason)}`);
  }

  const replayTurnIndexes = summarizeNanoGptNumberList("replayTurns", metadata.replayTurnIndexes);
  if (replayTurnIndexes) {
    details.push(replayTurnIndexes);
  }

  const replayRoles = summarizeNanoGptNameList("replayRoles", metadata.replayRoles);
  if (replayRoles) {
    details.push(replayRoles);
  }

  for (const note of metadata.notes ?? []) {
    const normalizedNote = normalizeNanoGptFreeformMessage(note);
    if (normalizedNote) {
      details.push(`note=${summarizeNanoGptFreeformMessage(normalizedNote)}`);
    }
  }

  return details;
}

export function buildNanoGptAnomalyWarnOnceSignature(warning: NanoGptAnomalyWarning): string {
  return [
    warning.kind,
    warning.stage,
    normalizeNanoGptSafeText(warning.providerId) ?? "(unknown provider)",
    normalizeNanoGptSafeText(warning.modelId) ?? "(unknown model)",
    warning.modelFamily,
    normalizeNanoGptSafeText(warning.transportApi) ?? "",
    summarizeNanoGptShapeSummary(warning.expectedShapeSummary),
    summarizeNanoGptShapeSummary(warning.observedShapeSummary),
    ...summarizeNanoGptAnomalyMetadata(warning.metadata),
  ].join("|");
}

export function formatNanoGptAnomalyWarning(warning: NanoGptAnomalyWarning): string {
  const transportApi = normalizeNanoGptSafeText(warning.transportApi);
  const parts = [
    `kind=${warning.kind}`,
    `stage=${warning.stage}`,
    `provider=${normalizeNanoGptSafeText(warning.providerId) ?? "(unknown provider)"}`,
    `model=${normalizeNanoGptSafeText(warning.modelId) ?? "(unknown model)"}`,
    `family=${warning.modelFamily}`,
    ...(transportApi ? [`transportApi=${transportApi}`] : []),
    `expected=${summarizeNanoGptShapeSummary(warning.expectedShapeSummary)}`,
    `observed=${summarizeNanoGptShapeSummary(warning.observedShapeSummary)}`,
    ...summarizeNanoGptAnomalyMetadata(warning.metadata),
  ];

  const summary = warning.message ? `: ${summarizeNanoGptFreeformMessage(warning.message)}` : "";
  return `[nanogpt anomaly] ${parts.join(", ")}${summary}`;
}

export function createNanoGptWarnOnceLogger<TWarning>(
  params: NanoGptWarnOnceLoggerOptions<TWarning>,
): (warning: TWarning) => void {
  const warnedSignatures = new Set<string>();

  return (warning: TWarning) => {
    const signature = params.buildSignature(warning);
    if (warnedSignatures.has(signature)) {
      return;
    }

    warnedSignatures.add(signature);
    params.logger.warn(params.formatMessage(warning));
  };
}

export function createNanoGptAnomalyWarnOnceLogger(params: {
  logger: NanoGptWarnLogger;
}): (warning: NanoGptAnomalyWarning) => void {
  return createNanoGptWarnOnceLogger({
    logger: params.logger,
    buildSignature: buildNanoGptAnomalyWarnOnceSignature,
    formatMessage: formatNanoGptAnomalyWarning,
  });
}