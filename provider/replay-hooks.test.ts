import type { AssistantMessage, ToolResultMessage } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { buildReplayPolicy, createNanoGptReplayHooks, resolveReasoningOutputMode } from "./replay-hooks.js";

const MODEL_ID = "moonshotai/kimi-k2.5:thinking";

function buildUsage(): AssistantMessage["usage"] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function buildAssistantMessage(params: {
  content: AssistantMessage["content"];
  timestamp?: number;
}): AssistantMessage {
  return {
    role: "assistant",
    content: params.content,
    api: "openai-completions",
    provider: "nanogpt",
    model: MODEL_ID,
    usage: buildUsage(),
    stopReason: "stop",
    timestamp: params.timestamp ?? Date.now(),
  };
}

function buildToolResultMessage(params: {
  toolCallId?: string;
  toolName?: string;
  timestamp?: number;
}): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: params.toolCallId ?? "",
    toolName: params.toolName ?? "",
    content: [{ type: "text", text: "done" }],
    isError: false,
    timestamp: params.timestamp ?? Date.now(),
  };
}

function extractWarnMessages(warn: ReturnType<typeof vi.fn>): string[] {
  return warn.mock.calls.map(([message]) => String(message));
}

function createReplayHooks() {
  const warn = vi.fn();
  return {
    warn,
    ...createNanoGptReplayHooks({ logger: { warn } }),
  };
}

