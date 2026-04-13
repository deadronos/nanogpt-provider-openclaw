import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNanoGptProvider } from "./provider-catalog.js";
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

  it("adds provider override headers and paygo billing override for subscription routing", async () => {
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
        provider: "openrouter",
      },
    });

    expect(provider.headers).toEqual({
      Authorization: "Bearer test-key",
      "X-Billing-Mode": "paygo",
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
        routingMode: "subscription",
        catalogSource: "subscription",
        provider: "openrouter\r\nInjected: true",
      },
    });

    expect(provider.headers).toEqual({
      Authorization: "Bearer test-key",
      "X-Billing-Mode": "paygo",
      "X-Provider": "openrouterInjected: true",
    });
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

  it("provides helpful error when responses API has no models but completions does", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // First call (responses discovery): fail → returns fallback models
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({}),
    });

    // Second call (completions validation check): succeed → returns real models
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }],
      }),
    });

    await expect(
      buildNanoGptProvider({
        apiKey: "test-key",
        pluginConfig: {
          routingMode: "paygo",
          catalogSource: "canonical",
          requestApi: "responses",
        },
      }),
    ).rejects.toThrow(/Responses API endpoint.*Chat Completions API/);
  });
});
