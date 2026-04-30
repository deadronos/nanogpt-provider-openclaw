import { describe, expect, it } from "vitest";
import { parseXmlBridgeAssistantText, StreamingXmlParser } from "./xml-parser.js";

describe("xml bridge parser", () => {
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

  it("extracts tool calls and open text", () => {
    expect(
      parseXmlBridgeAssistantText("<open>reading</open><read><path>a.js</path></read>", tools),
    ).toMatchObject({
      kind: "tool_calls",
      content: "reading",
      toolCalls: [{ name: "read", arguments: { path: "a.js" } }],
    });
  });

  it("streams xml bridge content", () => {
    const visible: string[] = [];
    const toolCalls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    const parser = new StreamingXmlParser(tools, {
      onContent: (text) => visible.push(text),
      onToolCall: (toolCall) => toolCalls.push(toolCall),
    });

    parser.feed("<open>reading</open><read><path>a.js</path>");
    parser.feed("</read>");
    parser.flush();

    expect(visible.join("")).toContain("reading");
    expect(toolCalls).toEqual([{ name: "read", arguments: { path: "a.js" } }]);
  });
});
