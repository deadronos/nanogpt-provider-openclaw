import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import type { NanoGptBridgeParseResult, NanoGptBridgeToolCall } from "./types.js";

function tryParseJson(text: string): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error };
  }
}

function unwrapJsonCodeFence(text: string): string | null {
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return match ? match[1].trim() : null;
}

function parseLooseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = tryParseJson(trimmed);
  return parsed.ok ? parsed.value : null;
}

function contentValueToText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object" && typeof (item as Record<string, unknown>).text === "string") {
          return String((item as Record<string, unknown>).text);
        }
        return "";
      })
      .join("");
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string") {
      return record.text;
    }
    if (typeof record.content === "string") {
      return record.content;
    }
    if (typeof record.message === "string") {
      return record.message;
    }
    return JSON.stringify(value);
  }
  return String(value as string | number | boolean | symbol | bigint);
}

function firstDefined(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key) && record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function canonicalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildKnownToolNameMaps(tools: readonly AnyAgentTool[] | undefined): {
  exact: Map<string, string>;
  canonical: Map<string, string>;
} {
  const exact = new Map<string, string>();
  const canonical = new Map<string, string>();
  for (const tool of tools ?? []) {
    if (typeof tool?.name !== "string") {
      continue;
    }
    const trimmed = tool.name.trim();
    if (!trimmed) {
      continue;
    }
    if (!exact.has(trimmed.toLowerCase())) {
      exact.set(trimmed.toLowerCase(), trimmed);
    }
    const canonicalName = canonicalizeToolName(trimmed);
    if (canonicalName && !canonical.has(canonicalName)) {
      canonical.set(canonicalName, trimmed);
    }
  }
  return { exact, canonical };
}

function resolveKnownToolName(name: string, knownToolMaps: ReturnType<typeof buildKnownToolNameMaps>): string {
  const trimmed = name.trim();
  if (!trimmed) {
    return trimmed;
  }
  return (
    knownToolMaps.exact.get(trimmed.toLowerCase()) ??
    knownToolMaps.canonical.get(canonicalizeToolName(trimmed)) ??
    trimmed
  );
}

function normalizeToolArguments(value: unknown): Record<string, unknown> {
  if (value == null) {
    return {};
  }
  const parsed = parseLooseJsonValue(value);
  if (parsed !== null) {
    return normalizeToolArguments(parsed);
  }
  if (typeof value === "string") {
    return value.trim() ? { input: value } : {};
  }
  if (Array.isArray(value)) {
    return { items: value };
  }
  if (typeof value === "object") {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
  }
  return { value };
}

function normalizeBridgeMode(mode: unknown, hasToolCalls: boolean): "tool" | "final" | "clarify" {
  const normalized = typeof mode === "string" ? mode.trim().toLowerCase() : "";
  if (["tool", "tools", "tool_call", "tool_calls", "action", "actions", "call", "calls"].includes(normalized)) {
    return "tool";
  }
  if (["clarify", "question", "ask", "needs_input", "input_required"].includes(normalized)) {
    return "clarify";
  }
  if (["final", "done", "complete", "completed", "response", "answer", "stop"].includes(normalized)) {
    return "final";
  }
  return hasToolCalls ? "tool" : "final";
}

function normalizeToolCallsContainer(value: unknown): unknown[] {
  if (value == null) {
    return [];
  }
  const parsed = parseLooseJsonValue(value);
  if (parsed !== null) {
    return normalizeToolCallsContainer(parsed);
  }
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === "object") {
    const nested = firstDefined(value as Record<string, unknown>, ["tool_calls", "toolCalls", "calls", "actions", "items"]);
    if (nested !== undefined && nested !== value) {
      return normalizeToolCallsContainer(nested);
    }
    return [value];
  }
  return [];
}

