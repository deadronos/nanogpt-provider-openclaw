import { afterEach, describe, expect, it, vi } from "vitest";
import { resetNanoGptRuntimeState } from "../runtime.js";
import { fetchNanoGptSelectedProviderPricing } from "./provider-pricing.js";

afterEach(() => {
  resetNanoGptRuntimeState();
  vi.unstubAllGlobals();
});

describe("fetchNanoGptSelectedProviderPricing", () => {
  it("returns null if provider normalizes to empty", async () => {
    const result = await fetchNanoGptSelectedProviderPricing({
      apiKey: "test-key",
      modelId: "test-model",
      provider: "   ", // normalizes to empty string
    });
    expect(result).toBeNull();
  });

  it("returns null if fetch throws an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
    const result = await fetchNanoGptSelectedProviderPricing({
      apiKey: "test-key",
      modelId: "test-model",
      provider: "valid-provider",
    });
    expect(result).toBeNull();
  });

  it("returns null if fetch response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const result = await fetchNanoGptSelectedProviderPricing({
      apiKey: "test-key",
      modelId: "test-model",
      provider: "valid-provider",
    });
    expect(result).toBeNull();
  });

  it("returns null if payload is invalid or does not support provider selection", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ supportsProviderSelection: false }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const result = await fetchNanoGptSelectedProviderPricing({
      apiKey: "test-key",
      modelId: "test-model",
      provider: "valid-provider",
    });
    expect(result).toBeNull();
  });

  it("shares an in-flight provider pricing lookup across concurrent calls", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        supportsProviderSelection: true,
        providers: [
          {
            provider: "openrouter",
            available: true,
            pricing: {
              inputPer1kTokens: 0.00042,
              outputPer1kTokens: 0.0018375,
              unit: "per_1k_tokens",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const params = {
      apiKey: "test-key",
      modelId: "test-model",
      provider: "openrouter",
    };

    const [first, second] = await Promise.all([
      fetchNanoGptSelectedProviderPricing(params),
      fetchNanoGptSelectedProviderPricing(params),
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      inputPer1kTokens: 0.00042,
      outputPer1kTokens: 0.0018375,
      unit: "per_1k_tokens",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    await expect(fetchNanoGptSelectedProviderPricing(params)).resolves.toMatchObject({
      inputPer1kTokens: 0.00042,
      outputPer1kTokens: 0.0018375,
      unit: "per_1k_tokens",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("resetNanoGptRuntimeState", () => {
  it("clears the provider pricing cache", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        supportsProviderSelection: true,
        providers: [
          {
            provider: "openrouter",
            available: true,
            pricing: {
              inputPer1kTokens: 0.00042,
              outputPer1kTokens: 0.0018375,
              unit: "per_1k_tokens",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const params = {
      apiKey: "test-key",
      modelId: "test-model",
      provider: "openrouter",
    };

    await fetchNanoGptSelectedProviderPricing(params);
    await fetchNanoGptSelectedProviderPricing(params);
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    resetNanoGptRuntimeState();

    await fetchNanoGptSelectedProviderPricing(params);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
