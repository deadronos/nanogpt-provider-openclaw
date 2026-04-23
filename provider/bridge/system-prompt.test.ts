import { describe, expect, it } from "vitest";
import {
  buildNanoGptObjectBridgeSystemMessage,
  buildNanoGptXmlBridgeSystemMessage,
} from "./system-prompt.js";

describe("bridge system prompts", () => {
  it("builds the object bridge contract", () => {
    const prompt = buildNanoGptObjectBridgeSystemMessage([
      {
        name: "read",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Path to read" },
          },
          required: ["path"],
        },
      },
    ] as any);

    expect(prompt).toContain('"v"');
    expect(prompt).toContain('"tool_calls"');
    expect(prompt).toContain("read");
    expect(prompt).not.toContain("function_call");
  });

  it("builds the xml bridge contract", () => {
    const prompt = buildNanoGptXmlBridgeSystemMessage([
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
    ] as any);

    expect(prompt).toContain("<read>");
    expect(prompt).toContain("<open>");
    expect(prompt).toContain("Read a file");
  });
});
