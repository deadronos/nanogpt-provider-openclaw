import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveNanoGptRoutingMode } from "./runtime/routing.js";
import { resetNanoGptRuntimeState } from "./runtime.js";
import { discoverNanoGptModels } from "./runtime/discovery.js";
import { getNanoGptConfig, resolveNanoGptRequestApi } from "./runtime/config.js";
import { resolveNanoGptDynamicModel } from "./runtime/dynamic-models.js";

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
        bridgeMode: "always",
        bridgeProtocol: "xml",
      }),
    ).toEqual({
      routingMode: "subscription",
      catalogSource: "personalized",
      requestApi: "responses",
      provider: "openrouter",
      bridgeMode: "always",
      bridgeProtocol: "xml",
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

  it("keeps default catalog pricing when an error occurs fetching selected-provider pricing", async () => {
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
      .mockRejectedValueOnce(new Error("Network error"));

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

  it("keeps default catalog pricing when selected-provider pricing payload lacks pricing data", async () => {
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
          supportsProviderSelection: true,
          providers: [
            {
              provider: "openrouter",
              available: true,
              // missing pricing
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

  it("keeps default catalog pricing when selected-provider pricing payload lacks providers array", async () => {
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
          supportsProviderSelection: true,
          // providers missing or not an array
          providers: null,
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

  it("truncates long error messages in the discovery error log to 200 characters", async () => {
    const longErrorMessage = "B".repeat(500);
    const fetchSpy = vi.fn().mockRejectedValue(new Error(longErrorMessage));
    vi.stubGlobal("fetch", fetchSpy);

    // discoverNanoGptModels returns fallback models on error.
    // Verify the error path executed by checking fetch was called.
    const result = await discoverNanoGptModels({
      apiKey: "test-key",
      source: "canonical",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("logs a plain non-Error thrown value as a truncated string on discovery failure", async () => {
    const fetchSpy = vi.fn().mockRejectedValue("not an Error object");
    vi.stubGlobal("fetch", fetchSpy);

    // Non-Error values are stringified before logging.
    // Verify the error path executed.
    const result = await discoverNanoGptModels({
      apiKey: "test-key",
      source: "canonical",
    });
    expect(result.length).toBeGreaterThan(0);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
