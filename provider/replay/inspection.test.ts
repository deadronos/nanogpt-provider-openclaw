import { describe, expect, it } from "vitest";
import {
  collectNanoGptReplayAssistantInspection,
  collectNanoGptReplayToolResultInspection,
  resolveNanoGptReplayTransportApi,
  isNanoGptTaggedReasoningOutputMode,
} from "./inspection.js";

describe("replay inspection", () => {
  describe("collectNanoGptReplayAssistantInspection", () => {
    it("returns null for non-assistant messages", () => {
      expect(collectNanoGptReplayAssistantInspection(null)).toBeNull();
      expect(collectNanoGptReplayAssistantInspection({})).toBeNull();
      expect(collectNanoGptReplayAssistantInspection({ role: "user" })).toBeNull();
      expect(
        collectNanoGptReplayAssistantInspection({ role: "assistant", content: "not an array" }),
      ).toBeNull();
    });

    it("inspects a valid assistant message with mixed content", () => {
      const message = {
        role: "assistant",
        content: [
          { type: "text", text: "Hello " },
          { type: "thinking" },
          { type: "text", text: "world!" },
          { type: "toolCall", id: "call_1", name: "test_tool" },
        ],
      };

      const result = collectNanoGptReplayAssistantInspection(message);
      expect(result).not.toBeNull();
      expect(result?.visibleText).toBe("Hello world!");
      expect(result?.visibleTextLength).toBe("Hello world!".length);
      expect(result?.textBlockCount).toBe(2);
      expect(result?.thinkingBlockCount).toBe(1);
      expect(result?.toolCallCount).toBe(1);
      expect(result?.toolCalls).toEqual([{ id: "call_1", name: "test_tool", missingId: false }]);
      expect(result?.toolCallNames).toEqual(["test_tool"]);
    });

    it("normalizes visibleTextLength with extra whitespace", () => {
      const message = {
        role: "assistant",
        content: [{ type: "text", text: "  Hello   \n  world  " }],
      };

      const result = collectNanoGptReplayAssistantInspection(message);
      expect(result?.visibleText).toBe("  Hello   \n  world  ");
      // "Hello world" length is 11
      expect(result?.visibleTextLength).toBe(11);
    });

    it("handles missing and duplicate tool call IDs", () => {
      const message = {
        role: "assistant",
        content: [
          { type: "toolCall", id: "", name: "tool1" },
          { type: "toolCall", id: "  ", name: "tool2" },
          { type: "toolCall", id: "dup", name: "tool3" },
          { type: "toolCall", id: "dup", name: "tool4" },
          { type: "toolCall", id: "unique", name: "tool5" },
        ],
      };

      const result = collectNanoGptReplayAssistantInspection(message);
      expect(result?.toolCallCount).toBe(5);
      expect(result?.missingToolCallIdCount).toBe(2);
      expect(result?.duplicateToolCallIdCount).toBe(1);
      expect(result?.toolCalls[0].missingId).toBe(true);
      expect(result?.toolCalls[1].missingId).toBe(true);
      expect(result?.toolCalls[2].missingId).toBe(false);
    });

    it("integrates with stream markers (reasoning tags)", () => {
      const message = {
        role: "assistant",
        content: [{ type: "text", text: "<thinking>I should search</thinking>Searching..." }],
      };

      const result = collectNanoGptReplayAssistantInspection(message);
      expect(result?.reasoningMarkerNames).toContain("<thinking>");
      expect(result?.reasoningMarkerNames).toContain("</thinking>");
      expect(result?.reasoningIsUnbalanced).toBe(false);
    });

    it("handles unbalanced reasoning markers", () => {
      const message = {
        role: "assistant",
        content: [{ type: "text", text: "<thinking>Incomplete" }],
      };

      const result = collectNanoGptReplayAssistantInspection(message);
      expect(result?.reasoningIsUnbalanced).toBe(true);
    });

    it("ignores invalid content blocks", () => {
      const message = {
        role: "assistant",
        content: [null, { type: 123 }, { type: "unknown" }, { type: "text", text: "valid" }],
      };
      const result = collectNanoGptReplayAssistantInspection(message);
      expect(result?.textBlockCount).toBe(1);
    });
  });

  describe("collectNanoGptReplayToolResultInspection", () => {
    it("returns null for non-toolResult messages", () => {
      expect(collectNanoGptReplayToolResultInspection(null)).toBeNull();
      expect(collectNanoGptReplayToolResultInspection({ role: "assistant" })).toBeNull();
    });

    it("inspects a valid tool result message", () => {
      const message = {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "test_tool",
      };

      const result = collectNanoGptReplayToolResultInspection(message);
      expect(result).toEqual({
        toolCallId: "call_1",
        toolName: "test_tool",
        missingToolCallId: false,
        missingToolName: false,
      });
    });

    it("handles missing toolCallId or toolName", () => {
      const message = {
        role: "toolResult",
      };

      const result = collectNanoGptReplayToolResultInspection(message);
      expect(result?.missingToolCallId).toBe(true);
      expect(result?.missingToolName).toBe(true);
    });

    it("trims toolCallId and toolName", () => {
      const message = {
        role: "toolResult",
        toolCallId: "  call_1  ",
        toolName: "  test_tool  ",
      };

      const result = collectNanoGptReplayToolResultInspection(message);
      expect(result?.toolCallId).toBe("call_1");
      expect(result?.toolName).toBe("test_tool");
    });
  });

  describe("resolveNanoGptReplayTransportApi", () => {
    it("resolves from context.modelApi", () => {
      expect(resolveNanoGptReplayTransportApi({ modelApi: "openai" })).toBe("openai");
    });

    it("resolves from context.model.api", () => {
      expect(resolveNanoGptReplayTransportApi({ model: { api: "anthropic" } })).toBe("anthropic");
    });

    it("prefers context.modelApi over context.model.api", () => {
      expect(
        resolveNanoGptReplayTransportApi({ modelApi: "openai", model: { api: "anthropic" } }),
      ).toBe("openai");
    });

    it("returns undefined if no api found or invalid", () => {
      expect(resolveNanoGptReplayTransportApi({})).toBeUndefined();
      expect(resolveNanoGptReplayTransportApi({ modelApi: 123 })).toBeUndefined();
      expect(resolveNanoGptReplayTransportApi({ modelApi: "  " })).toBeUndefined();
    });
  });

  describe("isNanoGptTaggedReasoningOutputMode", () => {
    it("returns true if requiresThinkingAsText is true", () => {
      expect(
        isNanoGptTaggedReasoningOutputMode({ model: { compat: { requiresThinkingAsText: true } } }),
      ).toBe(true);
    });

    it("returns false otherwise", () => {
      expect(isNanoGptTaggedReasoningOutputMode({})).toBe(false);
      expect(isNanoGptTaggedReasoningOutputMode({ model: {} })).toBe(false);
      expect(
        isNanoGptTaggedReasoningOutputMode({
          model: { compat: { requiresThinkingAsText: false } },
        }),
      ).toBe(false);
    });
  });
});
