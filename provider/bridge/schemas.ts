import type { NanoGptBridgeToolCall } from "./types.js";

/**
 * Robust parser for NanoGPT bridge response parsing.
 * Handles various response formats that models may return.
 */

/**
 * Parse a tool call from various possible formats
 */
function parseToolCall(input: unknown): NanoGptBridgeToolCall | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const val = input as Record<string, unknown>;

  const name =
    typeof val.name === "string" && val.name
      ? val.name
      : typeof val.tool_name === "string" && val.tool_name
        ? val.tool_name
        : typeof val.toolName === "string" && val.toolName
          ? val.toolName
          : typeof val.tool === "string" && val.tool
            ? val.tool
            : typeof val.call_name === "string" && val.call_name
              ? val.call_name
              : typeof val.function === "object" && val.function !== null
                ? ((val.function as Record<string, unknown>)?.name as string) ?? undefined
                : undefined;

  if (!name) {
    return null;
  }

  // Extract arguments from various possible locations
  const args =
    val.arguments ?? val.args ?? val.parameters ?? val.params ?? val.input ?? val.inputs ?? val.payload ?? val.data ?? (typeof val.function === "object" && val.function !== null ? (val.function as Record<string, unknown>)?.arguments : undefined) ?? {};

  let normalizedArgs: Record<string, unknown>;
  if (typeof args === "string") {
    try {
      normalizedArgs = JSON.parse(args);
    } catch {
      normalizedArgs = { input: args };
    }
  } else if (Array.isArray(args)) {
    normalizedArgs = { items: args };
  } else if (typeof args === "object" && args !== null) {
    normalizedArgs = args as Record<string, unknown>;
  } else {
    normalizedArgs = {};
  }

  // Capture any extra fields not in the known keys as additional arguments
  const knownKeys = new Set([
    "name",
    "tool_name",
    "toolName",
    "tool",
    "call_name",
    "arguments",
    "args",
    "parameters",
    "params",
    "input",
    "inputs",
    "payload",
    "data",
    "function",
    "type",
    "id",
  ]);
  for (const [key, value] of Object.entries(val)) {
    if (!knownKeys.has(key)) {
      normalizedArgs[key] = value;
    }
  }

  return {
    name: name.trim(),
    arguments: normalizedArgs,
  };
}

/**
 * Parse bridge mode from string
 */
function parseBridgeMode(val: string | unknown): "tool" | "final" | "clarify" {
  if (typeof val !== "string") {
    return "final";
  }
  const normalized = val.trim().toLowerCase();
  if (
    ["tool", "tools", "tool_call", "tool_calls", "action", "actions", "call", "calls"].includes(
      normalized,
    )
  ) {
    return "tool";
  }
  if (
    ["clarify", "question", "ask", "needs_input", "input_required", "clarification"].includes(
      normalized,
    )
  ) {
    return "clarify";
  }
  return "final";
}

/**
 * Parse a content array (Anthropic-style) and extract tool calls and message
 */
function parseContentArray(blocks: unknown[]): { toolCalls: NanoGptBridgeToolCall[]; message: string } {
  const toolCalls: NanoGptBridgeToolCall[] = [];
  let message = "";

  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;

    const b = block as Record<string, unknown>;

    if (b.type === "text") {
      const text = typeof b.text === "string" ? b.text : typeof b.content === "string" ? b.content : "";
      message += text;
    } else if (b.type === "tool_use" || b.type === "tool_call" || b.type === "function_call") {
      const toolCall = parseToolCall(b);
      if (toolCall) {
        toolCalls.push(toolCall);
      }
    }
  }

  return { toolCalls, message: message.trim() };
}

/**
 * Extract value from a record, trying multiple possible keys
 */
function extractFromRecord(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

/**
 * Parse a bridge response using Zod schemas.
 * Returns { toolCalls, message, raw } on success, null on failure.
 */
export function parseBridgeResponseWithSchema(
  text: string,
): { toolCalls: NanoGptBridgeToolCall[]; message: string; raw: unknown } | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;

  // Try direct JSON parse first
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Try to extract JSON object from text
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return null;
    }
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      return null;
    }
  }

  if (parsed === null || typeof parsed !== "object") {
    return null;
  }

  const record = parsed as Record<string, unknown>;

  // Try to unwrap nested envelopes (fields that contain nested JSON objects/arrays)
  // Note: "message" is NOT an envelope - it's a content field with string values
  let payload: unknown = record;
  const envelopeKeys = [
    "content",
    "assistant",
    "result",
    "output",
    "response",
    "turn",
    "data",
    "payload",
    "bridge",
  ];

  for (let depth = 0; depth < 5; depth++) {
    if (!payload || typeof payload !== "object") {
      break;
    }

    const current = payload as Record<string, unknown>;
    let foundUnwrap = false;

    for (const key of envelopeKeys) {
      if (key in current && current[key] !== undefined && current[key] !== current) {
        payload = current[key];
        foundUnwrap = true;
        break;
      }
    }

    if (!foundUnwrap) {
      break;
    }
  }

  // Now parse the payload
  let toolCalls: NanoGptBridgeToolCall[] = [];
  let message = "";

  if (Array.isArray(payload)) {
    // Content array (Anthropic-style)
    const result = parseContentArray(payload);
    toolCalls = result.toolCalls;
    message = result.message;
  } else if (typeof payload === "object" && payload !== null) {
    const obj = payload as Record<string, unknown>;

    // Try to extract tool calls from various array fields
    const toolCallArrays = [
      obj.tool_calls,
      obj.toolCalls,
      obj.tools,
      obj.calls,
      obj.actions,
      obj.items,
    ];

    for (const arr of toolCallArrays) {
      if (Array.isArray(arr) && arr.length > 0) {
        for (const item of arr) {
          if (item && typeof item === "object") {
            const parsedTool = parseToolCall(item);
            if (parsedTool) {
              toolCalls.push(parsedTool);
            }
          }
        }
        if (toolCalls.length > 0) break;
      }
    }

    // Handle direct tool call object without array
    if (toolCalls.length === 0) {
      const directTool = parseToolCall(obj);
      if (directTool) {
        toolCalls.push(directTool);
      }
    }

    // Extract message from various possible fields
    const messageValue = extractFromRecord(obj, [
      "message",
      "content",
      "text",
      "reply",
      "visible",
    ]);
    if (typeof messageValue === "string") {
      message = messageValue;
    } else if (typeof messageValue === "number") {
      message = String(messageValue);
    }

    // If still no message, try to parse from text field containing JSON
    if (!message && typeof obj.text === "string") {
      message = obj.text;
    }
  } else if (typeof payload === "string") {
    message = payload;
  }

  if (toolCalls.length === 0 && !message) {
    return null;
  }

  return { toolCalls, message, raw: parsed };
}

/**
 * Validate and parse a tool call object using the robust parser.
 */
export function parseToolCallWithSchema(data: unknown): NanoGptBridgeToolCall | null {
  return parseToolCall(data);
}
