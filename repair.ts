import { jsonrepair } from "jsonrepair";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Tool,
} from "@mariozechner/pi-ai";
import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";

type StreamFn = NonNullable<ProviderWrapStreamFnContext["streamFn"]>;

export type RepairLogger = {
  warn: (message: string) => void;
  info: (message: string) => void;
};

export type ToolCallRepairOptions = {
  debug?: boolean;
  retryInvalidEmptyTurns?: boolean;
};

type RepairRuntimeMeta = {
  modelId: string;
  requestApi?: string;
  attempt: number;
  debug: boolean;
};

type RepairAttempt = {
  events: AssistantMessageEvent[];
  finalMessage: AssistantMessage;
  toolEnabled: boolean;
  sawToolCall: boolean;
  sawVisibleText: boolean;
  sawBrokenToolIntent: boolean;
};

export type NanoGptRepairFamily = "kimi" | "glm" | "qwen" | "other";
type NanoGptRepairLogFamily = Exclude<NanoGptRepairFamily, "other">;

export type NanoGptRepairProfile = {
  family: NanoGptRepairFamily;
  useBufferedRepair: boolean;
  useLiveGuard: boolean;
  useSemanticToolDiagnostics: boolean;
  useToolSchemaHints: boolean;
};

const EMPTY_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

const INVALID_EMPTY_TOOL_TURN_RETRY_PROMPT =
  "NanoGPT retry note: the previous response was invalid because it produced no visible content or tool call for a tool-enabled turn. Reply again with either concise visible text or a valid tool call. If you use a tool, emit the tool call directly with valid JSON arguments and no markdown fences.";

const TOOL_CALL_CONTAINER_KEYS = ["tool_calls", "toolCalls", "tools", "calls", "actions"] as const;
const TOOL_ARGUMENT_KEYS = ["arguments", "args", "parameters", "input"] as const;
const MODEL_SPECIAL_TOKEN_RE = /<[|｜][^|｜]*[|｜]>/g;
const THINKING_PLACEHOLDER_RE = /^thinking(?:\.\.\.)?$/i;
const PSEUDO_TOOL_WRAPPER_TAG_NAMES = new Set(["use_tool", "tool", "tool_call", "toolcall", "find", "glob", "read", "write", "exec", "bash", "run"]);
const PSEUDO_TOOL_NAME_ATTRIBUTE_PATTERN = /\bname\s*=\s*(?:"([^"]+)"|'([^']+)')/i;
const TOOL_CALL_RESERVED_KEYS = new Set<string>([
  "id",
  "type",
  "name",
  "tool",
  "toolName",
  "function",
  "message",
  "text",
  "mode",
  ...TOOL_ARGUMENT_KEYS,
  ...TOOL_CALL_CONTAINER_KEYS,
]);

function normalizeNanoGptRepairModelId(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  return normalized.startsWith("nanogpt/") ? normalized.slice("nanogpt/".length) : normalized;
}

function isQwenModel(normalizedModelId: string): boolean {
  return normalizedModelId.startsWith("qwen/");
}

function resolveNanoGptRepairFamily(modelId?: string): NanoGptRepairFamily {
  if (!modelId?.trim()) {
    return "other";
  }

  const normalized = normalizeNanoGptRepairModelId(modelId);
  if (normalized.startsWith("moonshotai/kimi")) {
    return "kimi";
  }
  if (normalized.startsWith("zai-org/glm")) {
    return "glm";
  }
  if (isQwenModel(normalized)) {
    return "qwen";
  }
  return "other";
}

