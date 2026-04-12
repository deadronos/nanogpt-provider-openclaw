import { describe, expect, it } from "vitest";
import {
  applyNanoGptConfig,
  applyNanoGptProviderConfig,
} from "./onboard.js";

describe("NanoGPT onboarding helpers", () => {
  it("adds the NanoGPT alias without forcing a primary model", () => {
    const next = applyNanoGptProviderConfig({});

    expect(next.agents?.defaults?.models).toMatchObject({
      "nanogpt/gpt-5.4-mini": {
        alias: "NanoGPT",
      },
    });
    expect(next.agents?.defaults?.model).toBeUndefined();
  });

  it("can still apply an explicit NanoGPT primary model when requested", () => {
    const next = applyNanoGptConfig({});

    expect(next.agents?.defaults?.models).toMatchObject({
      "nanogpt/gpt-5.4-mini": {
        alias: "NanoGPT",
      },
    });
    expect(next.agents?.defaults?.model).toMatchObject({
      primary: "nanogpt/gpt-5.4-mini",
    });
  });
});