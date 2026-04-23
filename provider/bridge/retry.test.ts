import { describe, expect, it } from "vitest";
import { buildNanoGptBridgeRetrySystemMessage } from "./retry.js";

describe("bridge retry prompts", () => {
  it("builds different object and xml retry prompts", () => {
    const objectPrompt = buildNanoGptBridgeRetrySystemMessage("object");
    const xmlPrompt = buildNanoGptBridgeRetrySystemMessage("xml");

    expect(objectPrompt).toContain("JSON turn object");
    expect(xmlPrompt).toContain("XML tool call");
    expect(objectPrompt).not.toEqual(xmlPrompt);
  });
});