function normalizeBridgeTurnPayload(value: unknown, depth = 0): Record<string, unknown> | null {
  if (depth > 5 || value == null) {
    return null;
  }

  const parsedString = parseLooseJsonValue(value);
  if (parsedString !== null) {
    return normalizeBridgeTurnPayload(parsedString, depth + 1);
  }

  if (Array.isArray(value)) {
    if (value.length === 1) {
      return normalizeBridgeTurnPayload(value[0], depth + 1);
    }
    return value.length > 0 ? { v: 1, mode: "tool", message: "", tool_calls: value } : null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;
  for (const key of ["assistant", "response", "turn", "result", "output", "data", "payload", "bridge"]) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) {
      continue;
    }
    const nested = normalizeBridgeTurnPayload(record[key], depth + 1);
    if (nested) {
      const outerMessage = contentValueToText(firstDefined(record, ["message", "content", "text", "reply", "visible"])).trim();
      if (outerMessage && !nested.message) {
        nested.message = outerMessage;
      }
      return nested;
    }
  }

  const toolCalls = normalizeToolCallsContainer(firstDefined(record, ["tool_calls", "toolCalls", "tools", "calls", "actions"]));
  const directToolLike = typeof record.name === "string" || !!(record.function && typeof record.function === "object");
  if (toolCalls.length === 0 && directToolLike) {
    toolCalls.push(record);
  }

  const message = contentValueToText(firstDefined(record, ["message", "content", "text", "reply", "visible"])).trim();
  if (toolCalls.length === 0 && !message) {
    return null;
  }

  const normalized: Record<string, unknown> = {
    v: 1,
    mode: normalizeBridgeMode(record.mode, toolCalls.length > 0),
    message,
  };
  if (toolCalls.length > 0) {
    normalized.mode = "tool";
    normalized.tool_calls = toolCalls;
  }
  return normalized;
}

function extractTopLevelJsonValue(text: string): { valueText: string } | null {
  let start = -1;
  let openChar = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === "{" || char === "[") {
      start = i;
      openChar = char;
      break;
    }
  }
  if (start < 0) {
    return null;
  }

  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === openChar) {
      depth += 1;
    } else if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return { valueText: text.slice(start, i + 1) };
      }
    }
  }
  return null;
}

function normalizeObjectBridgeResponseText(text: string): string | null {
  const source = text.trim();
  if (!source) {
    return "";
  }

  const candidates = new Set<string>([source]);
  const unfenced = unwrapJsonCodeFence(source);
  if (unfenced) {
    candidates.add(unfenced);
  }

  for (const candidate of candidates) {
    const parsedWhole = tryParseJson(candidate);
    if (parsedWhole.ok) {
      const normalized = normalizeBridgeTurnPayload(parsedWhole.value);
      if (normalized) {
        return JSON.stringify(normalized);
      }
    }

    const extracted = extractTopLevelJsonValue(candidate);
    if (!extracted) {
      continue;
    }
    const parsedValue = tryParseJson(extracted.valueText);
    if (!parsedValue.ok) {
      continue;
    }
    const normalized = normalizeBridgeTurnPayload(parsedValue.value);
    if (normalized) {
      return JSON.stringify(normalized);
    }
  }

  return null;
}

function decodeLooseBridgeString(text: string): string {
  return text
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function extractMalformedToolCallsText(source: string): string | null {
  const match = /"(?:tool_calls|toolCalls|tools|calls|actions)"\s*:\s*\[/i.exec(source);
  if (!match) {
    return null;
  }
  const start = source.indexOf("[", match.index);
  const end = source.lastIndexOf("]");
  if (start < 0 || end <= start) {
    return null;
  }
  return source.slice(start + 1, end);
}

function splitMalformedToolCallChunks(arrayText: string | null): string[] {
  const source = arrayText ?? "";
  const starts: number[] = [];
  const startRegex = /\{\s*"name"\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = startRegex.exec(source)) !== null) {
    starts.push(match.index);
  }
  const chunks: string[] = [];
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : source.length;
    const chunk = source.slice(start, end).trim().replace(/,\s*$/, "").replace(/\s*\]+\s*$/, "").trim();
    if (chunk) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

function cleanupLooseFieldValue(rawValue: string): unknown {
  let text = rawValue.trim();
  if (!text) {
    return "";
  }
  if (text.startsWith('"')) {
    text = text.slice(1).replace(/"\s*(?:,\s*)?[}\]]*\s*$/, "");
    const reparsed = tryParseJson(`"${text}"`);
    if (reparsed.ok && typeof reparsed.value === "string") {
      return reparsed.value;
    }
    return decodeLooseBridgeString(text);
  }
  const parsed = parseLooseJsonValue(text.replace(/,\s*$/, ""));
  if (parsed !== null) {
    return parsed;
  }
  return decodeLooseBridgeString(text.replace(/[}\]]+\s*$/, "").replace(/,\s*$/, ""));
}

