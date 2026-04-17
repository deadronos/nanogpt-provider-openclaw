import { describe, it, expect, vi } from "vitest";
import {
  shouldRepairNanoGptToolCallArguments,
  wrapStreamWithMalformedToolCallGuard,
  wrapStreamWithToolCallRepair,
} from "./repair.js";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";

const DEFAULT_USAGE = {
  input: 0,
  output: 0,
  totalTokens: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function createAssistantMessage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    role: "assistant",
    content: [],
    api: "openai-completions",
    provider: "nanogpt",
    model: "test-model",
    usage: { ...DEFAULT_USAGE, cost: { ...DEFAULT_USAGE.cost } },
    stopReason: "stop",
    timestamp: Date.now(),
    ...overrides,
  } as any;
}

describe("shouldRepairNanoGptToolCallArguments", () => {
  it("only enables repair for Kimi-style NanoGPT model ids", () => {
    expect(shouldRepairNanoGptToolCallArguments("moonshotai/kimi-k2.5")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("moonshotai/kimi-k2.5:thinking")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("nanogpt/moonshotai/kimi-k2.5:thinking")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("zai-org/glm-5:thinking")).toBe(false);
    expect(shouldRepairNanoGptToolCallArguments("nanogpt/zai-org/glm-5:thinking")).toBe(false);
    expect(shouldRepairNanoGptToolCallArguments("mistralai/mistral-large-3-675b-instruct-2512")).toBe(false);
    expect(shouldRepairNanoGptToolCallArguments(undefined)).toBe(false);
  });
});