describe("nanoGPT replay hooks", () => {
  it("builds the OpenAI-compatible replay policy and resolves tagged reasoning only when the compat flag is set", () => {
    expect(
      buildReplayPolicy({
        provider: "nanogpt",
        modelId: MODEL_ID,
        modelApi: "openai-completions",
      } as any),
    ).toMatchObject({
      sanitizeToolCallIds: true,
      toolCallIdMode: "strict",
      applyAssistantFirstOrderingFix: true,
      validateGeminiTurns: true,
      validateAnthropicTurns: true,
    });

    expect(
      buildReplayPolicy({
        provider: "nanogpt",
        modelId: MODEL_ID,
        modelApi: "openai-responses",
      } as any),
    ).toMatchObject({
      sanitizeToolCallIds: true,
      toolCallIdMode: "strict",
      applyAssistantFirstOrderingFix: false,
      validateGeminiTurns: false,
      validateAnthropicTurns: false,
    });

    expect(
      resolveReasoningOutputMode({
        provider: "nanogpt",
        modelId: MODEL_ID,
        modelApi: "openai-completions",
        model: {
          id: MODEL_ID,
          name: MODEL_ID,
          api: "openai-completions",
          provider: "nanogpt",
          baseUrl: "https://nano-gpt.com/api/v1",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 32768,
          compat: { requiresThinkingAsText: true },
        } as any,
      } as any),
    ).toBe("tagged");

    expect(
      resolveReasoningOutputMode({
        provider: "nanogpt",
        modelId: MODEL_ID,
        modelApi: "openai-completions",
        model: {
          id: MODEL_ID,
          name: MODEL_ID,
          api: "openai-completions",
          provider: "nanogpt",
          baseUrl: "https://nano-gpt.com/api/v1",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 128000,
          maxTokens: 32768,
          compat: {},
        } as any,
      } as any),
    ).toBe("native");
  });

  it("warns on leaked reasoning tags and tool-like visible replay text without exposing raw payloads", () => {
    const { sanitizeReplayHistory, warn } = createReplayHooks();
    const userTimestamp = Date.now();
    const assistantTimestamp = userTimestamp + 1;
    const assistant = buildAssistantMessage({
      timestamp: assistantTimestamp,
      content: [
        {
          type: "text",
          text: "<thinking>plan</thinking> <tool_call>run</tool_call> <function=read>",
        },
      ],
    });
    const originalMessages = JSON.parse(JSON.stringify([
      {
        role: "user",
        content: "hello",
        timestamp: userTimestamp,
      },
      assistant,
    ])) as Array<Record<string, unknown>>;

    const context = {
      provider: "nanogpt",
      modelId: MODEL_ID,
      modelApi: "openai-completions",
      messages: [
        {
          role: "user",
          content: "hello",
          timestamp: userTimestamp,
        },
        assistant,
      ],
    };

    const result = sanitizeReplayHistory(context as any);

    expect(result).toBeUndefined();
    expect(context.messages).toEqual(originalMessages);

    const messages = extractWarnMessages(warn);
    expect(messages.some((message) => message.includes("replay_contains_reasoning_leak"))).toBe(true);
    expect(messages.some((message) => message.includes("replay_contains_tool_like_text"))).toBe(true);
    expect(messages.some((message) => message.includes(`model=${MODEL_ID}`))).toBe(true);
    expect(messages.some((message) => message.includes("family=kimi"))).toBe(true);
    expect(messages.some((message) => message.includes("plan"))).toBe(false);
    expect(messages.some((message) => message.includes("run"))).toBe(false);
    expect(messages.some((message) => message.includes("read"))).toBe(false);
  });

  it("warns when replay tool ordering and tool-call ids are inconsistent", () => {
    const { validateReplayTurns, warn } = createReplayHooks();
    const assistantTimestamp = Date.now();
    const toolResultTimestamp = assistantTimestamp + 1;
    const userTimestamp = assistantTimestamp + 2;
    const context = {
      provider: "nanogpt",
      modelId: MODEL_ID,
      modelApi: "openai-completions",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "call_1",
              name: "read",
              arguments: { path: "/tmp/secret.txt" },
            },
            {
              type: "toolCall",
              id: "",
              name: "search",
              arguments: { query: "hidden" },
            },
          ],
          api: "openai-completions",
          provider: "nanogpt",
          model: MODEL_ID,
          usage: buildUsage(),
          stopReason: "toolUse",
          timestamp: assistantTimestamp,
        } as AssistantMessage,
        buildToolResultMessage({
          toolCallId: "call_1",
          toolName: "write",
          timestamp: toolResultTimestamp,
        }),
        {
          role: "user",
          content: "interrupt",
          timestamp: userTimestamp,
        },
      ],
    };
    const originalMessages = JSON.parse(JSON.stringify(context.messages)) as Array<Record<string, unknown>>;

    const result = validateReplayTurns(context as any);

    expect(result).toBeUndefined();
    expect(context.messages).toEqual(originalMessages);

    const messages = extractWarnMessages(warn);
    expect(messages.some((message) => message.includes("replay_has_missing_tool_call_id"))).toBe(true);
    expect(messages.some((message) => message.includes("replay_has_invalid_tool_ordering"))).toBe(true);
    expect(messages.some((message) => message.includes("replay_has_inconsistent_assistant_tool_state"))).toBe(true);
    expect(messages.some((message) => message.includes("secret.txt"))).toBe(false);
    expect(messages.some((message) => message.includes("hidden"))).toBe(false);
    expect(messages.some((message) => message.includes("interrupt"))).toBe(false);
  });

  it("stays quiet for clean replay history", () => {
    const { sanitizeReplayHistory, validateReplayTurns, warn } = createReplayHooks();
    const userTimestamp = Date.now();
    const assistantTimestamp = userTimestamp + 1;
    const assistant = buildAssistantMessage({
      timestamp: assistantTimestamp,
      content: [{ type: "text", text: "All good here." }],
    });
    const sanitizeContext = {
      provider: "nanogpt",
      modelId: MODEL_ID,
      modelApi: "openai-completions",
      messages: [
        {
          role: "user",
          content: "hello",
          timestamp: userTimestamp,
        },
        assistant,
      ],
    };
    const validateContext = JSON.parse(JSON.stringify(sanitizeContext)) as typeof sanitizeContext;
    const sanitizeOriginalMessages = JSON.parse(JSON.stringify(sanitizeContext.messages)) as Array<Record<string, unknown>>;
    const validateOriginalMessages = JSON.parse(JSON.stringify(validateContext.messages)) as Array<Record<string, unknown>>;

    expect(
      sanitizeReplayHistory(sanitizeContext as any),
    ).toBeUndefined();

    expect(
      validateReplayTurns(validateContext as any),
    ).toBeUndefined();

    expect(sanitizeContext.messages).toEqual(sanitizeOriginalMessages);
    expect(validateContext.messages).toEqual(validateOriginalMessages);

    expect(warn).not.toHaveBeenCalled();
  });
});