function normalizeObjectToolCall(
  value: unknown,
  knownToolMaps: ReturnType<typeof buildKnownToolNameMaps>,
): { ok: true; value: NanoGptBridgeToolCall } | { ok: false; error: string } {
  const parsedItem = parseLooseJsonValue(value);
  const candidate = parsedItem !== null ? parsedItem : value;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, error: "Each tool call must be an object." };
  }

  const record = candidate as Record<string, unknown>;
  const fn = record.function && typeof record.function === "object" && !Array.isArray(record.function)
    ? (record.function as Record<string, unknown>)
    : null;
  const rawName =
    firstDefined(record, ["name", "tool_name", "toolName", "tool", "call_name"]) ??
    (fn ? firstDefined(fn, ["name", "tool_name", "toolName"]) : undefined);
  if (typeof rawName !== "string" || !rawName.trim()) {
    return { ok: false, error: "Tool call name must be a non-empty string." };
  }

  const skipKeys = new Set(["name", "tool_name", "toolName", "tool", "call_name", "arguments", "args", "parameters", "params", "input", "inputs", "payload", "data", "function", "type", "id"]);
  const flatArgs: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(record)) {
    if (!skipKeys.has(key)) {
      flatArgs[key] = entryValue;
    }
  }
  if (fn) {
    for (const [key, entryValue] of Object.entries(fn)) {
      if (key !== "name" && !skipKeys.has(key) && !(key in flatArgs)) {
        flatArgs[key] = entryValue;
      }
    }
  }

  const argsSource =
    firstDefined(record, ["arguments", "args", "parameters", "params", "input", "inputs", "payload", "data"]) ??
    (fn ? firstDefined(fn, ["arguments", "args", "parameters", "params", "input", "inputs", "payload", "data"]) : undefined);
  const argsObject = normalizeToolArguments(argsSource);
  for (const [key, entryValue] of Object.entries(flatArgs)) {
    if (!Object.prototype.hasOwnProperty.call(argsObject, key)) {
      argsObject[key] = entryValue;
    }
  }

  return {
    ok: true,
    value: {
      name: resolveKnownToolName(rawName, knownToolMaps),
      arguments: argsObject,
    },
  };
}

function salvageMalformedToolCallChunk(
  chunk: string,
  knownToolMaps: ReturnType<typeof buildKnownToolNameMaps>,
): NanoGptBridgeToolCall | null {
  const nameMatch = /"name"\s*:\s*"([^"]+)"/i.exec(chunk);
  if (!nameMatch) {
    return null;
  }

  const resolvedName = resolveKnownToolName(nameMatch[1], knownToolMaps);
  const fieldRegex = /"([A-Za-z0-9_]+)"\s*:/g;
  const matches: Array<{ key: string; start: number; valueStart: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = fieldRegex.exec(chunk)) !== null) {
    matches.push({ key: match[1], start: match.index, valueStart: match.index + match[0].length });
  }

  const args: Record<string, unknown> = {};
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    if (current.key === "name") {
      continue;
    }
    const next = matches[i + 1];
    const rawValue = chunk.slice(current.valueStart, next ? next.start : chunk.length);
    if (!rawValue.trim()) {
      continue;
    }
    args[current.key] = cleanupLooseFieldValue(rawValue);
  }

  const normalized = normalizeObjectToolCall({ name: resolvedName, ...args }, knownToolMaps);
  return normalized.ok ? normalized.value : null;
}

function salvageMalformedToolTurn(
  source: string,
  knownToolMaps: ReturnType<typeof buildKnownToolNameMaps>,
): NanoGptBridgeParseResult | null {
  const messageMatch = /"message"\s*:\s*"([\s\S]*?)"\s*,\s*"(?:tool_calls|toolCalls|tools|calls|actions)"/i.exec(source);
  const content = messageMatch ? decodeLooseBridgeString(messageMatch[1]).trim() : "";
  const chunks = splitMalformedToolCallChunks(extractMalformedToolCallsText(source));
  const toolCalls = chunks
    .map((chunk) => salvageMalformedToolCallChunk(chunk, knownToolMaps))
    .filter((toolCall): toolCall is NanoGptBridgeToolCall => toolCall !== null);

  if (toolCalls.length > 0) {
    return { kind: "tool_calls", content, toolCalls };
  }
  if (content) {
    return { kind: "final", content };
  }
  return null;
}