describe("wrapStreamWithToolCallRepair", () => {
  it("should repair malformed tool call arguments", async () => {
    const mockEvents: AssistantMessageEvent[] = [
      {
        type: "start",
        partial: { 
          role: "assistant", 
          content: [], 
          usage: { input: 0, output: 0, totalTokens: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
          api: "openai-completions",
          provider: "nanogpt",
          model: "test-model",
          timestamp: Date.now(),
          stopReason: "stop"
        } as any
      },
      {
        type: "toolcall_start",
        contentIndex: 0,
        partial: {} as any
      },
      {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"location": "Tok',
        partial: {} as any
      },
      {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call_123",
          name: "get_weather",
          arguments: {} // Transport failed to parse
        },
        partial: {
            content: [
                {
                    type: "toolCall",
                    id: "call_123",
                    name: "get_weather",
                    arguments: {}
                }
            ]
        } as any
      },
      {
        type: "done",
        reason: "toolUse",
        message: {
            content: [
                {
                    type: "toolCall",
                    id: "call_123",
                    name: "get_weather",
                    arguments: {}
                }
            ]
        } as any
      }
    ];

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      for (const event of mockEvents) {
        yield event;
      }
    })());

    const logger = {
      warn: vi.fn(),
      info: vi.fn(),
    };

    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped({ id: "test-model" } as any, {} as any, {} as any);

    const receivedEvents: AssistantMessageEvent[] = [];
    for await (const event of resultStream) {
      receivedEvents.push(event);
    }

    const toolEndEvent = receivedEvents.find(e => e.type === "toolcall_end") as any;
    expect(toolEndEvent).toBeDefined();
    expect(toolEndEvent.toolCall.arguments).toEqual({ location: "Tok" }); 
    // jsonrepair will turn {"location": "Tok into {"location": "Tok"}

    const doneEvent = receivedEvents.find(e => e.type === "done") as any;
    expect(doneEvent.message.content[0].arguments).toEqual({ location: "Tok" });

    expect(logger.warn).toHaveBeenCalled();
  });

  it("should repair markdown-wrapped JSON in tool call arguments", async () => {
    const mockEvents: AssistantMessageEvent[] = [
      {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '```json\n{"location": "Paris"}', // truncated and wrapped
        partial: {} as any
      },
      {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call_456",
          name: "get_weather",
          arguments: {}
        },
        partial: {} as any
      }
    ];

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      for (const event of mockEvents) {
        yield event;
      }
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped({ id: "test-model" } as any, {} as any, {} as any);

    const receivedEvents: AssistantMessageEvent[] = [];
    for await (const event of resultStream) {
      receivedEvents.push(event);
    }

    const toolEndEvent = receivedEvents.find(e => e.type === "toolcall_end") as any;
    expect(toolEndEvent.toolCall.arguments).toEqual({ location: "Paris" });
    expect(logger.warn).toHaveBeenCalled();
  });

  it("preserves bind-compatible stream methods for downstream wrappers", async () => {
    const mockEvents: AssistantMessageEvent[] = [
      {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"location":"Berlin',
        partial: {} as any,
      },
      {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call_789",
          name: "get_weather",
          arguments: {},
        },
        partial: {
          content: [
            {
              type: "toolCall",
              id: "call_789",
              name: "get_weather",
              arguments: {},
            },
          ],
        } as any,
      },
      {
        type: "done",
        reason: "toolUse",
        message: {
          content: [
            {
              type: "toolCall",
              id: "call_789",
              name: "get_weather",
              arguments: {},
            },
          ],
        } as any,
      },
    ];

    const originalStream = {
      async result() {
        return {
          content: [
            {
              type: "toolCall",
              id: "call_789",
              name: "get_weather",
              arguments: {},
            },
          ],
        } as any;
      },
      [Symbol.asyncIterator]() {
        let index = 0;
        return {
          next: async () => {
            if (index >= mockEvents.length) {
              return { done: true as const, value: undefined };
            }
            const value = mockEvents[index++];
            return { done: false as const, value };
          },
          async return(value?: unknown) {
            return { done: true as const, value };
          },
          async throw(error?: unknown) {
            throw error;
          },
          [Symbol.asyncIterator]() {
            return this;
          },
        };
      },
    };

    const mockStreamFn = vi.fn().mockResolvedValue(originalStream);
    const logger = { warn: vi.fn(), info: vi.fn() };

    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const wrappedStream = await wrapped({ id: "test-model" } as any, {} as any, {} as any);

    expect(typeof (wrappedStream as any).result).toBe("function");
    expect(typeof (wrappedStream as any)[Symbol.asyncIterator]).toBe("function");

    const boundResult = (wrappedStream as any).result.bind(wrappedStream);
    const boundAsyncIterator = (wrappedStream as any)[Symbol.asyncIterator].bind(wrappedStream);

    const iterator = boundAsyncIterator();
    const receivedEvents: AssistantMessageEvent[] = [];
    for await (const event of iterator as AsyncIterable<AssistantMessageEvent>) {
      receivedEvents.push(event);
    }

    const repairedEndEvent = receivedEvents.find((event) => event.type === "toolcall_end") as any;
    expect(repairedEndEvent.toolCall.arguments).toEqual({ location: "Berlin" });

    const resultMessage = await boundResult();
    expect(resultMessage.content[0].arguments).toEqual({ location: "Berlin" });
  });

  it("salvages fenced structured tool payloads from assistant text", async () => {
    const toolPayload = [
      "Sure — retrying with a structured payload.",
      "```json",
      JSON.stringify({
        tool_calls: [
          {
            name: "get_weather",
            arguments: {
              location: "Paris",
            },
          },
        ],
      }),
      "```",
    ].join("\n");

    const mockEvents: AssistantMessageEvent[] = [
      {
        type: "start",
        partial: createAssistantMessage(),
      },
      {
        type: "text_start",
        contentIndex: 0,
        partial: createAssistantMessage({
          content: [{ type: "text", text: "" }],
        }),
      },
      {
        type: "text_delta",
        contentIndex: 0,
        delta: toolPayload,
        partial: createAssistantMessage({
          content: [{ type: "text", text: toolPayload }],
        }),
      },
      {
        type: "text_end",
        contentIndex: 0,
        content: toolPayload,
        partial: createAssistantMessage({
          content: [{ type: "text", text: toolPayload }],
        }),
      },
      {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          content: [{ type: "text", text: toolPayload }],
        }),
      },
    ];

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      for (const event of mockEvents) {
        yield event;
      }
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "moonshotai/kimi-k2.5", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "get_weather",
            description: "Weather lookup",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const receivedEvents: AssistantMessageEvent[] = [];
    for await (const event of resultStream) {
      receivedEvents.push(event);
    }

    const toolEndEvent = receivedEvents.find((event) => event.type === "toolcall_end") as any;
    expect(toolEndEvent.toolCall.name).toBe("get_weather");
    expect(toolEndEvent.toolCall.arguments).toEqual({ location: "Paris" });

    const doneEvent = receivedEvents.find((event) => event.type === "done") as any;
    expect(doneEvent.reason).toBe("toolUse");
    expect(doneEvent.message.content).toEqual([
      {
        type: "toolCall",
        id: "call_salvaged_1",
        name: "get_weather",
        arguments: { location: "Paris" },
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Salvaged structured tool payload"),
    );
  });

  it("salvages pseudo-tool wrapper payloads from assistant text", async () => {
    const toolPayload = [
      '<use_tool name="browser">',
      JSON.stringify({
        query: "NanoGPT",
        url: "https://example.com/search",
      }),
      "</use_tool>",
    ].join("");

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "moonshotai/kimi-k2.5", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "browser",
            description: "Browser navigation tool",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const receivedEvents: AssistantMessageEvent[] = [];
    for await (const event of resultStream) {
      receivedEvents.push(event);
    }

    const toolEndEvent = receivedEvents.find((event) => event.type === "toolcall_end") as any;
    expect(toolEndEvent.toolCall.name).toBe("browser");
    expect(toolEndEvent.toolCall.arguments).toEqual({
      query: "NanoGPT",
      url: "https://example.com/search",
    });

    const doneEvent = receivedEvents.find((event) => event.type === "done") as any;
    expect(doneEvent.reason).toBe("toolUse");
    expect(doneEvent.message.content).toEqual([
      {
        type: "toolCall",
        id: "call_salvaged_1",
        name: "browser",
        arguments: {
          query: "NanoGPT",
          url: "https://example.com/search",
        },
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Salvaged structured tool payload"),
    );
  });

  it("salvages flattened tool arguments from assistant text", async () => {
    const toolPayload = JSON.stringify({
      tool_calls: [
        {
          name: "bash",
          command: "mkdir -p src tests",
          description: "Create folders",
        },
      ],
    });

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "moonshotai/kimi-k2.5", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "bash",
            description: "Run a shell command",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content[0]).toEqual({
      type: "toolCall",
      id: "call_salvaged_1",
      name: "bash",
      arguments: {
        command: "mkdir -p src tests",
        description: "Create folders",
      },
    });
  });

  it("retries one empty tool-enabled turn once and appends a retry prompt", async () => {
    const emptyAttempt = (async function* () {
      yield {
        type: "start",
        partial: createAssistantMessage(),
      } satisfies AssistantMessageEvent;
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage(),
      } satisfies AssistantMessageEvent;
    })();

    const successfulAttempt = (async function* () {
      yield {
        type: "start",
        partial: createAssistantMessage(),
      } satisfies AssistantMessageEvent;
      yield {
        type: "toolcall_start",
        contentIndex: 0,
        partial: createAssistantMessage({
          content: [{ type: "toolCall", id: "call_retry", name: "get_weather", arguments: {} }],
        }),
      } satisfies AssistantMessageEvent;
      yield {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"location":"Berlin"}',
        partial: createAssistantMessage({
          content: [
            {
              type: "toolCall",
              id: "call_retry",
              name: "get_weather",
              arguments: { location: "Berlin" },
            },
          ],
        }),
      } satisfies AssistantMessageEvent;
      yield {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call_retry",
          name: "get_weather",
          arguments: { location: "Berlin" },
        },
        partial: createAssistantMessage({
          content: [
            {
              type: "toolCall",
              id: "call_retry",
              name: "get_weather",
              arguments: { location: "Berlin" },
            },
          ],
        }),
      } satisfies AssistantMessageEvent;
      yield {
        type: "done",
        reason: "toolUse",
        message: createAssistantMessage({
          content: [
            {
              type: "toolCall",
              id: "call_retry",
              name: "get_weather",
              arguments: { location: "Berlin" },
            },
          ],
          stopReason: "toolUse",
        }),
      } satisfies AssistantMessageEvent;
    })();

    const mockStreamFn = vi
      .fn()
      .mockResolvedValueOnce(emptyAttempt)
      .mockResolvedValueOnce(successfulAttempt);

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "moonshotai/kimi-k2.5", api: "openai-completions" } as any,
      {
        systemPrompt: "Use tools when needed.",
        messages: [],
        tools: [
          {
            name: "get_weather",
            description: "Weather lookup",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    expect(mockStreamFn).toHaveBeenCalledTimes(2);
    expect(mockStreamFn.mock.calls[1]?.[1]?.systemPrompt).toContain(
      "previous response was invalid because it produced no visible content or tool call",
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content[0].arguments).toEqual({ location: "Berlin" });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Retrying empty tool-enabled turn"),
    );
  });

  it("emits structured debug artifacts when debug mode is enabled", async () => {
    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"location":"Mad',
        partial: createAssistantMessage({
          content: [{ type: "toolCall", id: "call_debug", name: "get_weather", arguments: {} }],
        }),
      } satisfies AssistantMessageEvent;
      yield {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call_debug",
          name: "get_weather",
          arguments: {},
        },
        partial: createAssistantMessage({
          content: [{ type: "toolCall", id: "call_debug", name: "get_weather", arguments: {} }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger, { debug: true });
    const resultStream = await wrapped(
      { id: "moonshotai/kimi-k2.5", api: "openai-completions" } as any,
      { messages: [], tools: [] } as any,
      {} as any,
    );

    for await (const _event of resultStream) {
      // Exhaust stream
    }

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"repair_success"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"repairStage":"toolcall_end"'),
    );
  });
});

