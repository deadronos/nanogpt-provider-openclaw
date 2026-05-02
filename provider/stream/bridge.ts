import { randomUUID } from "node:crypto";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { parseObjectBridgeAssistantText } from "../bridge/object-parser.js";
import { parseXmlBridgeAssistantText } from "../bridge/xml-parser.js";
import { collectNanoGptStreamContentInspection } from "./inspection.js";
import type {
  NanoGptAssistantMessage,
  NanoGptToolCall,
} from "./types.js";

function hasParsedToolCalls(finalMessage: unknown): boolean {
  return Boolean(collectNanoGptStreamContentInspection(finalMessage)?.toolCallCount);
}

function resolveNanoGptBridgeStopReason(
  parsedKind: "tool_calls" | "final",
  stopReason: NanoGptAssistantMessage["stopReason"],
): string {
  if (parsedKind === "tool_calls") {
    return "toolUse";
  }
  return stopReason === "toolUse" ? "stop" : stopReason;
}

export function buildNanoGptBridgeFailureMessage(
  finalMessage: NanoGptAssistantMessage,
): NanoGptAssistantMessage {
  return {
    ...finalMessage,
    content: [
      ...finalMessage.content.filter((block) => block.type === "thinking"),
      {
        type: "text",
        text: "[nanogpt bridge] upstream returned no visible content or tool call for a tool-enabled turn.",
      },
    ],
    stopReason: "stop",
  };
}

function buildNanoGptBridgeToolCall(toolCall: {
  name: string;
  arguments: Record<string, unknown>;
}): NanoGptToolCall {
  return {
    type: "toolCall",
    id: `call_${randomUUID().slice(0, 8)}`,
    name: toolCall.name,
    arguments: toolCall.arguments,
  };
}

export function rewriteNanoGptBridgeMessage(params: {
  finalMessage: NanoGptAssistantMessage;
  protocol: "object" | "xml";
  tools: readonly AnyAgentTool[];
}): NanoGptAssistantMessage | null {
  if (hasParsedToolCalls(params.finalMessage)) {
    return params.finalMessage;
  }

  const inspection = collectNanoGptStreamContentInspection(params.finalMessage);
  const visibleText = inspection?.visibleText ?? "";
  const parsed =
    params.protocol === "xml"
      ? parseXmlBridgeAssistantText(visibleText, params.tools)
      : parseObjectBridgeAssistantText(visibleText, params.tools);

  if (parsed.kind === "invalid") {
    const trimmedVisibleText = visibleText.trim();
    if (
      trimmedVisibleText.length === 0 ||
      parsed.error.code === "invalid_empty_turn" ||
      parsed.error.code === "invalid_schema_turn" ||
      (params.protocol === "object" && trimmedVisibleText.startsWith("{")) ||
      (params.protocol === "xml" && trimmedVisibleText.includes("<"))
    ) {
      return null;
    }
    return params.finalMessage;
  }

  const content: NanoGptAssistantMessage["content"] = params.finalMessage.content.filter(
    (block) => block.type === "thinking",
  );
  if (parsed.content) {
    content.push({ type: "text", text: parsed.content });
  }
  if (parsed.kind === "tool_calls") {
    content.push(...parsed.toolCalls.map(buildNanoGptBridgeToolCall));
  }

  return {
    ...params.finalMessage,
    content,
    stopReason: resolveNanoGptBridgeStopReason(parsed.kind, params.finalMessage.stopReason),
  };
}