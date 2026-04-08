import { afterEach, describe, expect, it, vi } from "vitest";
import { buildNanoGptProvider } from "./provider-catalog.js";
import { resetNanoGptRuntimeState } from "./runtime.js";

afterEach(() => {
  resetNanoGptRuntimeState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("buildNanoGptProvider", () => {
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
            data: [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini", reasoning: true }],
          }),
        }),
    );

    const provider = await buildNanoGptProvider({
      apiKey: "test-key",
      pluginConfig: { routingMode: "auto", catalogSource: "auto" },
    });

    expect(provider.baseUrl).toBe("https://nano-gpt.com/api/subscription/v1");
    expect(provider.models[0]?.id).toBe("gpt-5.4-mini");
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
});
