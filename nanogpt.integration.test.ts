import { describe, expect, it } from "vitest";
import { discoverNanoGptModels, probeNanoGptSubscription } from "./runtime.js";

// Integration tests only run when an API key is provided
describe.skipIf(!process.env.NANOGPT_API_KEY)("NanoGPT Integration Tests", () => {
  it("should successfully retrieve models from the live NanoGPT API", async () => {
    const models = await discoverNanoGptModels({
      apiKey: process.env.NANOGPT_API_KEY!,
      source: "canonical",
    });

    expect(Array.isArray(models)).toBe(true);
    expect(models.length).toBeGreaterThan(0);

    // Validate shape
    expect(models[0]).toHaveProperty("id");
    expect(models[0]).toHaveProperty("cost");
    expect(models[0]).toHaveProperty("maxTokens");
  });

  it("should probe the NanoGPT subscription endpoint", async () => {
    const active = await probeNanoGptSubscription(process.env.NANOGPT_API_KEY!);
    expect(typeof active).toBe("boolean");
  });
});
