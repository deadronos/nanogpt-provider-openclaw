import { describe, expect, it } from "vitest";
import {
  formatNanoGptErrorSurfaceDetails,
  inspectNanoGptErrorSurface,
} from "./nanogpt-errors.js";

describe("inspectNanoGptErrorSurface", () => {
  it("maps structured NanoGPT rate limit errors to OpenClaw rate_limit", () => {
    expect(
      inspectNanoGptErrorSurface(
        JSON.stringify({
          error: {
            message: "Daily request limit exceeded",
            type: "rate_limit_error",
            code: "daily_rpd_limit_exceeded",
          },
          status: 429,
        }),
      ),
    ).toEqual({
      kind: "mapped",
      reason: "rate_limit",
      error: expect.objectContaining({
        envelope: "openai",
        status: 429,
        type: "rate_limit_error",
        code: "daily_rpd_limit_exceeded",
      }),
    });
  });

  it("maps legacy NanoGPT balance errors to OpenClaw billing", () => {
    expect(
      inspectNanoGptErrorSurface(
        JSON.stringify({
          error: "Insufficient balance",
          status: 402,
        }),
      ),
    ).toEqual({
      kind: "mapped",
      reason: "billing",
      error: expect.objectContaining({
        envelope: "legacy",
        status: 402,
        message: "Insufficient balance",
      }),
    });
  });

  it("maps structured NanoGPT content policy errors to OpenClaw format", () => {
    expect(
      inspectNanoGptErrorSurface(
        JSON.stringify({
          error: {
            message: "Blocked by content policy",
            type: "invalid_request_error",
            code: "content_policy_violation",
          },
          status: 400,
        }),
      ),
    ).toEqual({
      kind: "mapped",
      reason: "format",
      error: expect.objectContaining({
        envelope: "openai",
        status: 400,
        code: "content_policy_violation",
      }),
    });
  });

  it("maps structured NanoGPT context errors to context overflow handling", () => {
    expect(
      inspectNanoGptErrorSurface(
        JSON.stringify({
          error: {
            message: "Context length exceeded",
            type: "invalid_request_error",
            code: "context_length_exceeded",
            param: "messages",
          },
          status: 400,
        }),
      ),
    ).toEqual({
      kind: "context_overflow",
      error: expect.objectContaining({
        envelope: "openai",
        status: 400,
        code: "context_length_exceeded",
        param: "messages",
      }),
    });
  });

  it("maps model access rejections to OpenClaw model_not_found", () => {
    expect(
      inspectNanoGptErrorSurface(
        JSON.stringify({
          error: {
            message: "Model is not allowed for this account",
            type: "permission_error",
            code: "model_not_allowed",
          },
          status: 403,
        }),
      ),
    ).toEqual({
      kind: "mapped",
      reason: "model_not_found",
      error: expect.objectContaining({
        envelope: "openai",
        status: 403,
        type: "permission_error",
        code: "model_not_allowed",
      }),
    });
  });

  it("falls through recognized but unmapped NanoGPT error codes", () => {
    expect(
      inspectNanoGptErrorSurface(
        JSON.stringify({
          error: {
            message: "Every configured fallback failed",
            type: "server_error",
            code: "all_fallbacks_failed",
          },
          status: 409,
        }),
      ),
    ).toEqual({
      kind: "recognized_unmapped",
      error: expect.objectContaining({
        envelope: "openai",
        status: 409,
        type: "server_error",
        code: "all_fallbacks_failed",
      }),
    });
  });

  it("flags unknown structured NanoGPT-like responses for warning fallthrough", () => {
    expect(
      inspectNanoGptErrorSurface(
        JSON.stringify({
          error: {
            detail: "surprising payload",
          },
          status: 418,
        }),
      ),
    ).toEqual({
      kind: "unknown_structured",
      error: expect.objectContaining({
        envelope: "unknown_structured",
        status: 418,
        jsonKeys: ["error", "status"],
      }),
    });
  });
});

describe("formatNanoGptErrorSurfaceDetails", () => {
  it("renders structured detail fields compactly", () => {
    expect(
      formatNanoGptErrorSurfaceDetails({
        envelope: "openai",
        status: 429,
        type: "rate_limit_error",
        code: "daily_rpd_limit_exceeded",
        param: "model",
        retryAfterSeconds: 3600,
      }),
    ).toBe(
      "envelope=openai, status=429, type=rate_limit_error, code=daily_rpd_limit_exceeded, param=model, retryAfter=3600s",
    );
  });
});
