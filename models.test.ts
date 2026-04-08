import { describe, expect, it } from "vitest";
import {
  NANOGPT_DEFAULT_MODEL_REF,
  NANOGPT_FALLBACK_MODELS,
  buildNanoGptModelDefinition,
} from "./models.js";

describe("model constants", () => {
  it("exposes the default NanoGPT model ref", () => {
    expect(NANOGPT_DEFAULT_MODEL_REF).toBe("nanogpt/gpt-5.4-mini");
  });

  it("ships a non-empty fallback catalog", () => {
    expect(NANOGPT_FALLBACK_MODELS.length).toBeGreaterThan(0);
  });
});

describe("buildNanoGptModelDefinition", () => {
  it("maps vision and pricing metadata into an OpenClaw model definition", () => {
    expect(
      buildNanoGptModelDefinition({
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        reasoning: true,
        vision: true,
        contextWindow: 1234,
        maxTokens: 567,
        pricing: {
          inputPer1kTokens: 0.1,
          outputPer1kTokens: 0.2,
        },
      }),
    ).toMatchObject({
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1234,
      maxTokens: 567,
      cost: {
        input: 100,
        output: 200,
        cacheRead: 0,
        cacheWrite: 0,
      },
    });
  });
});
