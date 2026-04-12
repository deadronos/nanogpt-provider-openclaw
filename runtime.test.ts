import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNanoGptRequestHeaders,
  discoverNanoGptModels,
  fetchNanoGptUsageSnapshot,
  getNanoGptConfig,
  resetNanoGptRuntimeState,
  resolveCatalogSource,
  resolveNanoGptDynamicModel,
  resolveNanoGptRequestApi,
  resolveRequestBaseUrl,
  resolveNanoGptRoutingMode,
  resolveNanoGptUsageAuth,
} from "./runtime.js";

afterEach(() => {
  resetNanoGptRuntimeState();
  vi.unstubAllGlobals();
});

describe("getNanoGptConfig", () => {
  it("normalizes supported config fields", () => {
    expect(
      getNanoGptConfig({
        routingMode: "subscription",
        catalogSource: "personalized",
        requestApi: "responses",
        provider: " openrouter ",
      }),
    ).toEqual({
      routingMode: "subscription",
      catalogSource: "personalized",
      requestApi: "responses",
      provider: "openrouter",
    });
  });
});

describe("resolveNanoGptRequestApi", () => {
  it("defaults auto/undefined requestApi to OpenAI Completions transport", () => {
    expect(resolveNanoGptRequestApi({})).toBe("openai-completions");
    expect(resolveNanoGptRequestApi({ requestApi: "auto" })).toBe("openai-completions");
  });

  it("keeps explicit responses requestApi", () => {
    expect(resolveNanoGptRequestApi({ requestApi: "responses" })).toBe("openai-responses");
  });
});

describe("resolveNanoGptRoutingMode", () => {
  it("returns explicit paygo without probing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "paygo" },
        apiKey: "test-key",
      }),
    ).resolves.toBe("paygo");

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("caches subscription status per api key", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscribed: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscribed: false }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "key-a",
      }),
    ).resolves.toBe("subscription");
    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "key-a",
      }),
    ).resolves.toBe("subscription");
    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "key-b",
      }),
    ).resolves.toBe("paygo");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("resolveCatalogSource", () => {
  it("maps auto to subscription when routing resolved to subscription", () => {
    expect(resolveCatalogSource({ config: {}, routingMode: "subscription" })).toBe("subscription");
  });
});

describe("resolveRequestBaseUrl", () => {
  it("uses the base API for responses requests even when routing resolved to subscription", () => {
    expect(
      resolveRequestBaseUrl({
        config: { requestApi: "responses" },
        routingMode: "subscription",
      }),
    ).toBe("https://nano-gpt.com/api/v1");
  });

  it("keeps the subscription API for completions requests on subscription routing", () => {
    expect(
      resolveRequestBaseUrl({
        config: { requestApi: "completions" },
        routingMode: "subscription",
      }),
    ).toBe("https://nano-gpt.com/api/subscription/v1");
  });
});

describe("buildNanoGptRequestHeaders", () => {
  it("adds provider override and billing override for subscription routing", () => {
    expect(
      buildNanoGptRequestHeaders({
        apiKey: "test-key",
        config: { provider: "openrouter" },
        routingMode: "subscription",
      }),
    ).toEqual({
      Authorization: "Bearer test-key",
      "X-Billing-Mode": "paygo",
      "X-Provider": "openrouter",
    });
  });
});

describe("resolveNanoGptUsageAuth", () => {
  it("resolves the NanoGPT API key from config/store/env", async () => {
    await expect(
      resolveNanoGptUsageAuth({
        env: { NANOGPT_API_KEY: "env-key" },
        resolveApiKeyFromConfigAndStore: () => "stored-key",
      } as never),
    ).resolves.toEqual({ token: "stored-key" });
  });
});

describe("fetchNanoGptUsageSnapshot", () => {
  it("maps NanoGPT quota windows into OpenClaw usage windows", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        active: true,
        state: "active",
        daily: {
          used: 5,
          remaining: 1995,
          percentUsed: 0.0025,
          resetAt: 1738540800000,
        },
        monthly: {
          used: 45,
          remaining: 59955,
          percentUsed: 0.00075,
          resetAt: 1739404800000,
        },
      }),
    });

    await expect(
      fetchNanoGptUsageSnapshot({
        token: "test-key",
        timeoutMs: 1_000,
        fetchFn: fetchSpy,
      } as never),
    ).resolves.toMatchObject({
      provider: "nanogpt",
      displayName: "NanoGPT",
      plan: "active",
      windows: [
        {
          label: "Daily",
          usedPercent: 0.25,
          resetAt: 1738540800000,
        },
        {
          label: "Monthly",
          usedPercent: 0.075,
          resetAt: 1739404800000,
        },
      ],
    });
  });

  it("returns an error snapshot on non-200 responses", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response("Unauthorized", {
        status: 401,
        headers: { "Content-Type": "text/plain" },
      }),
    );

    await expect(
      fetchNanoGptUsageSnapshot({
        token: "bad-key",
        timeoutMs: 1_000,
        fetchFn: fetchSpy,
      } as never),
    ).resolves.toMatchObject({
      provider: "nanogpt",
      error: expect.stringContaining("HTTP 401"),
    });
  });
});