export function resolveNanoGptRepairProfile(modelId?: string): NanoGptRepairProfile {
  const family = resolveNanoGptRepairFamily(modelId);
  switch (family) {
    case "kimi":
      return {
        family,
        useBufferedRepair: true,
        useLiveGuard: true,
        useSemanticToolDiagnostics: false,
        useToolSchemaHints: false,
      };
    case "glm":
      return {
        family,
        useBufferedRepair: false,
        useLiveGuard: true,
        useSemanticToolDiagnostics: true,
        useToolSchemaHints: true,
      };
    case "qwen":
      return {
        family,
        useBufferedRepair: true,
        useLiveGuard: true,
        useSemanticToolDiagnostics: false,
        useToolSchemaHints: true,
      };
    default:
      return {
        family,
        useBufferedRepair: false,
        useLiveGuard: true,
        useSemanticToolDiagnostics: false,
        useToolSchemaHints: false,
      };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function shouldRepairNanoGptToolCallArguments(modelId?: string): boolean {
  return resolveNanoGptRepairProfile(modelId).useBufferedRepair;
}

function normalizeAssistantMessage(
  message: Partial<AssistantMessage> | undefined,
  meta: Pick<RepairRuntimeMeta, "modelId" | "requestApi">,
): AssistantMessage {
  const candidate = isRecord(message) ? (message as Partial<AssistantMessage>) : undefined;
  return {
    role: "assistant",
    content: Array.isArray(candidate?.content) ? [...candidate.content] : [],
    api: typeof candidate?.api === "string" ? candidate.api : meta.requestApi ?? "openai-completions",
    provider: typeof candidate?.provider === "string" ? candidate.provider : "nanogpt",
    model: typeof candidate?.model === "string" ? candidate.model : meta.modelId,
    ...(typeof candidate?.responseId === "string" ? { responseId: candidate.responseId } : {}),
    usage: isRecord(candidate?.usage)
      ? (candidate.usage as AssistantMessage["usage"])
      : {
          ...EMPTY_USAGE,
          cost: { ...EMPTY_USAGE.cost },
        },
    stopReason: candidate?.stopReason ?? "stop",
    ...(typeof candidate?.errorMessage === "string" ? { errorMessage: candidate.errorMessage } : {}),
    timestamp: typeof candidate?.timestamp === "number" ? candidate.timestamp : Date.now(),
  };
}

function shouldInsertSeparator(before: string | undefined, after: string | undefined): boolean {
  return Boolean(before && after && !/\s/.test(before) && !/\s/.test(after));
}

function stripModelSpecialTokens(text: string): string {
  if (!text) {
    return text;
  }

  MODEL_SPECIAL_TOKEN_RE.lastIndex = 0;
  if (!MODEL_SPECIAL_TOKEN_RE.test(text)) {
    return text;
  }
  MODEL_SPECIAL_TOKEN_RE.lastIndex = 0;

  let stripped = "";
  let cursor = 0;
  for (const match of text.matchAll(MODEL_SPECIAL_TOKEN_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    stripped += text.slice(cursor, start);
    if (shouldInsertSeparator(text[start - 1], text[end])) {
      stripped += " ";
    }
    cursor = end;
  }
  stripped += text.slice(cursor);
  return stripped;
}

function isBareToolNamePlaceholderText(
  text: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): boolean {
  if (!text || tools.length === 0) {
    return false;
  }

  if (!/^[a-z0-9_\-\s]+$/i.test(text)) {
    return false;
  }

  const normalized = canonicalizeToolName(text);
  if (!normalized) {
    return false;
  }

  return Boolean(toolMap?.get(normalized) ?? resolveKnownTool(text, tools, toolMap));
}

function isKnownToolWrapperLine(
  line: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): boolean {
  const match = line.trim().match(/^<\/?([a-zA-Z][\w-]*)\b[^>]*>/);
  if (!match?.[1]) {
    return false;
  }

  const tagName = match[1].trim();
  if (["function", "invoke", "parameter", "tool_call", "toolcall", "execution"].includes(tagName.toLowerCase())) {
    return false;
  }

  return Boolean(resolveKnownTool(tagName, tools, toolMap));
}

function isStructuredToolMarkerLine(
  line: string,
  tools: readonly Tool[] = [],
  toolMap?: Map<string, Tool>,
): boolean {
  return (
    /^<\/?(?:function|invoke|parameter|tool_call|toolcall|execution)\b|^<function=/i.test(
      line.trim(),
    ) || isKnownToolWrapperLine(line, tools, toolMap)
  );
}

function isToolArgumentFragmentLine(
  line: string,
  tools: readonly Tool[] = [],
  toolMap?: Map<string, Tool>,
): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }

  return (
    /^```/i.test(trimmed) ||
    isStructuredToolMarkerLine(trimmed, tools, toolMap) ||
    /^(?:[{[\]}(),]+|["'][^"']*["']\s*:)/.test(trimmed) ||
    /^(?:command|arguments?|args|input|path|url|selector|ref|fields|timeout|cwd)\b\s*[:=>]/i.test(trimmed)
  );
}

function findBrokenToolIntentStartIndex(
  lines: string[],
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (!line) {
      continue;
    }

    const lineWithoutTrailingPunctuation = line.replace(/[():;]+$/g, "").trim();
    const looksLikeToolStart =
      isBareToolNamePlaceholderText(line, tools, toolMap) ||
      isBareToolNamePlaceholderText(lineWithoutTrailingPunctuation, tools, toolMap) ||
      isStructuredToolMarkerLine(line, tools, toolMap);
    if (!looksLikeToolStart) {
      continue;
    }

    const tail = lines.slice(index + 1);
    if (tail.every((entry) => isToolArgumentFragmentLine(entry, tools, toolMap))) {
      return index;
    }
  }

  return -1;
}

function findKnownToolWrapperMatches(
  text: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): Array<{ tool: Tool; body: string; start: number; end: number }> {
  const matches: Array<{ tool: Tool; body: string; start: number; end: number }> = [];
  const wrapperPattern = /<([a-zA-Z][\w-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;

  for (const match of text.matchAll(wrapperPattern)) {
    const rawTagName = match[1]?.trim();
    if (!rawTagName) {
      continue;
    }

    const tool = resolveKnownTool(rawTagName, tools, toolMap);
    if (!tool) {
      continue;
    }

    const start = match.index ?? 0;
    matches.push({
      tool,
      body: match[2] ?? "",
      start,
      end: start + match[0].length,
    });
  }

  return matches;
}

function stripTrailingKnownToolWrapperText(
  text: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): string {
  const trimmed = text.trim();
  if (!trimmed || tools.length === 0) {
    return trimmed;
  }

  for (const match of findKnownToolWrapperMatches(trimmed, tools, toolMap)) {
    const trailingText = trimmed.slice(match.end).trim();
    if (trailingText.length > 0) {
      continue;
    }

    return trimmed.slice(0, match.start).trim();
  }

  return trimmed;
}

function containsKnownToolWrapperText(
  text: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): boolean {
  return findKnownToolWrapperMatches(text.trim(), tools, toolMap).length > 0;
}

function stripTrailingBrokenToolIntentText(
  text: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): string {
  if (!text || tools.length === 0) {
    return text.trim();
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return "";
  }

  const brokenStartIndex = findBrokenToolIntentStartIndex(lines, tools, toolMap);
  if (brokenStartIndex === -1) {
    return stripTrailingKnownToolWrapperText(text, tools, toolMap);
  }

  return lines.slice(0, brokenStartIndex).join("\n").trim();
}

function looksLikeBrokenToolIntentText(
  text: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): boolean {
  const stripped = stripModelSpecialTokens(text).trim();
  if (!stripped || tools.length === 0) {
    return false;
  }

  if (isBareToolNamePlaceholderText(stripped, tools, toolMap)) {
    return true;
  }

  if (stripTrailingBrokenToolIntentText(stripped, tools, toolMap) !== stripped) {
    return true;
  }

  return (
    /<(?:function=|\/?function\b|\/?invoke\b|\/?parameter\b|\/?tool_call\b|\/?toolcall\b|\/?execution\b)/i.test(
      stripped,
    ) ||
    containsKnownToolWrapperText(stripped, tools, toolMap) ||
    containsInvalidStructuredToolPayload(stripped, tools, toolMap)
  );
}

function sanitizeAssistantText(
  text: string,
  tools: readonly Tool[] = [],
  toolMap?: Map<string, Tool>,
): string {
  const stripped = stripModelSpecialTokens(text).trim();
  if (!stripped) {
    return "";
  }

  if (stripped !== text.trim() && THINKING_PLACEHOLDER_RE.test(stripped)) {
    return "";
  }

  if (containsInvalidStructuredToolPayload(stripped, tools, toolMap)) {
    return "";
  }

  const withoutBrokenToolTail = stripTrailingBrokenToolIntentText(stripped, tools, toolMap);
  if (!withoutBrokenToolTail && looksLikeBrokenToolIntentText(stripped, tools, toolMap)) {
    return "";
  }

  return withoutBrokenToolTail;
}

function sanitizeAssistantMessage(
  message: AssistantMessage,
  tools: readonly Tool[] = [],
  toolMap?: Map<string, Tool>,
): { message: AssistantMessage; changed: boolean } {
  let changed = false;
  const nextContent: AssistantMessage["content"] = [];

  for (const block of message.content) {
    if (block.type !== "text") {
      nextContent.push(block);
      continue;
    }

    const sanitizedText = sanitizeAssistantText(block.text, tools, toolMap);
    if (!sanitizedText) {
      changed = true;
      continue;
    }

    if (sanitizedText !== block.text) {
      changed = true;
      nextContent.push({
        ...block,
        text: sanitizedText,
      });
      continue;
    }

    nextContent.push(block);
  }

  return changed
    ? {
        message: {
          ...message,
          content: nextContent,
        },
        changed: true,
      }
    : { message, changed: false };
}

function hasVisibleText(
  message: AssistantMessage,
  tools: readonly Tool[] = [],
  toolMap?: Map<string, Tool>,
): boolean {
  return message.content.some(
    (block) =>
      block.type === "text" &&
      typeof block.text === "string" &&
      sanitizeAssistantText(block.text, tools, toolMap).length > 0,
  );
}

function hasBrokenToolIntent(
  message: AssistantMessage,
  tools: readonly Tool[] = [],
  toolMap?: Map<string, Tool>,
): boolean {
  return message.content.some(
    (block) =>
      block.type === "text" &&
      typeof block.text === "string" &&
      looksLikeBrokenToolIntentText(block.text, tools, toolMap),
  );
}

function countToolCalls(message: AssistantMessage): number {
  return message.content.filter((block) => block.type === "toolCall").length;
}

function countTextCharacters(message: AssistantMessage): number {
  return message.content.reduce((total, block) => {
    if (block.type !== "text") {
      return total;
    }

    return total + block.text.length;
  }, 0);
}

function resolveSyntheticDoneReason(
  message: AssistantMessage,
): Extract<AssistantMessageEvent, { type: "done" }>["reason"] {
  if (countToolCalls(message) > 0) {
    return "toolUse";
  }
  if (message.stopReason === "length") {
    return "length";
  }
  return "stop";
}

function hasToolEnabledContext(context: Parameters<StreamFn>[1]): boolean {
  return Array.isArray(context?.tools) && context.tools.length > 0;
}

export function canonicalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function createToolMap(tools: readonly Tool[]): Map<string, Tool> {
  const map = new Map<string, Tool>();
  for (const tool of tools) {
    const canonicalName = canonicalizeToolName(tool.name);
    if (!map.has(canonicalName)) {
      map.set(canonicalName, tool);
    }
  }
  return map;
}

export function resolveKnownToolName(name: string, tools: readonly Tool[], toolMap?: Map<string, Tool>): string {
  const normalized = canonicalizeToolName(name);
  if (toolMap) {
    return toolMap.get(normalized)?.name ?? name.trim();
  }
  const match = tools.find((tool) => canonicalizeToolName(tool.name) === normalized);
  return match?.name ?? name.trim();
}

export function resolveKnownTool(name: string, tools: readonly Tool[], toolMap?: Map<string, Tool>): Tool | undefined {
  const normalized = canonicalizeToolName(name);
  if (toolMap) {
    return toolMap.get(normalized);
  }
  return tools.find((tool) => canonicalizeToolName(tool.name) === normalized);
}

function logReliabilityArtifact(
  logger: RepairLogger,
  meta: RepairRuntimeMeta,
  artifact: Record<string, unknown>,
  force = false,
): void {
  if (!force && !meta.debug) {
    return;
  }

  const family = resolveNanoGptRepairFamily(meta.modelId);
  logger.info(
    `[nanogpt][tool-reliability] ${JSON.stringify({
      plugin: "nanogpt",
      family,
      modelId: meta.modelId,
      requestApi: meta.requestApi ?? "unknown",
      attempt: meta.attempt,
      ...artifact,
    })}`,
  );
}

const NANOGPT_REPAIR_EVENT_MAP: Record<NanoGptRepairLogFamily, string> = {
  kimi: "nanogpt_kimi",
  glm: "nanogpt_glm",
  qwen: "nanogpt_qwen",
};

function resolveNanoGptRepairEventName(modelId: string, eventName: string): string {
  const family = resolveNanoGptRepairFamily(modelId);
  if (family === "other") {
    return eventName;
  }

  return `${NANOGPT_REPAIR_EVENT_MAP[family]}_${eventName}`;
}

function logNanoGptRepairArtifact(
  logger: RepairLogger,
  meta: RepairRuntimeMeta,
  eventName: string,
  artifact: Record<string, unknown>,
  force = false,
): void {
  logReliabilityArtifact(
    logger,
    meta,
    {
      event: resolveNanoGptRepairEventName(meta.modelId, eventName),
      ...artifact,
    },
    force || resolveNanoGptRepairFamily(meta.modelId) !== "other",
  );
}

function isMalformedToolCallJson(rawArgs: string): boolean {
  try {
    JSON.parse(rawArgs);
    return false;
  } catch {
    return true;
  }
}

function logObservedMalformedToolCall(params: {
  contentIndex: number;
  toolName: string;
  rawArgs: string;
  logger: RepairLogger;
  meta: RepairRuntimeMeta;
  loggedContentIndexes: Set<number>;
}): void {
  if (params.loggedContentIndexes.has(params.contentIndex)) {
    return;
  }

  params.loggedContentIndexes.add(params.contentIndex);
  params.logger.warn(
    `[nanogpt] Observed malformed tool call arguments from model ${params.meta.modelId} (api=${params.meta.requestApi ?? "unknown"}) for tool "${params.toolName}". Automatic repair is not enabled for this model family; investigate whether this model should get targeted reliability handling.`,
  );
  logNanoGptRepairArtifact(params.logger, params.meta, "malformed_tool_call_observed", {
    toolName: params.toolName,
    rawArgumentLength: params.rawArgs.length,
    repairEnabled: false,
  });
}

function getToolParameterSchema(tool: Tool): Record<string, unknown> | undefined {
  return isRecord(tool.parameters) ? tool.parameters : undefined;
}

function getToolSchemaRequiredFields(schema: Record<string, unknown>): string[] {
  const required = schema.required;
  if (!Array.isArray(required)) {
    return [];
  }

  return required.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
}

function getToolSchemaPropertyNames(schema: Record<string, unknown>): string[] {
  const properties = schema.properties;
  return isRecord(properties) ? Object.keys(properties) : [];
}

function resolvePrimaryToolArgumentName(tool: Tool): string | undefined {
  const schema = getToolParameterSchema(tool);
  if (!schema) {
    return undefined;
  }

  const required = getToolSchemaRequiredFields(schema);
  if (required.length === 1) {
    return required[0];
  }

  const properties = getToolSchemaPropertyNames(schema);
  if (properties.length === 1) {
    return properties[0];
  }

  return undefined;
}

function hasMeaningfulToolArgument(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  if (isRecord(value)) {
    return Object.keys(value).length > 0;
  }

  return true;
}

function coerceToolArgumentsToSchema(
  tool: Tool,
  argumentsRecord: Record<string, unknown>,
): Record<string, unknown> {
  const primaryArgument = resolvePrimaryToolArgumentName(tool);
  if (
    primaryArgument &&
    "value" in argumentsRecord &&
    hasMeaningfulToolArgument(argumentsRecord.value) &&
    Object.keys(argumentsRecord).length === 1
  ) {
    return {
      [primaryArgument]: argumentsRecord.value,
    };
  }

  return argumentsRecord;
}

function hasValidSalvagedToolArguments(
  tool: Tool,
  argumentsRecord: Record<string, unknown>,
): boolean {
  const schema = getToolParameterSchema(tool);
  if (!schema) {
    return true;
  }

  const required = getToolSchemaRequiredFields(schema);
  if (required.some((field) => !hasMeaningfulToolArgument(argumentsRecord[field]))) {
    return false;
  }

  const properties = getToolSchemaPropertyNames(schema);
  if (Object.keys(argumentsRecord).length === 0 && properties.length > 0) {
    return false;
  }

  return true;
}

function parseDiagnosticToolArguments(rawArgs: string): Record<string, unknown> | null {
  try {
    const parsed = parseJsonCandidate(rawArgs);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function logGlmSemanticToolDiagnostics(params: {
  contentIndex: number;
  toolName: string;
  rawArgs: string;
  tools: readonly Tool[];
  toolMap?: Map<string, Tool>;
  logger: RepairLogger;
  meta: RepairRuntimeMeta;
  loggedContentIndexes: Set<number>;
}): void {
  if (params.loggedContentIndexes.has(params.contentIndex)) {
    return;
  }

  const tool = resolveKnownTool(params.toolName, params.tools, params.toolMap);
  if (!tool) {
    return;
  }

  const schema = getToolParameterSchema(tool);
  if (!schema) {
    return;
  }

  const argumentsRecord = parseDiagnosticToolArguments(params.rawArgs);
  if (!argumentsRecord) {
    return;
  }

  const requiredFields = getToolSchemaRequiredFields(schema);
  const schemaFieldNames = getToolSchemaPropertyNames(schema);
  const highlightedFields = [...new Set([...requiredFields, ...schemaFieldNames])].filter((field) =>
    ["ref", "selector", "fields", "inputRef", "element"].includes(field),
  );
  const missingRequiredFields = requiredFields.filter(
    (field) => !hasMeaningfulToolArgument(argumentsRecord[field]),
  );
  const missingHighlightedFields = highlightedFields.filter(
    (field) => !hasMeaningfulToolArgument(argumentsRecord[field]),
  );

  if (missingRequiredFields.length === 0 && missingHighlightedFields.length === 0) {
    return;
  }

  params.loggedContentIndexes.add(params.contentIndex);
  const issueParts: string[] = [];
  if (missingRequiredFields.length > 0) {
    issueParts.push(`missing required field(s): ${missingRequiredFields.join(", ")}`);
  }
  if (missingHighlightedFields.length > 0) {
    issueParts.push(
      `likely missing ref/selector/fields-style argument(s): ${missingHighlightedFields.join(", ")}`,
    );
  }

  params.logger.warn(
    `[nanogpt] GLM semantic tool issue for tool "${tool.name}" from model ${params.meta.modelId} (api=${params.meta.requestApi ?? "unknown"}): ${issueParts.join("; ")}.`,
  );
  logNanoGptRepairArtifact(params.logger, params.meta, "semantic_tool_issue", {
    toolName: tool.name,
    requestedToolName: params.toolName,
    missingRequiredFields,
    missingHighlightedFields,
    schemaFieldNames,
    rawArgumentLength: params.rawArgs.length,
  });
}

function buildRetryContext(context: Parameters<StreamFn>[1]): Parameters<StreamFn>[1] {
  return {
    ...context,
    systemPrompt: context.systemPrompt?.trim()
      ? `${context.systemPrompt}\n\n${INVALID_EMPTY_TOOL_TURN_RETRY_PROMPT}`
      : INVALID_EMPTY_TOOL_TURN_RETRY_PROMPT,
  };
}

function resolveRequestedToolChoice(options: Parameters<StreamFn>[2]): unknown {
  if (!isRecord(options)) {
    return undefined;
  }

  if ("toolChoice" in options && options.toolChoice !== undefined) {
    return options.toolChoice;
  }

  if ("tool_choice" in options && options.tool_choice !== undefined) {
    return options.tool_choice;
  }

  return undefined;
}

function buildRetryOptions(
  options: Parameters<StreamFn>[2],
  profile: NanoGptRepairProfile,
): Parameters<StreamFn>[2] {
  if (profile.family !== "qwen") {
    return options;
  }

  const requestedToolChoice = resolveRequestedToolChoice(options);
  if (requestedToolChoice !== undefined && requestedToolChoice !== "auto") {
    return options;
  }

  return isRecord(options)
    ? ({ ...options, toolChoice: "required" } as Parameters<StreamFn>[2])
    : ({ toolChoice: "required" } as Parameters<StreamFn>[2]);
}

function parseJsonCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(jsonrepair(candidate));
  }
}

function isStructuredJsonCandidate(candidate: string): boolean {
  try {
    const parsed = parseJsonCandidate(candidate);
    return isRecord(parsed) || Array.isArray(parsed);
  } catch {
    return false;
  }
}

function extractBalancedJsonCandidate(text: string, opener: "{" | "[", closer: "}" | "]") {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === opener) {
      if (startIndex === -1) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }
    if (char === closer && startIndex !== -1) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

function extractRawToolPayloadCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (trimmed) {
    candidates.add(trimmed);
  }

  const fencedBlockPattern = /```(?:json)?(?:[ \t]*\r?\n)?([\s\S]*?)```/gi;
  for (const match of trimmed.matchAll(fencedBlockPattern)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.add(candidate);
    }
  }

  const objectCandidate = extractBalancedJsonCandidate(trimmed, "{", "}");
  if (objectCandidate) {
    candidates.add(objectCandidate.trim());
  }

  const arrayCandidate = extractBalancedJsonCandidate(trimmed, "[", "]");
  if (arrayCandidate) {
    candidates.add(arrayCandidate.trim());
  }

  return [...candidates];
}

function findBalancedDelimitedClose(
  text: string,
  openIndex: number,
  opener: string,
  closer: string,
): number {
  let depth = 0;
  let quoteChar: '"' | "'" | null = null;
  let escaped = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quoteChar) {
      if (char === quoteChar) {
        quoteChar = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quoteChar = char;
      continue;
    }
    if (char === opener) {
      depth += 1;
      continue;
    }
    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function extractAllTagAttributes(attributes: string): Record<string, string> {
  const result: Record<string, string> = {};
  const attrPattern = /([a-zA-Z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of attributes.matchAll(attrPattern)) {
    const key = match[1]?.trim();
    const value = match[2] ?? match[3] ?? match[4];
    if (key && value !== undefined) {
      result[key] = value.trim();
    }
  }
  return result;
}

function extractPseudoToolWrapperName(attributes: string): string | undefined {
  const match = attributes.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']+)'|([^\s>]+))/i);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

type XmlParameterBlock = {
  name: string;
  value: unknown;
  start: number;
  end: number;
};

function removeTextRanges(text: string, ranges: Array<Pick<XmlParameterBlock, "start" | "end">>): string {
  if (ranges.length === 0) {
    return text;
  }

  let cursor = 0;
  let stripped = "";
  for (const range of [...ranges].sort((left, right) => left.start - right.start)) {
    stripped += text.slice(cursor, range.start);
    cursor = range.end;
  }
  stripped += text.slice(cursor);
  return stripped;
}

function findMatchingXmlParameterClose(text: string, contentStartIndex: number): number {
  let cursor = contentStartIndex;
  let depth = 1;

  while (cursor < text.length) {
    const nextOpen = text.indexOf("<parameter", cursor);
    const nextClose = text.indexOf("</parameter>", cursor);
    if (nextClose === -1) {
      return -1;
    }
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      cursor = nextOpen + "<parameter".length;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return nextClose;
    }
    cursor = nextClose + "</parameter>".length;
  }

  return -1;
}

function extractXmlParameterName(attributes: string): string | undefined {
  const trimmed = attributes.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.startsWith("=")) {
    const inlineName = trimmed.slice(1).trim();
    return inlineName || undefined;
  }

  const namedMatch = trimmed.match(/\bname\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i);
  const namedValue = namedMatch?.[1] ?? namedMatch?.[2] ?? namedMatch?.[3];
  return typeof namedValue === "string" && namedValue.trim() ? namedValue.trim() : undefined;
}

function extractMalformedXmlParameterNameAndValue(
  attributes: string,
  rawContent: string,
): { name?: string; rawValue: string } {
  if (!/\bname\b/i.test(attributes)) {
    return { rawValue: rawContent };
  }

  const malformedMatch = rawContent.match(/^\s*([a-zA-Z_][\w.-]*)>([\s\S]*)$/);
  if (!malformedMatch) {
    return { rawValue: rawContent };
  }

  return {
    name: malformedMatch[1],
    rawValue: malformedMatch[2] ?? "",
  };
}

function parseXmlStyleParameterBlocks(text: string): XmlParameterBlock[] {
  const blocks: XmlParameterBlock[] = [];
  const openPattern = /<parameter\b([^>]*)>/gi;
  let cursor = 0;

  while (cursor < text.length) {
    openPattern.lastIndex = cursor;
    const match = openPattern.exec(text);
    if (!match || match.index < cursor) {
      break;
    }

    const contentStart = match.index + match[0].length;
    const closeStart = findMatchingXmlParameterClose(text, contentStart);
    const closeEnd = closeStart === -1 ? text.length : closeStart + "</parameter>".length;
    const rawContent = text.slice(contentStart, closeStart === -1 ? text.length : closeStart);
    const rawName = extractXmlParameterName(match[1] ?? "");
    const malformed = rawName
      ? { name: rawName, rawValue: rawContent }
      : extractMalformedXmlParameterNameAndValue(match[1] ?? "", rawContent);
    if (!malformed.name) {
      cursor = closeEnd;
      continue;
    }

    const nestedBlocks = parseXmlStyleParameterBlocks(malformed.rawValue);
    const outsideNestedText = removeTextRanges(malformed.rawValue, nestedBlocks).trim();
    const value =
      nestedBlocks.length > 0 && outsideNestedText.length === 0
        ? Object.fromEntries(nestedBlocks.map((block) => [block.name, block.value]))
        : malformed.rawValue.trim();

    blocks.push({
      name: malformed.name,
      value,
      start: match.index,
      end: closeEnd,
    });
    cursor = closeEnd;
  }

  return blocks;
}

function extractXmlStyleFunctionCallCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const functionPattern = /<(function|invoke)\b([^>]*)>/gi;
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }

  for (const match of trimmed.matchAll(functionPattern)) {
    const wrapperTag = match[1]?.trim().toLowerCase();
    const attributes = match[2] ?? "";
    const rawName =
      wrapperTag === "function"
        ? extractXmlParameterName(attributes)
        : extractPseudoToolWrapperName(attributes);
    if (!rawName) {
      continue;
    }

    const bodyStart = (match.index ?? 0) + match[0].length;
    let bodyEnd = trimmed.length;
    const closingSentinels =
      wrapperTag === "invoke"
        ? ["</invoke>", "<invoke"] as const
        : ["</tool_call>", "</function>", "</execution>", "<function="] as const;
    for (const sentinel of closingSentinels) {
      const nextIndex = trimmed.indexOf(sentinel, bodyStart);
      if (nextIndex !== -1) {
        bodyEnd = Math.min(bodyEnd, nextIndex);
      }
    }

    const body = trimmed.slice(bodyStart, bodyEnd);
    const parameterBlocks = parseXmlStyleParameterBlocks(body);
    if (parameterBlocks.length === 0) {
      continue;
    }

    candidates.add(
      JSON.stringify({
        name: rawName,
        arguments: Object.fromEntries(parameterBlocks.map((block) => [block.name, block.value])),
      }),
    );
  }

  return [...candidates];
}

function inferToolArgumentsFromWrapperBody(
  tool: Tool,
  rawBody: string,
): Record<string, unknown> | null {
  const body = rawBody.trim();
  const schema = getToolParameterSchema(tool);
  const required = schema ? getToolSchemaRequiredFields(schema) : [];
  const properties = schema ? getToolSchemaPropertyNames(schema) : [];
  if (!body) {
    return required.length === 0 && properties.length === 0 ? {} : null;
  }

  const parameterBlocks = parseXmlStyleParameterBlocks(body);
  if (parameterBlocks.length > 0) {
    return Object.fromEntries(parameterBlocks.map((block) => [block.name, block.value]));
  }

  const parsedArguments = normalizeToolArguments(body);
  if (parsedArguments) {
    return coerceToolArgumentsToSchema(tool, parsedArguments);
  }

  const primaryArgument = resolvePrimaryToolArgumentName(tool);
  if (primaryArgument) {
    return {
      [primaryArgument]: body,
    };
  }

  return null;
}

function extractKnownToolWrapperCandidates(
  text: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): string[] {
  const candidates = new Set<string>();
  for (const match of findKnownToolWrapperMatches(text.trim(), tools, toolMap)) {
    const argumentsRecord = inferToolArgumentsFromWrapperBody(match.tool, match.body);
    if (!argumentsRecord || !hasValidSalvagedToolArguments(match.tool, argumentsRecord)) {
      continue;
    }

    candidates.add(
      JSON.stringify({
        name: match.tool.name,
        arguments: argumentsRecord,
      }),
    );
  }

  return [...candidates];
}

function extractFunctionStyleToolCallCandidates(
  text: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): string[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (!trimmed || tools.length === 0) {
    return [];
  }

  const functionPattern = /\b([a-zA-Z_][\w-]*)\s*\(/g;
  for (const match of trimmed.matchAll(functionPattern)) {
    const rawName = match[1]?.trim();
    if (!rawName) {
      continue;
    }

    const tool = resolveKnownTool(rawName, tools, toolMap);
    if (!tool) {
      continue;
    }

    const openIndex = (match.index ?? 0) + match[0].lastIndexOf("(");
    const closeIndex = findBalancedDelimitedClose(trimmed, openIndex, "(", ")");
    if (closeIndex === -1) {
      continue;
    }

    const prefixContent = trimmed.slice(0, match.index ?? 0);
    const suffixContent = trimmed.slice(closeIndex + 1);
    const lastPrefixChar = prefixContent[prefixContent.length - 1];
    const firstSuffixChar = suffixContent[0];
    const prefixOk = /[\s:="'`\\<>\n\r]/.test(lastPrefixChar) || prefixContent.length === 0;
    const suffixOk = /[\s:;)\]}"'>`\n\r$]/.test(firstSuffixChar) || suffixContent.length === 0;
    if (!prefixOk || !suffixOk) {
      continue;
    }

    const argumentsRecord = inferToolArgumentsFromWrapperBody(
      tool,
      trimmed.slice(openIndex + 1, closeIndex),
    );
    if (!argumentsRecord || !hasValidSalvagedToolArguments(tool, argumentsRecord)) {
      continue;
    }

    candidates.add(
      JSON.stringify({
        name: tool.name,
        arguments: argumentsRecord,
      }),
    );
  }

  return [...candidates];
}