export function parseObjectBridgeAssistantText(
  text: string,
  tools: readonly AnyAgentTool[] | undefined,
): NanoGptBridgeParseResult {
  const knownToolMaps = buildKnownToolNameMaps(tools);
  const normalizedSource = normalizeObjectBridgeResponseText(text);
  if (normalizedSource == null) {
    return (
      salvageMalformedToolTurn(text, knownToolMaps) ?? {
        kind: "invalid",
        error: {
          code: "missing_bridge_object_turn",
          message: "Object bridge response did not contain the required top-level JSON object.",
        },
      }
    );
  }

  const parsed = tryParseJson(normalizedSource);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return (
      salvageMalformedToolTurn(text, knownToolMaps) ?? {
        kind: "invalid",
        error: {
          code: "invalid_json_turn",
          message: "Bridge object was not valid JSON.",
        },
      }
    );
  }

  const record = parsed.value as Record<string, unknown>;
  const toolCalls = (Array.isArray(record.tool_calls) ? record.tool_calls : [])
    .map((entry) => normalizeObjectToolCall(entry, knownToolMaps))
    .filter((entry): entry is { ok: true; value: NanoGptBridgeToolCall } => entry.ok)
    .map((entry) => entry.value);
  const content = contentValueToText(record.message).trim();
  const mode = normalizeBridgeMode(record.mode, toolCalls.length > 0);

  if (toolCalls.length > 0 || mode === "tool") {
    if (toolCalls.length > 0) {
      return { kind: "tool_calls", content, toolCalls };
    }
    if (content) {
      return { kind: "final", content };
    }
    return {
      kind: "invalid",
      error: {
        code: "invalid_schema_turn",
        message: "Bridge tool turn did not contain any usable tool calls.",
      },
    };
  }

  if (content) {
    return { kind: "final", content };
  }

  return {
    kind: "invalid",
    error: {
      code: "invalid_empty_turn",
      message: "Bridge turn did not contain visible content or usable tool calls.",
    },
  };
}

export function tryReadJsonString(buffer: string, start: number): { end: number; value: string } | { error: string } | null {
  if (buffer[start] !== '"') {
    return { error: "expected_string" };
  }
  let index = start + 1;
  let escape = false;
  while (index < buffer.length) {
    const char = buffer[index];
    if (escape) {
      if (char === "u") {
        if (index + 4 >= buffer.length) {
          return null;
        }
        index += 5;
        escape = false;
        continue;
      }
      escape = false;
      index += 1;
      continue;
    }
    if (char === "\\") {
      escape = true;
      index += 1;
      continue;
    }
    if (char === '"') {
      const parsed = tryParseJson(buffer.slice(start, index + 1));
      if (!parsed.ok || typeof parsed.value !== "string") {
        return { error: "invalid_string" };
      }
      return { end: index + 1, value: parsed.value };
    }
    index += 1;
  }
  return null;
}

export function tryReadJsonObject(buffer: string, start: number): { end: number; value: Record<string, unknown> } | { error: string } | null {
  if (buffer[start] !== "{") {
    return { error: "expected_object" };
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < buffer.length; index += 1) {
    const char = buffer[index];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const parsed = tryParseJson(buffer.slice(start, index + 1));
        if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
          return { error: "invalid_object" };
        }
        return { end: index + 1, value: parsed.value as Record<string, unknown> };
      }
    }
  }
  return null;
}

export class StreamingObjectParser {
  private readonly knownToolMaps: ReturnType<typeof buildKnownToolNameMaps>;
  private buffer = "";
  private toolIndex = 0;
  private toolCallsArrayStart = -1;
  private toolCallsCursor = -1;
  private invalid = false;
  private messageEmitted = false;
  private mode: "tool" | "final" | "clarify" | null = null;
  private objectClosed = false;
  readonly completedCalls: NanoGptBridgeToolCall[] = [];

  constructor(
    tools: readonly AnyAgentTool[] | undefined,
    private readonly callbacks: {
      onContent?: (text: string) => void;
      onToolCall?: (call: NanoGptBridgeToolCall, index: number) => void;
    } = {},
  ) {
    this.knownToolMaps = buildKnownToolNameMaps(tools);
  }

  private skipWhitespace(index: number): number {
    let cursor = index;
    while (cursor < this.buffer.length && /\s/.test(this.buffer[cursor])) {
      cursor += 1;
    }
    return cursor;
  }

  private findKeyStart(key: string, fromIndex = 0): number {
    return this.buffer.indexOf(`"${key}"`, fromIndex);
  }

  private findValueStartAfterKey(key: string, fromIndex = 0): { start: number } | { error: string } | null {
    const keyStart = this.findKeyStart(key, fromIndex);
    if (keyStart < 0) {
      return null;
    }
    let cursor = keyStart + key.length + 2;
    cursor = this.skipWhitespace(cursor);
    if (cursor >= this.buffer.length) {
      return null;
    }
    if (this.buffer[cursor] !== ":") {
      return { error: "missing_colon" };
    }
    cursor = this.skipWhitespace(cursor + 1);
    if (cursor >= this.buffer.length) {
      return null;
    }
    return { start: cursor };
  }