describe("wrapStreamWithMalformedToolCallGuard", () => {
  it("logs malformed tool-call arguments for non-Kimi models without mutating them", async () => {
    const mockEvents: AssistantMessageEvent[] = [
      {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"location":"Mad',
        partial: createAssistantMessage({
          content: [{ type: "toolCall", id: "call_guard", name: "get_weather", arguments: {} }],
        }),
      },
      {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call_guard",
          name: "get_weather",
          arguments: {},
        },
        partial: createAssistantMessage({
          content: [{ type: "toolCall", id: "call_guard", name: "get_weather", arguments: {} }],
        }),
      },
      {
        type: "done",
        reason: "toolUse",
        message: createAssistantMessage({
          content: [{ type: "toolCall", id: "call_guard", name: "get_weather", arguments: {} }],
          stopReason: "toolUse",
        }),
      },
    ];

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      for (const event of mockEvents) {
        yield event;
      }
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithMalformedToolCallGuard(mockStreamFn as any, logger, {
      debug: true,
    });
    const resultStream = await wrapped(
      { id: "mistralai/mistral-large-3-675b-instruct-2512", api: "openai-completions" } as any,
      { messages: [], tools: [] } as any,
      {} as any,
    );

    const receivedEvents: AssistantMessageEvent[] = [];
    for await (const event of resultStream) {
      receivedEvents.push(event);
    }

    const toolEndEvent = receivedEvents.find((event) => event.type === "toolcall_end") as any;
    expect(toolEndEvent.toolCall.arguments).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Observed malformed tool call arguments from model mistralai/mistral-large-3-675b-instruct-2512"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"malformed_tool_call_observed"'),
    );
  });
});