function extractToolPayloadCandidates(
  text: string,
  tools: readonly Tool[] = [],
  toolMap?: Map<string, Tool>,
): string[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (!trimmed) {
    return [...candidates];
  }

  for (const candidate of extractRawToolPayloadCandidates(text)) {
    const trimmedCandidate = candidate.trim();
    if (/^[\[{]/.test(trimmedCandidate) && isStructuredJsonCandidate(trimmedCandidate)) {
      candidates.add(trimmedCandidate);
    }
  }

  for (const candidate of extractXmlStyleFunctionCallCandidates(trimmed)) {
    candidates.add(candidate);
  }

  for (const candidate of extractKnownToolWrapperCandidates(trimmed, tools, toolMap)) {
    candidates.add(candidate);
  }

  for (const candidate of extractFunctionStyleToolCallCandidates(trimmed, tools, toolMap)) {
    candidates.add(candidate);
  }

  const pseudoToolWrapperPattern = /<([a-zA-Z][\w-]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of trimmed.matchAll(pseudoToolWrapperPattern)) {
    const tagName = match[1]?.trim().toLowerCase();
    if (!tagName || !PSEUDO_TOOL_WRAPPER_TAG_NAMES.has(tagName)) {
      continue;
    }

    const attributes = match[2] ?? "";
    const body = match[3]?.trim() ?? "";

    const toolNameFromAttr = extractPseudoToolWrapperName(attributes);
    const resolvedToolName = toolNameFromAttr ?? tagName;
    const tool = resolveKnownTool(resolvedToolName, tools, toolMap);
    if (!tool) {
      continue;
    }

    const toolName = toolNameFromAttr ? resolvedToolName : tool.name;
    const allAttrs = extractAllTagAttributes(attributes);
    delete allAttrs.name;
    delete allAttrs.tool;
    delete allAttrs.toolName;
    delete allAttrs.type;

    const rawBody = body.trim();

    for (const innerCandidate of extractRawToolPayloadCandidates(rawBody)) {
      if (!isStructuredJsonCandidate(innerCandidate)) {
        continue;
      }

      const parsedInner = parseJsonCandidate(innerCandidate);
      if (isRecord(parsedInner)) {
        const mergedArgs = { ...allAttrs, ...parsedInner };
        candidates.add(JSON.stringify({ name: toolName, arguments: mergedArgs }));
      } else {
        candidates.add(JSON.stringify({ name: toolName, arguments: parsedInner }));
      }
    }

    if (candidates.size === 0) {
      if (isStructuredJsonCandidate(rawBody)) {
        const parsed = parseJsonCandidate(rawBody);
        if (isRecord(parsed)) {
          const mergedArgs = { ...allAttrs, ...parsed };
          candidates.add(JSON.stringify({ name: toolName, arguments: mergedArgs }));
        } else {
          candidates.add(JSON.stringify({ name: toolName, arguments: parsed }));
        }
      } else if (/^[\w-]+\s*=/.test(rawBody)) {
        const argMatch = rawBody.match(/^([\w-]+)\s*=\s*("[^"]*"|'[^']*'|\S+)/);
        if (argMatch) {
          const mergedArgs = { ...allAttrs, [argMatch[1]]: argMatch[2].replace(/^["']|["']$/g, "") };
          candidates.add(JSON.stringify({ name: toolName, arguments: mergedArgs }));
        }
      } else {
        const primaryArg = resolvePrimaryToolArgumentName(tool);
        if (primaryArg) {
          const bodyArgs: Record<string, unknown> = {};
          const isKeyValueFormat = /^[\w-]+\s*=/.test(rawBody);
          if (isKeyValueFormat) {
            const argMatch = rawBody.match(/^([\w-]+)\s*=\s*("[^"]*"|'[^']*'|\S+)/);
            if (argMatch) {
              bodyArgs[argMatch[1]] = argMatch[2].replace(/^["']|["']$/g, "");
            }
          } else if (rawBody.length > 0) {
            bodyArgs[primaryArg] = rawBody;
          }
          const mergedArgs = { ...allAttrs, ...bodyArgs };
          if (Object.keys(mergedArgs).length > 0) {
            candidates.add(JSON.stringify({ name: toolName, arguments: mergedArgs }));
          }
        }
      }
    }
  }

  return [...candidates];
}

function firstDefinedProperty(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function firstStringProperty(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  const value = firstDefinedProperty(record, keys);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeToolArguments(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) {
    return { ...raw };
  }
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }

  try {
    const parsed = parseJsonCandidate(raw.trim());
    if (isRecord(parsed)) {
      return { ...parsed };
    }
    if (Array.isArray(parsed)) {
      return { value: parsed };
    }
    return { value: parsed };
  } catch {
    return null;
  }
}

function buildFlattenedToolArguments(
  record: Record<string, unknown>,
  nestedFunction?: Record<string, unknown>,
): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!TOOL_CALL_RESERVED_KEYS.has(key)) {
      flattened[key] = value;
    }
  }

  if (Object.keys(flattened).length > 0) {
    return flattened;
  }

  if (nestedFunction) {
    for (const [key, value] of Object.entries(nestedFunction)) {
      if (!TOOL_CALL_RESERVED_KEYS.has(key)) {
        flattened[key] = value;
      }
    }
  }

  return flattened;
}

function normalizeSalvagedToolCall(
  value: unknown,
  tools: readonly Tool[],
  index: number,
  toolMap?: Map<string, Tool>,
): Extract<AssistantMessage["content"][number], { type: "toolCall" }> | null {
  if (!isRecord(value)) {
    return null;
  }

  const nestedFunction = isRecord(value.function) ? value.function : undefined;
  const rawName =
    firstStringProperty(value, ["name", "toolName"]) ??
    (typeof value.tool === "string" && value.tool.trim() ? value.tool.trim() : undefined) ??
    (nestedFunction ? firstStringProperty(nestedFunction, ["name"]) : undefined);
  if (!rawName) {
    return null;
  }

  const wrapperArguments =
    firstDefinedProperty(value, TOOL_ARGUMENT_KEYS) ??
    (nestedFunction ? firstDefinedProperty(nestedFunction, TOOL_ARGUMENT_KEYS) : undefined);
  const normalizedWrapperArguments = normalizeToolArguments(wrapperArguments) ?? {};
  const invokeWrapperName =
    rawName === "invoke"
      ? firstStringProperty(value, ["tool", "toolName"]) ??
        firstStringProperty(normalizedWrapperArguments, ["name", "tool", "toolName"])
      : undefined;
  const invokeWrapperArguments =
    rawName === "invoke"
      ? firstDefinedProperty(normalizedWrapperArguments, ["arguments", ...TOOL_ARGUMENT_KEYS])
      : undefined;
  const resolvedName = invokeWrapperName ?? rawName;
  const resolvedTool = resolveKnownTool(resolvedName, tools, toolMap);
  if (!resolvedTool) {
    return null;
  }
  const rawArguments = invokeWrapperArguments ?? wrapperArguments;
  const normalizedArguments = coerceToolArgumentsToSchema(
    resolvedTool,
    normalizeToolArguments(rawArguments) ?? buildFlattenedToolArguments(value, nestedFunction),
  );
  if (!hasValidSalvagedToolArguments(resolvedTool, normalizedArguments)) {
    return null;
  }

  return {
    type: "toolCall",
    id: typeof value.id === "string" && value.id.trim() ? value.id : `call_salvaged_${index + 1}`,
    name: resolvedTool.name,
    arguments: normalizedArguments,
  };
}

function normalizeStructuredToolTurn(
  value: unknown,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): {
  messageText?: string;
  toolCalls: Array<Extract<AssistantMessage["content"][number], { type: "toolCall" }>>;
} | null {
  if (Array.isArray(value)) {
    const toolCalls = value
      .map((entry, index) => normalizeSalvagedToolCall(entry, tools, index, toolMap))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    return toolCalls.length > 0 ? { toolCalls } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const messageText =
    (typeof value.message === "string" && value.message.trim() ? value.message.trim() : undefined) ??
    (typeof value.text === "string" && value.text.trim() ? value.text.trim() : undefined);
  const rawCalls = firstDefinedProperty(value, TOOL_CALL_CONTAINER_KEYS);
  if (rawCalls !== undefined) {
    const callEntries = Array.isArray(rawCalls) ? rawCalls : [rawCalls];
    const toolCalls = callEntries
      .map((entry, index) => normalizeSalvagedToolCall(entry, tools, index, toolMap))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    return toolCalls.length > 0 ? { messageText, toolCalls } : null;
  }

  const toolCall = normalizeSalvagedToolCall(value, tools, 0, toolMap);
  return toolCall ? { messageText, toolCalls: [toolCall] } : null;
}

function containsInvalidStructuredToolPayload(
  text: string,
  tools: readonly Tool[],
  toolMap?: Map<string, Tool>,
): boolean {
  if (!text.trim() || tools.length === 0) {
    return false;
  }

  let sawStructuredPayload = false;
  for (const candidate of extractToolPayloadCandidates(text, tools, toolMap)) {
    sawStructuredPayload = true;
    try {
      const normalized = normalizeStructuredToolTurn(parseJsonCandidate(candidate), tools, toolMap);
      if (normalized?.toolCalls.length) {
        return false;
      }
    } catch {
      return true;
    }
  }

  return sawStructuredPayload;
}

function buildSyntheticAssistantEvents(message: AssistantMessage): AssistantMessageEvent[] {
  const doneReason = resolveSyntheticDoneReason(message);
  const partial = normalizeAssistantMessage(
    {
      ...message,
      content: [],
      stopReason: doneReason,
      errorMessage: undefined,
    },
    { modelId: message.model, requestApi: message.api },
  );
  const events: AssistantMessageEvent[] = [{ type: "start", partial }];

  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === "text") {
      const partialTextBlock: Extract<AssistantMessage["content"][number], { type: "text" }> = {
        type: "text",
        text: "",
      };
      partial.content.push(partialTextBlock);
      events.push({ type: "text_start", contentIndex, partial });
      if (block.text) {
        partialTextBlock.text = block.text;
        events.push({ type: "text_delta", contentIndex, delta: block.text, partial });
      }
      events.push({ type: "text_end", contentIndex, content: block.text, partial });
      continue;
    }

    if (block.type === "toolCall") {
      const partialToolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }> = {
        type: "toolCall",
        id: block.id,
        name: block.name,
        arguments: {},
      };
      partial.content.push(partialToolCall);
      events.push({ type: "toolcall_start", contentIndex, partial });
      const delta = JSON.stringify(block.arguments);
      partialToolCall.arguments = block.arguments;
      if (delta) {
        events.push({ type: "toolcall_delta", contentIndex, delta, partial });
      }
      events.push({ type: "toolcall_end", contentIndex, toolCall: block, partial });
      continue;
    }

    partial.content.push(block);
  }

  events.push({ type: "done", reason: doneReason, message });
  return events;
}

function salvageStructuredToolTurn(
  message: AssistantMessage,
  tools: readonly Tool[],
  meta: RepairRuntimeMeta,
  logger: RepairLogger,
): { events: AssistantMessageEvent[]; finalMessage: AssistantMessage } | null {
  const textPayload = message.content
    .filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!textPayload) {
    return null;
  }

  const toolMap = createToolMap(tools);
  for (const candidate of extractToolPayloadCandidates(textPayload, tools, toolMap)) {
    try {
      const normalized = normalizeStructuredToolTurn(parseJsonCandidate(candidate), tools, toolMap);
      if (!normalized || normalized.toolCalls.length === 0) {
        continue;
      }

      const salvagedMessage = normalizeAssistantMessage(message, meta);
      salvagedMessage.content = [
        ...(normalized.messageText ? [{ type: "text", text: normalized.messageText } as const] : []),
        ...normalized.toolCalls,
      ];
      salvagedMessage.stopReason = "toolUse";
      delete salvagedMessage.errorMessage;

      logger.warn(
        `[nanogpt] Salvaged structured tool payload from assistant text for model ${meta.modelId}`,
      );
      logNanoGptRepairArtifact(logger, meta, "salvage_success", {
        toolCallCount: normalized.toolCalls.length,
        payloadLength: textPayload.length,
      });

      return {
        events: buildSyntheticAssistantEvents(salvagedMessage),
        finalMessage: salvagedMessage,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function createReplayStream(events: AssistantMessageEvent[], finalMessage: AssistantMessage) {
  return {
    async result() {
      return finalMessage;
    },
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index >= events.length) {
            return { done: true as const, value: undefined };
          }
          const value = events[index];
          index += 1;
          return { done: false as const, value };
        },
        async return(value?: unknown) {
          return { done: true as const, value };
        },
        async throw(error?: unknown) {
          return Promise.reject(error);
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
}

async function collectRepairAttempt(params: {
  streamFn: StreamFn;
  args: Parameters<StreamFn>;
  logger: RepairLogger;
  meta: RepairRuntimeMeta;
}): Promise<RepairAttempt> {
  const stream = await params.streamFn(...params.args);
  const toolDefinitions = Array.isArray(params.args[1]?.tools) ? params.args[1].tools : [];
  const toolMap = createToolMap(toolDefinitions);
  const toolCallArgBuffers = new Map<number, string>();
  const events: AssistantMessageEvent[] = [];
  let lastAssistantMessage: AssistantMessage | undefined;
  let sawToolCall = false;

  for await (const event of stream) {
    const repairedEvent = repairAssistantMessageEvent(
      event,
      toolCallArgBuffers,
      params.meta,
      params.logger,
    );
    if (
      repairedEvent.type === "toolcall_start" ||
      repairedEvent.type === "toolcall_delta" ||
      repairedEvent.type === "toolcall_end"
    ) {
      sawToolCall = true;
    }
    if ("partial" in repairedEvent) {
      lastAssistantMessage = repairedEvent.partial;
    }
    if (repairedEvent.type === "done") {
      lastAssistantMessage = repairedEvent.message;
    }
    if (repairedEvent.type === "error") {
      lastAssistantMessage = repairedEvent.error;
    }
    events.push(repairedEvent);
  }

  const terminalEvent = [...events].reverse().find(
    (event): event is Extract<AssistantMessageEvent, { type: "done" | "error" }> =>
      event.type === "done" || event.type === "error",
  );
  let finalMessage =
    terminalEvent?.type === "done"
      ? terminalEvent.message
      : terminalEvent?.type === "error"
        ? terminalEvent.error
        : normalizeAssistantMessage(lastAssistantMessage, params.meta);
  const toolEnabled = hasToolEnabledContext(params.args[1]);
  const sawBrokenToolIntent = hasBrokenToolIntent(finalMessage, toolDefinitions, toolMap);

  if (toolEnabled && !sawToolCall && countToolCalls(finalMessage) === 0) {
    const salvaged = salvageStructuredToolTurn(
      finalMessage,
      params.args[1].tools ?? [],
      params.meta,
      params.logger,
    );
    if (salvaged) {
      finalMessage = salvaged.finalMessage;
      return {
        events: salvaged.events,
        finalMessage,
        toolEnabled,
        sawToolCall: true,
        sawVisibleText: hasVisibleText(finalMessage, toolDefinitions, toolMap),
        sawBrokenToolIntent: false,
      };
    }
  }

  let selectedEvents = events;
  const sanitizedMessage = sanitizeAssistantMessage(finalMessage, toolDefinitions, toolMap);
  if (sanitizedMessage.changed) {
    logNanoGptRepairArtifact(params.logger, params.meta, "text_sanitized", {
      removedTextCharacters: Math.max(0, countTextCharacters(finalMessage) - countTextCharacters(sanitizedMessage.message)),
      remainingTextCharacters: countTextCharacters(sanitizedMessage.message),
      contentBlockCount: sanitizedMessage.message.content.length,
    });
    finalMessage = sanitizedMessage.message;
    selectedEvents = buildSyntheticAssistantEvents(finalMessage);
  }

  const finalToolCallCount = countToolCalls(finalMessage);
  if (finalToolCallCount > 0) {
    sawToolCall = true;
    if (finalMessage.stopReason !== "toolUse") {
      logNanoGptRepairArtifact(params.logger, params.meta, "stop_reason_rewrite", {
        originalStopReason: finalMessage.stopReason,
        toolCallCount: finalToolCallCount,
      });
      finalMessage = {
        ...finalMessage,
        stopReason: "toolUse",
      };
      selectedEvents = buildSyntheticAssistantEvents(finalMessage);
    }
  }

  return {
    events: selectedEvents,
    finalMessage,
    toolEnabled,
    sawToolCall,
    sawVisibleText: hasVisibleText(finalMessage, toolDefinitions, toolMap),
    sawBrokenToolIntent,
  };
}

function inspectToolCallArguments(params: {
  contentIndex: number;
  toolName: string;
  rawArgs?: string;
  tools: readonly Tool[];
  toolMap?: Map<string, Tool>;
  logger: RepairLogger;
  meta: RepairRuntimeMeta;
  profile: NanoGptRepairProfile;
  loggedMalformedContentIndexes: Set<number>;
  loggedSemanticContentIndexes: Set<number>;
}): void {
  if (typeof params.rawArgs !== "string") {
    return;
  }

  if (params.profile.useSemanticToolDiagnostics) {
    logGlmSemanticToolDiagnostics({
      contentIndex: params.contentIndex,
      toolName: params.toolName,
      rawArgs: params.rawArgs,
      tools: params.tools,
      toolMap: params.toolMap,
      logger: params.logger,
      meta: params.meta,
      loggedContentIndexes: params.loggedSemanticContentIndexes,
    });
  }

  if (isMalformedToolCallJson(params.rawArgs)) {
    logObservedMalformedToolCall({
      contentIndex: params.contentIndex,
      toolName: params.toolName,
      rawArgs: params.rawArgs,
      logger: params.logger,
      meta: params.meta,
      loggedContentIndexes: params.loggedMalformedContentIndexes,
    });
  }
}

/**
 * Wraps an OpenClaw model stream to automatically repair malformed JSON in tool call arguments.
 * This is particularly useful for "thinking" models or models that may truncate output.
 */
export function wrapStreamWithToolCallRepair(
  streamFn: StreamFn,
  logger: RepairLogger,
  options: ToolCallRepairOptions = {},
): StreamFn {
  return async (...args) => {
    const baseMeta: RepairRuntimeMeta = {
      modelId: args[0]?.id || "unknown",
      requestApi: args[0]?.api,
      attempt: 0,
      debug: options.debug === true,
    };
    const repairProfile = resolveNanoGptRepairProfile(baseMeta.modelId);
    if (!repairProfile.useBufferedRepair || !hasToolEnabledContext(args[1])) {
      return wrapStreamWithMalformedToolCallGuard(streamFn, logger, options)(...args);
    }
    const firstAttempt = await collectRepairAttempt({
      streamFn,
      args,
      logger,
      meta: baseMeta,
    });

    let selectedAttempt = firstAttempt;
    if (
      options.retryInvalidEmptyTurns !== false &&
      firstAttempt.toolEnabled &&
      !firstAttempt.sawToolCall &&
      (!firstAttempt.sawVisibleText || firstAttempt.sawBrokenToolIntent)
    ) {
      const requestedToolChoice = resolveRequestedToolChoice(args[2]);
      logger.warn(
        `[nanogpt] Retrying invalid tool-enabled turn from model ${baseMeta.modelId} after no usable tool call was produced`,
      );
      logNanoGptRepairArtifact(logger, baseMeta, "retry_invalid_tool_turn", {
        sawVisibleText: firstAttempt.sawVisibleText,
        sawBrokenToolIntent: firstAttempt.sawBrokenToolIntent,
        requestedToolChoice,
      });

      const retryOptions = buildRetryOptions(args[2], repairProfile);
      if (repairProfile.family === "qwen" && (requestedToolChoice === undefined || requestedToolChoice === "auto")) {
        logNanoGptRepairArtifact(logger, baseMeta, "retry_tool_choice_rewrite", {
          requestedToolChoice: requestedToolChoice ?? "auto",
          forcedToolChoice: resolveRequestedToolChoice(retryOptions),
        });
      }
      selectedAttempt = await collectRepairAttempt({
        streamFn,
        args: [args[0], buildRetryContext(args[1]), retryOptions],
        logger,
        meta: {
          ...baseMeta,
          attempt: 1,
        },
      });
      logNanoGptRepairArtifact(logger, { ...baseMeta, attempt: 1 }, "retry_result", {
        recoveredToolCalls: countToolCalls(selectedAttempt.finalMessage),
        sawVisibleText: selectedAttempt.sawVisibleText,
        sawBrokenToolIntent: selectedAttempt.sawBrokenToolIntent,
      });
    }

    return createReplayStream(selectedAttempt.events, selectedAttempt.finalMessage) as any;
  };
}

export function wrapStreamWithMalformedToolCallGuard(
  streamFn: StreamFn,
  logger: RepairLogger,
  options: ToolCallRepairOptions = {},
): StreamFn {
  return async (...args) => {
    const stream = await streamFn(...args);
    const meta: RepairRuntimeMeta = {
      modelId: args[0]?.id || "unknown",
      requestApi: args[0]?.api,
      attempt: 0,
      debug: options.debug === true,
    };
    const repairProfile = resolveNanoGptRepairProfile(meta.modelId);
    const toolDefinitions = Array.isArray(args[1]?.tools) ? args[1].tools : [];
    const toolMap = createToolMap(toolDefinitions);
    const toolCallArgBuffers = new Map<number, string>();
    const loggedContentIndexes = new Set<number>();
    const loggedSemanticContentIndexes = new Set<number>();
    const wrappedStream = stream as typeof stream & {
      result?: () => Promise<AssistantMessage>;
      [Symbol.asyncIterator]: () => AsyncIterator<AssistantMessageEvent>;
    };

    const originalAsyncIterator = wrappedStream[Symbol.asyncIterator].bind(wrappedStream);
    wrappedStream[Symbol.asyncIterator] = function () {
      const iterator = originalAsyncIterator();
      return {
        async next() {
          const result = await iterator.next();
          if (result.done) {
            return result;
          }

          const event = result.value;
          if (event.type === "toolcall_delta") {
            const current = toolCallArgBuffers.get(event.contentIndex) || "";
            toolCallArgBuffers.set(event.contentIndex, current + event.delta);
          }

          if (event.type === "toolcall_end") {
            const rawArgs = toolCallArgBuffers.get(event.contentIndex);
            inspectToolCallArguments({
              contentIndex: event.contentIndex,
              toolName: event.toolCall.name,
              rawArgs,
              tools: toolDefinitions,
              toolMap,
              logger,
              meta,
              profile: repairProfile,
              loggedMalformedContentIndexes: loggedContentIndexes,
              loggedSemanticContentIndexes,
            });
          }

          return {
            done: false as const,
            value: event,
          };
        },
        async return(value?: unknown) {
          return iterator.return?.(value) ?? { done: true as const, value: undefined };
        },
        async throw(error?: unknown) {
          return iterator.throw?.(error) ?? Promise.reject(error);
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    };

    if (typeof wrappedStream.result === "function") {
      const originalResult = wrappedStream.result.bind(wrappedStream);
      wrappedStream.result = async () => {
        const message = await originalResult();
        message.content.forEach((block, index) => {
          if (block.type !== "toolCall") {
            return;
          }

          const rawArgs = toolCallArgBuffers.get(index);
          inspectToolCallArguments({
            contentIndex: index,
            toolName: block.name,
            rawArgs,
            tools: toolDefinitions,
            toolMap,
            logger,
            meta,
            profile: repairProfile,
            loggedMalformedContentIndexes: loggedContentIndexes,
            loggedSemanticContentIndexes,
          });
        });
        return message;
      };
    }

    return wrappedStream as any;
  };
}

function repairAssistantMessageEvent(
  event: AssistantMessageEvent,
  toolCallArgBuffers: Map<number, string>,
  meta: RepairRuntimeMeta,
  logger: RepairLogger,
): AssistantMessageEvent {
  if (event.type === "toolcall_delta") {
    const current = toolCallArgBuffers.get(event.contentIndex) || "";
    toolCallArgBuffers.set(event.contentIndex, current + event.delta);
    return event;
  }

  if (event.type === "toolcall_end") {
    const rawArgs = toolCallArgBuffers.get(event.contentIndex);
    return rawArgs !== undefined ? repairToolCallEndEvent(event, rawArgs, meta, logger) : event;
  }

  if (event.type === "done") {
    return {
      ...event,
      message: repairAssistantMessage(event.message, toolCallArgBuffers, meta, logger),
    };
  }

  if (event.type === "error") {
    return {
      ...event,
      error: repairAssistantMessage(event.error, toolCallArgBuffers, meta, logger),
    };
  }

  return event;
}

function repairToolCallEndEvent(
  event: Extract<AssistantMessageEvent, { type: "toolcall_end" }>,
  rawArgs: string,
  meta: RepairRuntimeMeta,
  logger: RepairLogger,
): AssistantMessageEvent {
  try {
    // Try standard parse first to see if it's already okay
    JSON.parse(rawArgs);
    return event;
  } catch {
    try {
      const repairedJson = jsonrepair(rawArgs);
      const parsed = JSON.parse(repairedJson);

      logger.warn(
        `[nanogpt] Repaired malformed tool call arguments from model ${meta.modelId} for tool "${event.toolCall.name}"`,
      );
      logNanoGptRepairArtifact(logger, meta, "repair_success", {
        repairStage: "toolcall_end",
        toolName: event.toolCall.name,
        rawArgumentLength: rawArgs.length,
      });

      return {
        ...event,
        toolCall: {
          ...event.toolCall,
          arguments: parsed,
        },
        partial: repairAssistantMessage(event.partial, new Map([[event.contentIndex, rawArgs]]), meta, logger, true),
      };
        } catch {
      logNanoGptRepairArtifact(logger, meta, "repair_failed", {
        repairStage: "toolcall_end",
        toolName: event.toolCall.name,
        rawArgumentLength: rawArgs.length,
      });
      // If even jsonrepair fails, we just pass through and let the core handle the error
      return event;
    }
  }
}

function repairAssistantMessage(
  message: AssistantMessage,
  buffers: Map<number, string>,
  meta: RepairRuntimeMeta,
  logger: RepairLogger,
  silent = false,
): AssistantMessage {
  if (!message.content) return message;

  let changed = false;
  const newContent = message.content.map((block, index) => {
    if (block.type === "toolCall") {
      const rawArgs = buffers.get(index);
      if (rawArgs === undefined) return block;

      try {
        JSON.parse(rawArgs);
        return block;
      } catch {
        try {
          const repairedJson = jsonrepair(rawArgs);
          const parsed = JSON.parse(repairedJson);
          if (!silent) {
            logger.warn(
              `[nanogpt] Repaired malformed tool call arguments in final message from model ${meta.modelId} for tool "${block.name}"`,
            );
            logNanoGptRepairArtifact(logger, meta, "repair_success", {
              repairStage: "final_message",
              toolName: block.name,
              rawArgumentLength: rawArgs.length,
            });
          }
          changed = true;
          return { ...block, arguments: parsed };
        } catch {
          if (!silent) {
            logNanoGptRepairArtifact(logger, meta, "repair_failed", {
              repairStage: "final_message",
              toolName: block.name,
              rawArgumentLength: rawArgs.length,
            });
          }
          return block;
        }
      }
    }
    return block;
  });

  return changed ? { ...message, content: newContent as any } : message;
}
