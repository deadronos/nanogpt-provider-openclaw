import { describe, expect, it } from "vitest";
import { getRegisteredProviderHarness } from "./test-harness.js";

describe("provider error hooks", () => {
  it("classifies structured NanoGPT rate limits and logs the mapped reason once", () => {
    const { provider, warn } = getRegisteredProviderHarness();
    expect(provider.classifyFailoverReason).toEqual(expect.any(Function));

    const errorMessage = JSON.stringify({
      error: {
        message: "Daily request limit exceeded",
        type: "rate_limit_error",
        code: "daily_rpd_limit_exceeded",
      },
      status: 429,
    });

    expect(
      provider.classifyFailoverReason?.({
        provider: "nanogpt",
        modelId: "moonshotai/kimi-k2.5:thinking",
        errorMessage,
      }),
    ).toBe("rate_limit");

    expect(
      provider.classifyFailoverReason?.({
        provider: "nanogpt",
        modelId: "moonshotai/kimi-k2.5:thinking",
        errorMessage,
      }),
    ).toBe("rate_limit");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("classified as rate_limit"));
  });

  it("warns and falls through when NanoGPT returns a recognized but unmapped error code", () => {
    const { provider, warn } = getRegisteredProviderHarness();
    expect(provider.classifyFailoverReason).toEqual(expect.any(Function));

    expect(
      provider.classifyFailoverReason?.({
        provider: "nanogpt",
        modelId: "moonshotai/kimi-k2.5:thinking",
        errorMessage: JSON.stringify({
          error: {
            message: "Every configured fallback failed",
            type: "server_error",
            code: "all_fallbacks_failed",
          },
          status: 409,
        }),
      }),
    ).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("recognized but not mapped"));
  });

  it("warns and falls through when NanoGPT returns an unknown structured error envelope", () => {
    const { provider, warn } = getRegisteredProviderHarness();
    expect(provider.classifyFailoverReason).toEqual(expect.any(Function));

    expect(
      provider.classifyFailoverReason?.({
        provider: "nanogpt",
        modelId: "moonshotai/kimi-k2.5:thinking",
        errorMessage: JSON.stringify({
          error: {
            detail: "surprising payload",
          },
          status: 418,
        }),
      }),
    ).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Unknown NanoGPT API error envelope"));
  });

  it("routes NanoGPT context length errors through the context overflow hook", () => {
    const { provider, warn } = getRegisteredProviderHarness();
    expect(provider.matchesContextOverflowError).toEqual(expect.any(Function));
    expect(provider.classifyFailoverReason).toEqual(expect.any(Function));

    const errorMessage = JSON.stringify({
      error: {
        message: "Context length exceeded",
        type: "invalid_request_error",
        code: "context_length_exceeded",
      },
      status: 400,
    });

    expect(
      provider.matchesContextOverflowError?.({
        provider: "nanogpt",
        modelId: "moonshotai/kimi-k2.5:thinking",
        errorMessage,
      }),
    ).toBe(true);

    expect(
      provider.classifyFailoverReason?.({
        provider: "nanogpt",
        modelId: "moonshotai/kimi-k2.5:thinking",
        errorMessage,
      }),
    ).toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("context overflow handling"));
  });
});
