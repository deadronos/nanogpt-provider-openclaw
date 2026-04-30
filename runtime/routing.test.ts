import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NANOGPT_BASE_URL,
  NANOGPT_PAID_BASE_URL,
  NANOGPT_PERSONALIZED_BASE_URL,
  NANOGPT_SUBSCRIPTION_BASE_URL,
} from "../models.js";
import { resetNanoGptRuntimeState } from "../runtime.js";
import {
  buildNanoGptRequestHeaders,
  resolveCatalogBaseUrl,
  resolveCatalogSource,
  probeNanoGptSubscription,
  resolveNanoGptRoutingMode,
  resolveRequestBaseUrl,
} from "./routing.js";

afterEach(() => {
  resetNanoGptRuntimeState();
  vi.unstubAllGlobals();
});

describe("probeNanoGptSubscription", () => {
  it("throws when the subscription probe fails with a non-OK status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(probeNanoGptSubscription("test-key")).rejects.toThrow(
      "NanoGPT subscription probe failed with HTTP 500",
    );
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

  it("treats a state-only active usage payload as subscription", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ state: "active" }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "state-only-key",
      }),
    ).resolves.toBe("subscription");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("treats a future grace period as subscription", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "grace",
        active: false,
        graceUntil: Date.now() + 60_000,
      }),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "grace-key",
      }),
    ).resolves.toBe("subscription");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("favors subscription when the usage probe errors in auto mode", async () => {
    const fetchSpy = vi.fn().mockRejectedValue(new Error("usage probe failed"));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "probe-error-key",
      }),
    ).resolves.toBe("subscription");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("does not cache a probe failure as paygo for the next auto-routed call", async () => {
    const fetchSpy = vi
      .fn()
      .mockRejectedValueOnce(new Error("usage probe failed"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscribed: true }),
      });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "retry-key",
      }),
    ).resolves.toBe("subscription");

    await expect(
      resolveNanoGptRoutingMode({
        config: { routingMode: "auto" },
        apiKey: "retry-key",
      }),
    ).resolves.toBe("subscription");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

  it("maps auto to canonical when routing resolved to paygo", () => {
    expect(resolveCatalogSource({ config: {}, routingMode: "paygo" })).toBe("canonical");
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
  it("adds provider override headers for paygo routing", () => {
    expect(
      buildNanoGptRequestHeaders({
        apiKey: "test-key",
        config: { provider: "openrouter" },
        routingMode: "paygo",
      }),
    ).toEqual({
      Authorization: "Bearer test-key",
      "X-Provider": "openrouter",
    });
  });

  it("sanitizes provider header values before sending them", () => {
    expect(
      buildNanoGptRequestHeaders({
        apiKey: "test-key\r\nInjected: true",
        config: { provider: "openrouter\r\nInjected: true" },
        routingMode: "paygo",
      }),
    ).toEqual({
      Authorization: "Bearer test-keyInjected: true",
      "X-Provider": "openrouterInjected: true",
    });
  });

  it("ignores provider override during subscription routing", () => {
    expect(
      buildNanoGptRequestHeaders({
        apiKey: "test-key",
        config: { provider: "openrouter" },
        routingMode: "subscription",
      }),
    ).toEqual({
      Authorization: "Bearer test-key",
    });
  });

  it("does not add extra headers when no provider override is configured", () => {
    expect(
      buildNanoGptRequestHeaders({
        apiKey: "test-key",
        config: {},
        routingMode: "subscription",
      }),
    ).toEqual({
      Authorization: "Bearer test-key",
    });
  });
});

describe("resolveCatalogBaseUrl", () => {
  it("maps subscription source to the subscription base URL", () => {
    expect(resolveCatalogBaseUrl("subscription")).toBe(NANOGPT_SUBSCRIPTION_BASE_URL);
  });

  it("maps paid source to the paid base URL", () => {
    expect(resolveCatalogBaseUrl("paid")).toBe(NANOGPT_PAID_BASE_URL);
  });

  it("maps personalized source to the personalized base URL", () => {
    expect(resolveCatalogBaseUrl("personalized")).toBe(NANOGPT_PERSONALIZED_BASE_URL);
  });

  it("maps canonical source to the standard base URL", () => {
    expect(resolveCatalogBaseUrl("canonical")).toBe(NANOGPT_BASE_URL);
  });

  it("maps an unknown/default source to the standard base URL", () => {
    expect(resolveCatalogBaseUrl("unknown" as any)).toBe(NANOGPT_BASE_URL);
  });
});
