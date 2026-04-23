import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { normalizeNanoGptBridgeTools } from "./types.js";
import type { NanoGptBridgeParseResult, NanoGptBridgeToolCall } from "./types.js";

function xmlUnescape(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function decodeJsonStyleEscapes(value: string): string {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char !== "\\") {
      decoded += char;
      continue;
    }

    const next = value[index + 1];
    if (next === undefined) {
      decoded += "\\";
      continue;
    }

    if (next === "n") {
      decoded += "\n";
      index += 1;
      continue;
    }
    if (next === "r") {
      decoded += "\r";
      index += 1;
      continue;
    }
    if (next === "t") {
      decoded += "\t";
      index += 1;
      continue;
    }
    if (next === "b") {
      decoded += "\b";
      index += 1;
      continue;
    }
    if (next === "f") {
      decoded += "\f";
      index += 1;
      continue;
    }
    if (next === "\\" || next === "\"" || next === "/") {
      decoded += next;
      index += 1;
      continue;
    }
    if (next === "u") {
      const hex = value.slice(index + 2, index + 6);
      if (/^[0-9a-fA-F]{4}$/.test(hex)) {
        decoded += String.fromCharCode(Number.parseInt(hex, 16));
        index += 5;
        continue;
      }
    }

    decoded += next;
    index += 1;
  }
  return decoded;
}

function normalizeStringArgValue(toolName: string, argName: string, value: string): string {
  const unescaped = xmlUnescape(value.trim());
  if (toolName.toLowerCase() === "edit" && (argName === "oldString" || argName === "newString")) {
    return unescaped;
  }
  return decodeJsonStyleEscapes(unescaped);
}

