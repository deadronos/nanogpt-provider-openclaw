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
  it("maps detailed capability and pricing metadata into an OpenClaw model definition", () => {
    expect(
      buildNanoGptModelDefinition({
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        capabilities: {
          reasoning: true,
          vision: true,
        },
        context_length: 1234,
        max_output_tokens: 567,
        pricing: {
          prompt: 2.5,
          completion: 7.5,
          unit: "per_million_tokens",
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
        input: 2.5,
        output: 7.5,
        cacheRead: 0,
        cacheWrite: 0,
      },
    });
  });

  it("keeps backward compatibility with top-level vision metadata", () => {
    expect(
      buildNanoGptModelDefinition({
        id: "legacy-vision-model",
        vision: true,
      }),
    ).toMatchObject({
      id: "legacy-vision-model",
      input: ["text", "image"],
    });
  });
});