  private scanHeader(): void {
    const trimmedStart = this.skipWhitespace(0);
    if (trimmedStart < this.buffer.length && this.buffer[trimmedStart] !== "{") {
      this.invalid = true;
      return;
    }

    const version = this.findValueStartAfterKey("v");
    if (version && "error" in version) {
      this.invalid = true;
      return;
    }
    if (!version) {
      return;
    }
    if (this.buffer[version.start] !== "1") {
      this.invalid = true;
      return;
    }

    const mode = this.findValueStartAfterKey("mode", version.start);
    if (mode && "error" in mode) {
      this.invalid = true;
      return;
    }
    if (!mode) {
      return;
    }
    const parsedMode = tryReadJsonString(this.buffer, mode.start);
    if (!parsedMode) {
      return;
    }
    if ("error" in parsedMode || !["tool", "final", "clarify"].includes(parsedMode.value)) {
      this.invalid = true;
      return;
    }
    this.mode = parsedMode.value as "tool" | "final" | "clarify";

    const message = this.findValueStartAfterKey("message", parsedMode.end);
    if (message && "error" in message) {
      this.invalid = true;
      return;
    }
    if (!message) {
      return;
    }
    const parsedMessage = tryReadJsonString(this.buffer, message.start);
    if (!parsedMessage) {
      return;
    }
    if ("error" in parsedMessage) {
      this.invalid = true;
      return;
    }
    if (!this.messageEmitted) {
      this.callbacks.onContent?.(parsedMessage.value);
      this.messageEmitted = true;
    }

    if (this.mode === "tool" && this.toolCallsArrayStart < 0) {
      const toolCalls = this.findValueStartAfterKey("tool_calls", parsedMessage.end);
      if (toolCalls && "error" in toolCalls) {
        this.invalid = true;
        return;
      }
      if (!toolCalls) {
        return;
      }
      if (this.buffer[toolCalls.start] !== "[") {
        this.invalid = true;
        return;
      }
      this.toolCallsArrayStart = toolCalls.start;
      this.toolCallsCursor = toolCalls.start + 1;
    }

    if (this.mode !== "tool") {
      const closeIndex = this.buffer.indexOf("}", parsedMessage.end);
      if (closeIndex >= 0) {
        this.objectClosed = true;
      }
    }
  }

  private scanToolCalls(): void {
    if (this.invalid || this.mode !== "tool" || this.toolCallsCursor < 0) {
      return;
    }

    let progressed = true;
    while (progressed && !this.invalid) {
      progressed = false;
      let cursor = this.skipWhitespace(this.toolCallsCursor);
      if (cursor >= this.buffer.length) {
        return;
      }
      if (this.buffer[cursor] === ",") {
        this.toolCallsCursor = cursor + 1;
        progressed = true;
        continue;
      }
      if (this.buffer[cursor] === "]") {
        this.toolCallsCursor = cursor + 1;
        const closeIndex = this.buffer.indexOf("}", this.toolCallsCursor);
        if (closeIndex >= 0) {
          this.objectClosed = true;
        }
        return;
      }
      if (this.buffer[cursor] !== "{") {
        this.invalid = true;
        return;
      }
      const parsed = tryReadJsonObject(this.buffer, cursor);
      if (!parsed) {
        return;
      }
      if ("error" in parsed) {
        this.invalid = true;
        return;
      }
      const normalized = normalizeObjectToolCall(parsed.value, this.knownToolMaps);
      if (!normalized.ok) {
        this.invalid = true;
        return;
      }
      this.completedCalls.push(normalized.value);
      this.callbacks.onToolCall?.(normalized.value, this.toolIndex);
      this.toolIndex += 1;
      this.toolCallsCursor = parsed.end;
      progressed = true;
    }
  }

  feed(text: string): void {
    if (this.invalid) {
      return;
    }
    this.buffer += String(text ?? "");
    this.scanHeader();
    this.scanToolCalls();
  }

  flush(): void {
    this.scanHeader();
    this.scanToolCalls();
  }

  get result(): NanoGptBridgeParseResult {
    if (this.invalid) {
      return {
        kind: "invalid",
        error: {
          code: "invalid_json_turn",
          message: "Bridge object was not valid JSON.",
        },
      };
    }
    if (this.completedCalls.length > 0) {
      return {
        kind: "tool_calls",
        content: "",
        toolCalls: [...this.completedCalls],
      };
    }
    if (this.objectClosed && this.messageEmitted) {
      return { kind: "final", content: "" };
    }
    return {
      kind: "invalid",
      error: {
        code: "invalid_empty_turn",
        message: "Bridge turn did not contain visible content or usable tool calls.",
      },
    };
  }
}
