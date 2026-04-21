import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNanoGptUsageSnapshot, resolveNanoGptUsageAuth } from "./usage.js";

afterEach(() => {
  vi.unstubAllGlobals();
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