function stripOpenTags(text: string): string {
  return text.replace(/<\/?open\s*>/gi, "");
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const regex = /([A-Za-z_][\w.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    const value = xmlUnescape(match[3] ?? match[4] ?? "");
    attrs[match[1]] = value;
    attrs[match[1].toLowerCase()] = value;
  }
  return attrs;
}

function extractToolBlocks(text: string, tools: readonly AnyAgentTool[] | undefined) {
  const normalizedTools = normalizeNanoGptBridgeTools(tools);
  const matches: Array<{ toolName: string; toolArgNames: string[]; fullMatch: string; toolBody: string; start: number; end: number }> = [];

  for (const tool of normalizedTools) {
    const escaped = tool.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const toolRegex = new RegExp(`<${escaped}(?:\\s+[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, "gi");
    let match: RegExpExecArray | null;
    while ((match = toolRegex.exec(text)) !== null) {
      matches.push({
        toolName: tool.name,
        toolArgNames: tool.args.map((arg) => arg.name),
        fullMatch: match[0],
        toolBody: match[1].trim(),
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  return matches.sort((left, right) => left.start - right.start);
}

function buildToolCallFromBlock(block: ReturnType<typeof extractToolBlocks>[number]): NanoGptBridgeToolCall {
  const attrs = parseXmlAttributes(block.fullMatch.match(/^<[^>]+>/)?.[0] ?? "");
  const args: Record<string, unknown> = {};
  const childRegex = /<([A-Za-z_][\w.-]*)(?:\s+[^>]*)?>([\s\S]*?)<\/\1\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = childRegex.exec(block.toolBody)) !== null) {
    args[match[1]] = normalizeStringArgValue(block.toolName, match[1], match[2]);
  }
  for (const [key, value] of Object.entries(attrs)) {
    if (!(key in args)) {
      args[key] = normalizeStringArgValue(block.toolName, key, value);
    }
  }
  if (Object.keys(args).length === 0 && block.toolArgNames.length === 1 && block.toolBody.length > 0) {
    args[block.toolArgNames[0]] = normalizeStringArgValue(block.toolName, block.toolArgNames[0], block.toolBody);
  }
  return { name: block.toolName, arguments: args };
}

export function parseXmlBridgeAssistantText(
  text: string,
  tools: readonly AnyAgentTool[] | undefined,
): NanoGptBridgeParseResult {
  const blocks = extractToolBlocks(text, tools);
  const toolCalls = blocks.map(buildToolCallFromBlock);

  if (toolCalls.length > 0) {
    let visibleText = "";
    let cursor = 0;
    for (const block of blocks) {
      visibleText += text.slice(cursor, block.start);
      cursor = block.end;
    }
    visibleText += text.slice(cursor);
    return {
      kind: "tool_calls",
      content: stripOpenTags(visibleText).trim(),
      toolCalls,
    };
  }

  return { kind: "final", content: stripOpenTags(text).trim() };
}

export class StreamingXmlParser {
  private mode: "text" | "buffering" | "tool" = "text";
  private buffer = "";
  private activeTool: AnyAgentTool | null = null;
  private toolIndex = 0;
  readonly completedCalls: NanoGptBridgeToolCall[] = [];

  constructor(
    private readonly tools: readonly AnyAgentTool[] | undefined,
    private readonly callbacks: {
      onContent?: (text: string) => void;
      onToolCall?: (call: NanoGptBridgeToolCall, index: number) => void;
    } = {},
  ) {}

  feed(text: string): void {
    for (const char of text) {
      if (this.mode === "text") {
        if (char === "<") {
          this.mode = "buffering";
          this.buffer = "<";
        } else {
          this.callbacks.onContent?.(char);
        }
        continue;
      }

      if (this.mode === "buffering") {
        this.buffer += char;
        let couldBeTool = false;
        let matchedTool: AnyAgentTool | null = null;
        for (const tool of this.tools ?? []) {
          if (typeof tool?.name !== "string") {
            continue;
          }
          const prefix = `<${tool.name}`;
          if (prefix.startsWith(this.buffer)) {
            couldBeTool = true;
            continue;
          }
          if (this.buffer.startsWith(prefix)) {
            const nextChar = this.buffer[prefix.length];
            if (nextChar === undefined) {
              couldBeTool = true;
              continue;
            }
            if (nextChar === ">" || /\s/.test(nextChar)) {
              if (this.buffer.endsWith(">")) {
                matchedTool = tool;
              } else {
                couldBeTool = true;
              }
            }
          }
        }

        if (matchedTool) {
          this.mode = "tool";
          this.activeTool = matchedTool;
        } else if (!couldBeTool) {
          this.callbacks.onContent?.(this.buffer);
          this.buffer = "";
          this.mode = "text";
        }
        continue;
      }

      this.buffer += char;
      const activeName = this.activeTool?.name;
      if (activeName && this.buffer.endsWith(`</${activeName}>`)) {
        const parsed = parseXmlBridgeAssistantText(this.buffer, this.activeTool ? [this.activeTool] : []);
        if (parsed.kind === "tool_calls" && parsed.toolCalls[0]) {
          this.completedCalls.push(parsed.toolCalls[0]);
          this.callbacks.onToolCall?.(parsed.toolCalls[0], this.toolIndex);
          this.toolIndex += 1;
        }
        this.mode = "text";
        this.buffer = "";
        this.activeTool = null;
      }
    }
  }

  flush(): void {
    if (!this.buffer.length) {
      return;
    }
    if (this.mode === "tool" && this.activeTool?.name) {
      this.buffer += `</${this.activeTool.name}>`;
      const parsed = parseXmlBridgeAssistantText(this.buffer, [this.activeTool]);
      if (parsed.kind === "tool_calls" && parsed.toolCalls[0]) {
        this.completedCalls.push(parsed.toolCalls[0]);
        this.callbacks.onToolCall?.(parsed.toolCalls[0], this.toolIndex);
        this.toolIndex += 1;
      }
    } else {
      this.callbacks.onContent?.(this.buffer);
    }
    this.buffer = "";
    this.mode = "text";
    this.activeTool = null;
  }
}
