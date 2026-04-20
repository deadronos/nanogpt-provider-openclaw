import { describe, expect, it } from "vitest";
import {
  applyNanoGptConfig,
  applyNanoGptProviderAuthConfig,
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

  it("provisions the NanoGPT web_search credential path from auth credentials", () => {
    const next = applyNanoGptProviderAuthConfig({}, {
      type: "api_key",
      provider: "nanogpt",
      key: "ngpt_test_key",
    });

    expect(next.plugins?.entries?.nanogpt).toMatchObject({
      enabled: true,
      config: {
        webSearch: {
          apiKey: "ngpt_test_key",
        },
      },
    });
    expect(next.agents?.defaults?.models).toMatchObject({
      "nanogpt/gpt-5.4-mini": {
        alias: "NanoGPT",
      },
    });
  });

  it("keeps env secret refs portable when provisioning NanoGPT web_search auth", () => {
    const next = applyNanoGptProviderAuthConfig({}, {
      type: "api_key",
      provider: "nanogpt",
      keyRef: {
        source: "env",
        provider: "default",
        id: "NANOGPT_API_KEY",
      },
    });

    expect(next.plugins?.entries?.nanogpt?.config).toMatchObject({
      webSearch: {
        apiKey: "${NANOGPT_API_KEY}",
      },
    });
  });
});