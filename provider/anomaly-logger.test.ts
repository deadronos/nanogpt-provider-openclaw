import { describe, expect, it, vi } from "vitest";
import {
  buildNanoGptAnomalyWarnOnceSignature,
  createNanoGptWarnOnceLogger,
  summarizeNanoGptAnomalyMetadata,
  summarizeNanoGptFreeformMessage,
  summarizeNanoGptMarkerNames,
  summarizeNanoGptToolCount,
  summarizeNanoGptToolNames,
} from "./anomaly-logger.js";
import {
  buildNanoGptExpectedShapeSummary,
  buildNanoGptObservedShapeSummary,
} from "./anomaly-types.js";

describe("nanoGPT anomaly logger", () => {
  it("normalizes short freeform messages and safe name summaries", () => {
    expect(summarizeNanoGptFreeformMessage("  hello\nworld  ")).toBe("hello world");
    expect(summarizeNanoGptFreeformMessage(`${"a".repeat(205)}`)).toBe(`${"a".repeat(197)}...`);

    expect(summarizeNanoGptMarkerNames([" <thinking> ", "<thinking>", "", "<reasoning>"])).toBe(
      "markers=<thinking>,<reasoning>",
    );
    expect(summarizeNanoGptToolNames([" web_fetch ", "browser", "web_fetch"])).toBe(
      "toolNames=web_fetch,browser",
    );
    expect(summarizeNanoGptToolCount(2)).toBe("toolCount=2");
    expect(summarizeNanoGptToolCount(Number.NaN)).toBeUndefined();
  });

  it("summarizes anomaly metadata without exposing raw payloads", () => {
    expect(
      summarizeNanoGptAnomalyMetadata({
        markerNames: [" <thinking> ", "<thinking>"],
        toolNames: ["web_fetch", "web_fetch", "browser"],
        toolCount: 2,
        finishReason: " stop ",
        replayTurnIndexes: [3, 1, 3],
        replayRoles: ["assistant", "tool", "assistant"],
        notes: [" keep logs safe ", ""],
      }),
    ).toEqual([
      "markers=<thinking>",
      "toolNames=web_fetch,browser",
      "toolCount=2",
      "finishReason=stop",
      "replayTurns=3,1",
      "replayRoles=assistant,tool",
      "note=keep logs safe",
    ]);
  });

  it("builds stable warn-once signatures from anomaly payloads", () => {
    const anomaly = {
      kind: "tool_enabled_turn_without_tool_call" as const,
      stage: "stream_result" as const,
      providerId: "nanogpt",
      modelId: "moonshotai/kimi-k2.5:thinking",
      modelFamily: "kimi" as const,
      transportApi: "openai-completions",
      expectedShapeSummary: buildNanoGptExpectedShapeSummary({
        headline: "tool-enabled turn",
        counts: { toolCount: 1 },
        groups: [{ label: "toolNames", values: ["web_fetch"] }],
      }),
      observedShapeSummary: buildNanoGptObservedShapeSummary({
        headline: "assistant visible text",
        groups: [{ label: "markers", values: ["<thinking>"] }],
      }),
      metadata: {
        markerNames: ["<thinking>"],
        toolNames: ["web_fetch"],
        toolCount: 1,
      },
    };

    const signature = buildNanoGptAnomalyWarnOnceSignature(anomaly);
    expect(signature).toContain("tool_enabled_turn_without_tool_call");
    expect(signature).toContain("stream_result");
    expect(signature).toContain("markers=<thinking>");
    expect(signature).toContain("toolNames=web_fetch");
    expect(signature).toContain("toolCount=1");

    expect(
      buildNanoGptAnomalyWarnOnceSignature({
        ...anomaly,
        metadata: {
          ...anomaly.metadata,
          toolCount: 2,
        },
      }),
    ).not.toBe(signature);
  });

  it("warns only once for identical signatures even when the message text changes", () => {
    const warn = vi.fn();
    const logOnce = createNanoGptWarnOnceLogger({
      logger: { warn },
      buildSignature: (event: { id: string }) => event.id,
      formatMessage: (event: { id: string; message: string }) =>
        `event=${event.id}: ${summarizeNanoGptFreeformMessage(event.message)}`,
    });

    logOnce({ id: "same", message: "first" });
    logOnce({ id: "same", message: "second" });
    logOnce({ id: "different", message: "third" });

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenNthCalledWith(1, "event=same: first");
    expect(warn).toHaveBeenNthCalledWith(2, "event=different: third");
  });
});
