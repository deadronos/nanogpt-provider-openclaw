import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNanoGptRequestHeaders,
  getNanoGptConfig,
  resetNanoGptRuntimeState,
  resolveCatalogSource,
  resolveNanoGptRoutingMode,
} from "./runtime.js";

afterEach(() => {
  resetNanoGptRuntimeState();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getNanoGptConfig", () => {
  it("normalizes supported config fields", () => {
    expect(
      getNanoGptConfig({
        routingMode: "subscription",
        catalogSource: "personalized",
        provider: " openrouter ",
      }),
    ).toEqual({
      routingMode: "subscription",
      catalogSource: "personalized",
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
