import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNanoGptRequestHeaders,
  discoverNanoGptModels,
  getNanoGptConfig,
  resetNanoGptRuntimeState,
  resolveCatalogSource,
  resolveNanoGptRoutingMode,
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
});
