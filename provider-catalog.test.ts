import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNanoGptProvider } from "./catalog/build-provider.js";
import { NANOGPT_FALLBACK_MODELS } from "./models.js";
import { resetNanoGptRuntimeState } from "./runtime.js";

afterEach(() => {
  resetNanoGptRuntimeState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("buildNanoGptProvider", () => {
  it("returns the responses transport when configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }] }),
      })),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: {
        routingMode: "paygo",
        catalogSource: "canonical",
        requestApi: "responses",
      },
    });

    expect(provider.api).toBe("openai-responses");
    expect(provider.baseUrl).toBe("https://nano-gpt.com/api/v1");
  });

  it("falls back to the base NanoGPT endpoint for responses on subscription routing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "moonshotai/kimi-k2.5:thinking", displayName: "Kimi K2.5 Thinking" }] }),
      })),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: {
        routingMode: "subscription",
        catalogSource: "subscription",
        requestApi: "responses",
      },
    });

    expect(provider.api).toBe("openai-responses");
    expect(provider.baseUrl).toBe("https://nano-gpt.com/api/v1");
  });

  it("uses the subscription base URL when auto resolves to subscription", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ subscribed: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "gpt-5.4-mini",
                displayName: "GPT-5.4 Mini",
                capabilities: {
                  reasoning: true,
                  vision: true,
                  tool_calling: true,
                },
                context_length: 200000,
                max_output_tokens: 32768,
                pricing: {
                  prompt: 2.5,
                  completion: 10,
                  unit: "per_million_tokens",
                },
              },
            ],
          }),
        }),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: { routingMode: "auto", catalogSource: "auto" },
    });

    expect(provider.api).toBe("openai-completions");
    expect(provider.baseUrl).toBe("https://nano-gpt.com/api/subscription/v1");
    expect(provider.models[0]?.id).toBe("gpt-5.4-mini");
    expect(provider.models[0]).toMatchObject({
      input: ["text", "image"],
      reasoning: true,
      compat: {
        supportsTools: true,
      },
      cost: {
        input: 2.5,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
      },
    });
  });

  it("keeps subscription routing when the usage probe only reports state=active", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ state: "active" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "moonshotai/kimi-k2.5:thinking",
                displayName: "Kimi K2.5 Thinking",
              },
            ],
          }),
        }),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: { routingMode: "auto", catalogSource: "auto" },
    });

    expect(provider.baseUrl).toBe("https://nano-gpt.com/api/subscription/v1");
    expect(provider.models[0]?.id).toBe("moonshotai/kimi-k2.5:thinking");
  });

  it("keeps subscription routing when the usage probe errors in auto mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("usage probe failed"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "moonshotai/kimi-k2.5:thinking",
                displayName: "Kimi K2.5 Thinking",
              },
            ],
          }),
        }),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: { routingMode: "auto", catalogSource: "auto" },
    });

    expect(provider.baseUrl).toBe("https://nano-gpt.com/api/subscription/v1");
    expect(provider.models[0]?.id).toBe("moonshotai/kimi-k2.5:thinking");
  });

  it("does not reuse a failed usage probe as paygo on the next provider build", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValueOnce(new Error("usage probe failed"))
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "moonshotai/kimi-k2.5:thinking",
                displayName: "Kimi K2.5 Thinking",
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ subscribed: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "moonshotai/kimi-k2.5:thinking",
                displayName: "Kimi K2.5 Thinking",
              },
            ],
          }),
        }),
    );

    const firstProvider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: { routingMode: "auto", catalogSource: "auto" },
    });

    const secondProvider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: { routingMode: "auto", catalogSource: "auto" },
    });

    expect(firstProvider.baseUrl).toBe("https://nano-gpt.com/api/subscription/v1");
    expect(secondProvider.baseUrl).toBe("https://nano-gpt.com/api/subscription/v1");
  });

  it("adds provider override headers for paygo routing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }] }),
      })),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: {
        routingMode: "paygo",
        catalogSource: "canonical",
        provider: "openrouter",
      },
    });

    expect(provider.headers).toEqual({
      "X-Provider": "openrouter",
    });
  });

  it("sanitizes provider override headers before returning the provider config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }] }),
      })),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: {
        routingMode: "paygo",
        catalogSource: "canonical",
        provider: "openrouter\r\nInjected: true",
      },
    });

    expect(provider.headers).toEqual({
      "X-Provider": "openrouterInjected: true",
    });
  });

  it("ignores provider overrides on subscription routing to avoid paygo billing errors", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }] }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: {
        routingMode: "subscription",
        catalogSource: "subscription",
        provider: "openrouter",
      },
    });

    expect(provider.baseUrl).toBe("https://nano-gpt.com/api/subscription/v1");
    expect(provider.headers).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("omits Authorization from provider config so runtime auth can inject the real key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }] }),
      })),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: {
        routingMode: "subscription",
        catalogSource: "subscription",
      },
    });

    expect(provider.headers).toBeUndefined();
  });

  it("never serializes a placeholder Authorization header into cached provider configs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }] }),
      })),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "NANOGPT_API_KEY",
      pluginConfig: {
        routingMode: "paygo",
        catalogSource: "canonical",
        provider: "openrouter",
      },
    });

    const serializedProvider = JSON.stringify(provider);

    expect(provider.apiKey).toBe("NANOGPT_API_KEY");
    expect(provider.headers).toEqual({
      "X-Provider": "openrouter",
    });
    expect(serializedProvider).not.toContain("Authorization");
    expect(serializedProvider).not.toContain("Bearer NANOGPT_API_KEY");
  });

  it("surfaces provider-specific model pricing when an upstream provider is configured", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            data: [
              {
                id: "moonshotai/kimi-k2.5",
                displayName: "Kimi K2.5",
                pricing: {
                  prompt: 1.5,
                  completion: 4.5,
                  unit: "per_million_tokens",
                },
              },
            ],
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            canonicalId: "moonshotai/kimi-k2.5",
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
        }),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: {
        routingMode: "paygo",
        catalogSource: "canonical",
        provider: "openrouter",
      },
    });

    expect(provider.models[0]?.id).toBe("moonshotai/kimi-k2.5");
    expect(provider.models[0]?.cost.input).toBeCloseTo(0.42, 10);
    expect(provider.models[0]?.cost.output).toBeCloseTo(1.8375, 10);
    expect(provider.models[0]?.cost.cacheRead).toBe(0);
    expect(provider.models[0]?.cost.cacheWrite).toBe(0);
  });

  it("keeps fallback discovery soft when responses catalog lookup fails", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: {
        routingMode: "paygo",
        catalogSource: "canonical",
        requestApi: "responses",
      },
    });

    expect(provider.api).toBe("openai-responses");
    expect(provider.baseUrl).toBe("https://nano-gpt.com/api/v1");
    expect(provider.models.map((model) => model.id)).toEqual(NANOGPT_FALLBACK_MODELS.map((model) => model.id));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
