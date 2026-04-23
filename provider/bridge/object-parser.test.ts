import { describe, expect, it } from "vitest";
import { parseObjectBridgeAssistantText, StreamingObjectParser } from "./object-parser.js";

describe("object bridge parser", () => {
  const tools = [
    {
      name: "read",
      description: "Read a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
        },
        required: ["path"],
      },
    },
  ] as any;

  it("parses a complete object bridge turn", () => {
    expect(
      parseObjectBridgeAssistantText(
        '{"v":1,"mode":"tool","message":"reading","tool_calls":[{"name":"read","arguments":{"path":"a.js"}}]}',
        tools,
      ),
    ).toMatchObject({
      kind: "tool_calls",
      content: "reading",
      toolCalls: [{ name: "read", arguments: { path: "a.js" } }],
    });
  });

  it("parses incremental object bridge content", () => {
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const visible: string[] = [];
    const parser = new StreamingObjectParser(tools, {
      onContent: (text) => visible.push(text),
      onToolCall: (toolCall) => toolCalls.push(toolCall),
    });

    parser.feed('{"v":1,"mode":"tool","message":"rea');
    parser.feed('ding","tool_calls":[{"name":"read","arg');
    parser.feed('uments":{"path":"a.js"}}]}');
    parser.flush();

    expect(visible.join("")).toBe("reading");
    expect(toolCalls).toEqual([{ name: "read", arguments: { path: "a.js" } }]);
  });
});
