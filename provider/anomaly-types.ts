export const NANOGPT_ANOMALY_STAGES = [
  "request",
  "stream_result",
  "replay_sanitize",
  "replay_validate",
  "provider_error",
] as const;

export type NanoGptAnomalyStage = (typeof NANOGPT_ANOMALY_STAGES)[number];

export const NANOGPT_ANOMALY_KINDS = [
  "tool_request_expected_no_tools_registered",
  "tool_request_expected_invalid_tool_choice",
  "tool_enabled_turn_without_tool_call",
  "tool_enabled_turn_with_tool_like_text",
  "tool_enabled_turn_with_empty_visible_output",
  "visible_output_contains_reasoning_tags",
  "visible_output_contains_unbalanced_reasoning_tags",
  "visible_output_contains_xml_like_tool_wrappers",
  "visible_output_contains_function_call_markers",
  "replay_contains_reasoning_leak",
  "replay_contains_tool_like_text",
  "replay_has_invalid_tool_ordering",
  "replay_has_missing_tool_call_id",
  "replay_has_inconsistent_assistant_tool_state",
  "structured_provider_error_mapped",
  "structured_provider_error_unmapped",
  "structured_provider_error_unknown_envelope",
  "context_overflow_error_detected",
] as const;

export type NanoGptAnomalyKind = (typeof NANOGPT_ANOMALY_KINDS)[number];

export const NANOGPT_MODEL_FAMILIES = ["kimi", "glm", "qwen", "other"] as const;

export type NanoGptModelFamily = (typeof NANOGPT_MODEL_FAMILIES)[number];

export type NanoGptModelIdentitySource = Readonly<{
  modelId?: string | null;
  model?: Readonly<{
    id?: string | null;
  }> | null;
}>;

export type NanoGptShapeSummaryKind = "expected" | "observed";

export type NanoGptShapeSummaryGroup = Readonly<{
  label: string;
  values: readonly string[];
}>;

export type NanoGptShapeSummaryInput = Readonly<{
  headline: string;
  counts?: Readonly<Record<string, number>>;
  groups?: readonly NanoGptShapeSummaryGroup[];
  notes?: readonly string[];
}>;

export type NanoGptShapeSummary = Readonly<{
  kind: NanoGptShapeSummaryKind;
  headline: string;
  details: readonly string[];
}>;

export type NanoGptAnomalyPayload = Readonly<{
  kind: NanoGptAnomalyKind;
  stage: NanoGptAnomalyStage;
  providerId: string;
  modelId: string;
  modelFamily: NanoGptModelFamily;
  transportApi?: string;
  expectedShapeSummary: NanoGptShapeSummary;
  observedShapeSummary: NanoGptShapeSummary;
}>;

function normalizeNanoGptShapeText(value: string | undefined): string | undefined {
  const normalized = value?.replace(/\s+/g, " ").trim();
  return normalized ? normalized : undefined;
}

function normalizeNanoGptShapeValues(values: readonly string[] | undefined): string[] {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }

  const normalizedValues = new Set<string>();
  for (const value of values) {
    const normalizedValue = normalizeNanoGptShapeText(value);
    if (normalizedValue) {
      normalizedValues.add(normalizedValue);
    }
  }

  return [...normalizedValues];
}

function buildNanoGptShapeSummary(
  kind: NanoGptShapeSummaryKind,
  input: NanoGptShapeSummaryInput,
): NanoGptShapeSummary {
  const headline = normalizeNanoGptShapeText(input.headline) ?? "(unspecified shape)";
  const details: string[] = [];

  if (input.counts) {
    for (const key of Object.keys(input.counts).sort()) {
      const normalizedKey = normalizeNanoGptShapeText(key);
      const value = input.counts[key];
      if (!normalizedKey || typeof value !== "number" || !Number.isFinite(value)) {
        continue;
      }
      details.push(`${normalizedKey}=${value}`);
    }
  }

  for (const group of input.groups ?? []) {
    const label = normalizeNanoGptShapeText(group.label);
    if (!label) {
      continue;
    }

    const values = normalizeNanoGptShapeValues(group.values);
    if (values.length === 0) {
      continue;
    }

    details.push(`${label}=${values.join(",")}`);
  }

  for (const note of normalizeNanoGptShapeValues(input.notes)) {
    details.push(`note=${note}`);
  }

  return {
    kind,
    headline,
    details,
  };
}

export function buildNanoGptExpectedShapeSummary(
  input: NanoGptShapeSummaryInput,
): NanoGptShapeSummary {
  return buildNanoGptShapeSummary("expected", input);
}

export function buildNanoGptObservedShapeSummary(
  input: NanoGptShapeSummaryInput,
): NanoGptShapeSummary {
  return buildNanoGptShapeSummary("observed", input);
}

export function resolveNanoGptModelId(source: NanoGptModelIdentitySource): string {
  const resolvedModelId =
    typeof source.model?.id === "string" && source.model.id.trim().length > 0
      ? source.model.id.trim()
      : undefined;
  if (resolvedModelId) {
    return resolvedModelId;
  }

  return typeof source.modelId === "string" ? source.modelId.trim() : "";
}

export function resolveNanoGptModelFamily(modelId: string): NanoGptModelFamily {
  const normalized = modelId.trim().toLowerCase();
  if (normalized.startsWith("moonshotai/kimi")) {
    return "kimi";
  }
  if (normalized.startsWith("zai-org/glm") || normalized.includes("/glm")) {
    return "glm";
  }
  if (normalized.includes("qwen")) {
    return "qwen";
  }
  return "other";
}

export function detectNanoGptModelFamily(modelId: string): NanoGptModelFamily {
  return resolveNanoGptModelFamily(modelId);
}