describe("discoverNanoGptModels", () => {
  it("requests detailed metadata and maps multimodal capabilities", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        object: "list",
        data: [
          {
            id: "moonshotai/kimi-k2.5:thinking",
            name: "Kimi K2.5 Thinking",
            capabilities: {
              reasoning: true,
              vision: true,
              tool_calling: true,
            },
            context_length: 262144,
            max_output_tokens: 8192,
            pricing: {
              prompt: 1.5,
              completion: 4.5,
              unit: "per_million_tokens",
            },
          },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      discoverNanoGptModels({
        apiKey: "test-key",
        source: "canonical",
      }),
    ).resolves.toMatchObject([
      {
        id: "moonshotai/kimi-k2.5:thinking",
        name: "Kimi K2.5 Thinking",
        reasoning: true,
        input: ["text", "image"],
        compat: {
          supportsTools: true,
        },
        contextWindow: 262144,
        maxTokens: 8192,
        cost: {
          input: 1.5,
          output: 4.5,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
    ]);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe("https://nano-gpt.com/api/v1/models?detailed=true");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      headers: {
        Authorization: "Bearer test-key",
        Accept: "application/json",
      },
    });
  });

  it("overrides catalog pricing with the selected provider pricing when available", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object: "list",
          data: [
            {
              id: "moonshotai/kimi-k2.5",
              name: "Kimi K2.5",
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
      });
    vi.stubGlobal("fetch", fetchSpy);

    const models = await discoverNanoGptModels({
      apiKey: "test-key",
      source: "canonical",
      provider: "openrouter",
    });

    expect(models).toHaveLength(1);
    expect(models[0]?.id).toBe("moonshotai/kimi-k2.5");
    expect(models[0]?.cost.input).toBeCloseTo(0.42, 10);
    expect(models[0]?.cost.output).toBeCloseTo(1.8375, 10);
    expect(models[0]?.cost.cacheRead).toBe(0);
    expect(models[0]?.cost.cacheWrite).toBe(0);

    expect(String(fetchSpy.mock.calls[1]?.[0])).toBe(
      "https://nano-gpt.com/api/models/moonshotai%2Fkimi-k2.5/providers",
    );
  });

  it("keeps default catalog pricing when selected-provider pricing is unavailable", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object: "list",
          data: [
            {
              id: "moonshotai/kimi-k2.5",
              name: "Kimi K2.5",
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
              provider: "other-provider",
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

    await expect(
      discoverNanoGptModels({
        apiKey: "test-key",
        source: "canonical",
        provider: "openrouter",
      }),
    ).resolves.toMatchObject([
      {
        id: "moonshotai/kimi-k2.5",
        cost: {
          input: 1.5,
          output: 4.5,
          cacheRead: 0,
          cacheWrite: 0,
        },
      },
    ]);
  });
});

describe("resolveNanoGptDynamicModel", () => {
  it("preserves exact unknown NanoGPT model ids so requests can still be sent", () => {
    expect(
      resolveNanoGptDynamicModel({
        provider: "nanogpt",
        modelId: "moonshotai/kimi-k2.5:thinking",
        modelRegistry: {} as never,
        providerConfig: {
          api: "openai-completions",
          baseUrl: "https://nano-gpt.com/api/subscription/v1",
          models: [],
        },
      }),
    ).toMatchObject({
      id: "moonshotai/kimi-k2.5:thinking",
      name: "moonshotai/kimi-k2.5:thinking",
      provider: "nanogpt",
      api: "openai-completions",
      baseUrl: "https://nano-gpt.com/api/subscription/v1",
      reasoning: true,
      input: ["text"],
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    });
  });

  it("reuses known catalog metadata when a related template model exists", () => {
    expect(
      resolveNanoGptDynamicModel({
        provider: "nanogpt",
        modelId: "moonshotai/kimi-k2.5:thinking",
        modelRegistry: {} as never,
        providerConfig: {
          api: "openai-completions",
          baseUrl: "https://nano-gpt.com/api/v1",
          models: [
            {
              id: "moonshotai/kimi-k2.5",
              name: "Kimi K2.5",
              reasoning: false,
              input: ["text", "image"],
              cost: {
                input: 1.5,
                output: 4.5,
                cacheRead: 0,
                cacheWrite: 0,
              },
              contextWindow: 262144,
              maxTokens: 8192,
              compat: {
                supportsTools: true,
              },
            },
          ],
        },
      }),
    ).toMatchObject({
      id: "moonshotai/kimi-k2.5:thinking",
      name: "Kimi K2.5 Thinking",
      reasoning: true,
      input: ["text", "image"],
      compat: {
        supportsTools: true,
      },
      contextWindow: 262144,
      maxTokens: 8192,
      cost: {
        input: 1.5,
        output: 4.5,
        cacheRead: 0,
        cacheWrite: 0,
      },
    });
  });
});

describe("resetNanoGptRuntimeState", () => {
  it("clears the subscription cache", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ subscribed: true }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await resolveNanoGptRoutingMode({
      config: { routingMode: "auto" },
      apiKey: "test-clearing",
    });
    
    resetNanoGptRuntimeState();
    
    await resolveNanoGptRoutingMode({
      config: { routingMode: "auto" },
      apiKey: "test-clearing",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
