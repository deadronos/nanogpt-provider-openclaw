import { describe, expect, it } from "vitest";
import {
  buildNanoGptExpectedShapeSummary,
  buildNanoGptObservedShapeSummary,
  detectNanoGptModelFamily,
  resolveNanoGptModelIdentity,
  resolveNanoGptModelFamily,
  resolveNanoGptModelId,
} from "./anomaly-types.js";

describe("nanoGPT anomaly types", () => {
  it("resolves the exact model id from the resolved model first", () => {
    expect(
      resolveNanoGptModelId({
        modelId: "  fallback/model  ",
        model: {
          id: "  moonshotai/kimi-k2.5:thinking  ",
        },
      }),
    ).toBe("moonshotai/kimi-k2.5:thinking");

    expect(resolveNanoGptModelId({ modelId: "  fallback/model  " })).toBe("fallback/model");
    expect(resolveNanoGptModelId({})).toBe("");
  });

  it("resolves the shared NanoGPT model family taxonomy", () => {
    expect(resolveNanoGptModelFamily("moonshotai/kimi-k2.5:thinking")).toBe("kimi");
    expect(detectNanoGptModelFamily("zai-org/glm-4.6")).toBe("glm");
    expect(resolveNanoGptModelFamily("qwen/Qwen3.6-35B-A3B")).toBe("qwen");
    expect(resolveNanoGptModelFamily("openai/gpt-5.4-mini")).toBe("other");
  });

  it("resolves a shared NanoGPT model identity with the exact model id and family", () => {
    expect(
      resolveNanoGptModelIdentity({
        modelId: "  fallback/model  ",
        model: {
          id: "  moonshotai/kimi-k2.5:thinking  ",
        },
      }),
    ).toEqual({
      modelId: "moonshotai/kimi-k2.5:thinking",
      modelFamily: "kimi",
    });

    expect(resolveNanoGptModelIdentity({ modelId: "qwen/Qwen3.6-35B-A3B" })).toEqual({
      modelId: "qwen/Qwen3.6-35B-A3B",
      modelFamily: "qwen",
    });
  });

  it("builds normalized expected and observed shape summaries", () => {
    expect(
      buildNanoGptExpectedShapeSummary({
        headline: "  tool-enabled turn  ",
        counts: {
          toolCount: 2,
          visibleCount: 0,
        },
        groups: [
          { label: "toolNames", values: ["web_fetch", "exec", "web_fetch"] },
          { label: "markers", values: [" <thinking> ", ""] },
        ],
        notes: ["  keep logs safe  ", "keep logs safe"],
      }),
    ).toEqual({
      kind: "expected",
      headline: "tool-enabled turn",
      details: [
        "toolCount=2",
        "visibleCount=0",
        "toolNames=web_fetch,exec",
        "markers=<thinking>",
        "note=keep logs safe",
      ],
    });

    expect(
      buildNanoGptObservedShapeSummary({
        headline: "assistant replay turn",
        groups: [{ label: "roles", values: ["assistant", "tool", "assistant"] }],
      }),
    ).toEqual({
      kind: "observed",
      headline: "assistant replay turn",
      details: ["roles=assistant,tool"],
    });
  });
});