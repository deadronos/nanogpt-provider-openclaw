import { describe, it, expect, vi } from "vitest";
import {
  resolveNanoGptRepairProfile,
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

function createReplayableStream(
  events: AssistantMessageEvent[],
  finalMessage: unknown = createAssistantMessage(),
) {
  return {
    async result() {
      return finalMessage;
    },
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index >= events.length) {
            return { done: true as const, value: undefined };
          }
          const value = events[index];
          index += 1;
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
}

describe("resolveNanoGptRepairProfile", () => {
  it.each([
    [
      "moonshotai/kimi-k2.5:thinking",
      {
        family: "kimi",
        useBufferedRepair: true,
        useLiveGuard: true,
        useSemanticToolDiagnostics: false,
        useToolSchemaHints: false,
      },
    ],
    [
      "zai-org/glm-5:thinking",
      {
        family: "glm",
        useBufferedRepair: false,
        useLiveGuard: true,
        useSemanticToolDiagnostics: true,
        useToolSchemaHints: true,
      },
    ],
    [
      "nanogpt/qwen/Qwen3.6-35B-A3B",
      {
        family: "qwen",
        useBufferedRepair: true,
        useLiveGuard: true,
        useSemanticToolDiagnostics: false,
        useToolSchemaHints: true,
      },
    ],
    [
      "nanogpt/qwen/qwen3.5-397b-a17b-thinking",
      {
        family: "qwen",
        useBufferedRepair: true,
        useLiveGuard: true,
        useSemanticToolDiagnostics: false,
        useToolSchemaHints: true,
      },
    ],
    [
      "mistralai/mistral-large-3-675b-instruct-2512",
      {
        family: "other",
        useBufferedRepair: false,
        useLiveGuard: true,
        useSemanticToolDiagnostics: false,
        useToolSchemaHints: false,
      },
    ],
  ] as const)("resolves the expected profile for %s", (modelId, expected) => {
    expect(resolveNanoGptRepairProfile(modelId)).toEqual(expected);
  });
});

  describe("regex vulnerabilities", () => {
    it("does not exhibit ReDoS when extracting fenced blocks with unclosed backticks", () => {
      // The original `fencedBlockPattern` was `/```(?:json)?\s*([\s\S]*?)```/gi;`
      // The `\s*` combined with `[\s\S]*?` creates a catastrophic backtracking scenario
      // if the string ends without a closing ```
      const text = "```json\n" + " ".repeat(100000);

      const start = Date.now();

      // We will test by using a known function that invokes extractToolPayloadCandidates
      // which internally uses the vulnerable regex.
      // Easiest is to directly trigger wrapStreamWithToolCallRepair which parses tools.

      // To test without wiring up all the stream mock, we can just invoke it as:
      const meta = {
        modelId: "test-model",
        requestApi: "openai-completions",
        attempt: 0,
        debug: false,
      };

      const logger = { warn: vi.fn(), info: vi.fn() };
      const streamFn = async () => (async function* () {
        yield { type: "text_start", contentIndex: 0, partial: { role: "assistant", content: [], model: "test-model", provider: "nanogpt", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, totalTokens: 0 }, api: "openai-completions", timestamp: 0 } as any };
        yield { type: "text_delta", contentIndex: 0, delta: text, partial: {} as any };
        yield { type: "text_end", contentIndex: 0, content: text, partial: {} as any };
        yield { type: "done", reason: "stop", message: { role: "assistant", content: [{ type: "text", text }], model: "test-model", provider: "nanogpt", stopReason: "stop", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, totalTokens: 0 }, api: "openai-completions", timestamp: 0 } as any };
      })();

      const wrapped = wrapStreamWithToolCallRepair(streamFn as any, logger);

      return new Promise<void>((resolve, reject) => {
        const streamPromise = wrapped({ id: "nanogpt/moonshotai/kimi-chat" } as any, { tools: [{ type: "function", name: "test", description: "test", parameters: {} }] } as any);
        Promise.resolve(streamPromise)
          .then(async (stream) => {
            for await (const _ of stream) {}
            const duration = Date.now() - start;
            expect(duration).toBeLessThan(1000); // Should be very fast (< 1s), not hanging for seconds
            resolve();
          })
          .catch(reject);
      });
    });
  });

describe("shouldRepairNanoGptToolCallArguments", () => {
  it("enables buffered repair for Kimi and Qwen model ids", () => {
    expect(shouldRepairNanoGptToolCallArguments("moonshotai/kimi-k2.5")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("moonshotai/kimi-k2.5:thinking")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("nanogpt/moonshotai/kimi-k2.5:thinking")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("qwen/Qwen3.6-35B-A3B")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("nanogpt/qwen/Qwen3.6-35B-A3B")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("qwen/qwen3.5-397b-a17b-thinking")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("nanogpt/qwen/qwen3.5-397b-a17b-thinking")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("qwen/qwen3.5-397b-a17b")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("zai-org/glm-5:thinking")).toBe(false);
    expect(shouldRepairNanoGptToolCallArguments("nanogpt/zai-org/glm-5:thinking")).toBe(false);
    expect(shouldRepairNanoGptToolCallArguments("mistralai/mistral-large-3-675b-instruct-2512")).toBe(false);
    expect(shouldRepairNanoGptToolCallArguments(undefined)).toBe(false);
  });
});

describe("wrapStreamWithToolCallRepair", () => {
  it("uses the live guard path for Kimi models when no tools are enabled", async () => {
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

    const originalStream = createReplayableStream(
      mockEvents,
      createAssistantMessage({
        content: [{ type: "toolCall", id: "call_guard", name: "get_weather", arguments: {} }],
        stopReason: "toolUse",
      }),
    );

    const mockStreamFn = vi.fn().mockResolvedValue(originalStream);
    const logger = {
      warn: vi.fn(),
      info: vi.fn(),
    };

    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "moonshotai/kimi-k2.5:thinking", api: "openai-completions" } as any,
      { messages: [], tools: [] } as any,
      {} as any,
    );

    expect(resultStream).toBe(originalStream);

    const receivedEvents: AssistantMessageEvent[] = [];
    for await (const event of resultStream as AsyncIterable<AssistantMessageEvent>) {
      receivedEvents.push(event);
    }

    const toolEndEvent = receivedEvents.find((event) => event.type === "toolcall_end") as any;
    expect(toolEndEvent.toolCall.arguments).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining(
        "Observed malformed tool call arguments from model moonshotai/kimi-k2.5:thinking",
      ),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"kimi"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_kimi_malformed_tool_call_observed"'),
    );
  });

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
    const tools = [
      {
        name: "get_weather",
        description: "Weather lookup",
        parameters: { type: "object" },
      },
    ];

    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "moonshotai/kimi-k2.5:thinking", api: "openai-completions" } as any,
      { messages: [], tools } as any,
      {} as any,
    );

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
    const tools = [
      {
        name: "get_weather",
        description: "Weather lookup",
        parameters: { type: "object" },
      },
    ];
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "moonshotai/kimi-k2.5:thinking", api: "openai-completions" } as any,
      { messages: [], tools } as any,
      {} as any,
    );

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
    const tools = [
      {
        name: "get_weather",
        description: "Weather lookup",
        parameters: { type: "object" },
      },
    ];

    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const wrappedStream = await wrapped(
      { id: "moonshotai/kimi-k2.5:thinking", api: "openai-completions" } as any,
      { messages: [], tools } as any,
      {} as any,
    );

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
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"kimi"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_kimi_salvage_success"'),
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

  it("salvages XML-like function payload text for Qwen models", async () => {
    const toolPayload = [
      "<function=exec>",
      "<parameter=command>",
      "find /Users/openclaw/.openclaw/workspace-teleclaw -path \"*nanogpt*\" -type f 2>/dev/null",
      "</parameter>",
      "</execution>",
      "</tool_call>",
    ].join("\n");

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
      { id: "qwen/Qwen3.6-35B-A3B", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content).toEqual([
      {
        type: "toolCall",
        id: "call_salvaged_1",
        name: "exec",
        arguments: {
          command:
            "find /Users/openclaw/.openclaw/workspace-teleclaw -path \"*nanogpt*\" -type f 2>/dev/null",
        },
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Salvaged structured tool payload"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"qwen"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_qwen_salvage_success"'),
    );
  });

  it("salvages function-style tool payload text for Qwen models", async () => {
    const toolPayload = 'exec({"command":"pwd"})';

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B",
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
              },
              required: ["command"],
            },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content).toEqual([
      {
        type: "toolCall",
        id: "call_salvaged_1",
        name: "exec",
        arguments: {
          command: "pwd",
        },
      },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Salvaged structured tool payload"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"qwen"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_qwen_salvage_success"'),
    );
  });

  it("retries Qwen turns that only leak model special tokens", async () => {
    const firstAttemptMessage = createAssistantMessage({
      model: "qwen/Qwen3.6-35B-A3B:thinking",
      content: [{ type: "text", text: "\n\n<|mask_start|>Thinking<|mask_end|>" }],
    });
    const secondAttemptMessage = createAssistantMessage({
      model: "qwen/Qwen3.6-35B-A3B:thinking",
      content: [{ type: "text", text: "workspace files use 42 MB" }],
    });

    const mockStreamFn = vi
      .fn()
      .mockResolvedValueOnce(
        createReplayableStream(
          [{ type: "done", reason: "stop", message: firstAttemptMessage } as AssistantMessageEvent],
          firstAttemptMessage,
        ),
      )
      .mockResolvedValueOnce(
        createReplayableStream(
          [{ type: "done", reason: "stop", message: secondAttemptMessage } as AssistantMessageEvent],
          secondAttemptMessage,
        ),
      );

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B:thinking", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const resultMessage = await (resultStream as any).result();
    expect(mockStreamFn).toHaveBeenCalledTimes(2);
    expect(mockStreamFn.mock.calls[1]?.[2]).toMatchObject({ toolChoice: "required" });
    expect(resultMessage.content).toEqual([{ type: "text", text: "workspace files use 42 MB" }]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Retrying invalid tool-enabled turn from model qwen/Qwen3.6-35B-A3B:thinking"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"qwen"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_qwen_text_sanitized"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_qwen_retry_tool_choice_rewrite"'),
    );
  });

  it("retries Qwen turns that only leak a bare tool name", async () => {
    const firstAttemptMessage = createAssistantMessage({
      model: "qwen/Qwen3.6-35B-A3B:thinking",
      content: [{ type: "text", text: "\n\nexec" }],
    });
    const secondAttemptMessage = createAssistantMessage({
      model: "qwen/Qwen3.6-35B-A3B:thinking",
      content: [{ type: "text", text: "workspace files use 42 MB" }],
    });

    const mockStreamFn = vi
      .fn()
      .mockResolvedValueOnce(
        createReplayableStream(
          [{ type: "done", reason: "stop", message: firstAttemptMessage } as AssistantMessageEvent],
          firstAttemptMessage,
        ),
      )
      .mockResolvedValueOnce(
        createReplayableStream(
          [{ type: "done", reason: "stop", message: secondAttemptMessage } as AssistantMessageEvent],
          secondAttemptMessage,
        ),
      );

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B:thinking", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const resultMessage = await (resultStream as any).result();
    expect(mockStreamFn).toHaveBeenCalledTimes(2);
    expect(mockStreamFn.mock.calls[1]?.[2]).toMatchObject({ toolChoice: "required" });
    expect(resultMessage.content).toEqual([{ type: "text", text: "workspace files use 42 MB" }]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Retrying invalid tool-enabled turn from model qwen/Qwen3.6-35B-A3B:thinking"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"qwen"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_qwen_text_sanitized"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_qwen_retry_tool_choice_rewrite"'),
    );
  });

  it("retries Qwen turns that mix visible text with a broken trailing tool placeholder", async () => {
    const firstAttemptMessage = createAssistantMessage({
      model: "qwen/Qwen3.6-35B-A3B:thinking",
      content: [{ type: "text", text: "Let me check that.\n\nexec" }],
    });
    const secondAttemptMessage = createAssistantMessage({
      model: "qwen/Qwen3.6-35B-A3B:thinking",
      content: [{ type: "text", text: "workspace files use 42 MB" }],
    });

    const mockStreamFn = vi
      .fn()
      .mockResolvedValueOnce(
        createReplayableStream(
          [{ type: "done", reason: "stop", message: firstAttemptMessage } as AssistantMessageEvent],
          firstAttemptMessage,
        ),
      )
      .mockResolvedValueOnce(
        createReplayableStream(
          [{ type: "done", reason: "stop", message: secondAttemptMessage } as AssistantMessageEvent],
          secondAttemptMessage,
        ),
      );

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B:thinking", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const resultMessage = await (resultStream as any).result();
    expect(mockStreamFn).toHaveBeenCalledTimes(2);
    expect(mockStreamFn.mock.calls[1]?.[2]).toMatchObject({ toolChoice: "required" });
    expect(resultMessage.content).toEqual([{ type: "text", text: "workspace files use 42 MB" }]);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Retrying invalid tool-enabled turn from model qwen/Qwen3.6-35B-A3B:thinking"),
    );
  });

  it("drops bare tool-name placeholders when retry is disabled", async () => {
    const leakedMessage = createAssistantMessage({
      model: "qwen/Qwen3.6-35B-A3B:thinking",
      content: [{ type: "text", text: "\n\nexec" }],
    });

    const mockStreamFn = vi.fn().mockResolvedValue(
      createReplayableStream(
        [{ type: "done", reason: "stop", message: leakedMessage } as AssistantMessageEvent],
        leakedMessage,
      ),
    );

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger, {
      retryInvalidEmptyTurns: false,
    });
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B:thinking", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const resultMessage = await (resultStream as any).result();
    expect(resultMessage.content).toEqual([]);
  });

  it("drops trailing broken tool placeholders when retry is disabled", async () => {
    const leakedMessage = createAssistantMessage({
      model: "qwen/Qwen3.6-35B-A3B:thinking",
      content: [{ type: "text", text: "Let me check that.\n\nexec" }],
    });

    const mockStreamFn = vi.fn().mockResolvedValue(
      createReplayableStream(
        [{ type: "done", reason: "stop", message: leakedMessage } as AssistantMessageEvent],
        leakedMessage,
      ),
    );

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger, {
      retryInvalidEmptyTurns: false,
    });
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B:thinking", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const resultMessage = await (resultStream as any).result();
    expect(resultMessage.content).toEqual([{ type: "text", text: "Let me check that." }]);
  });

  it("normalizes stop reasons to toolUse when tool calls are present", async () => {
    const toolCallMessage = createAssistantMessage({
      model: "qwen/Qwen3.6-35B-A3B:thinking",
      content: [
        {
          type: "toolCall",
          id: "call_exec",
          name: "exec",
          arguments: { command: "pwd" },
        },
      ],
      stopReason: "stop",
    });

    const mockEvents: AssistantMessageEvent[] = [
      {
        type: "start",
        partial: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B:thinking",
          content: [],
        }),
      },
      {
        type: "toolcall_start",
        contentIndex: 0,
        partial: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B:thinking",
          content: [{ type: "toolCall", id: "call_exec", name: "exec", arguments: {} }],
        }),
      },
      {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"command":"pwd"}',
        partial: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B:thinking",
          content: [{ type: "toolCall", id: "call_exec", name: "exec", arguments: { command: "pwd" } }],
        }),
      },
      {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call_exec",
          name: "exec",
          arguments: { command: "pwd" },
        },
        partial: toolCallMessage,
      },
      {
        type: "done",
        reason: "stop",
        message: toolCallMessage,
      },
    ];

    const mockStreamFn = vi.fn().mockResolvedValue(createReplayableStream(mockEvents, toolCallMessage));
    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B:thinking", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
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

    const doneEvent = receivedEvents.find((event) => event.type === "done") as any;
    expect(doneEvent.reason).toBe("toolUse");
    expect(doneEvent.message.stopReason).toBe("toolUse");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"qwen"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_qwen_stop_reason_rewrite"'),
    );
  });

  it("salvages invoke-wrapper payload text for Qwen models", async () => {
    const toolPayload = [
      '<invoke name="invoke">',
      '<parameter name="name">exec</parameter>',
      '<parameter name="arguments">{"command":"pwd"}',
      "</invoke>",
    ].join("\n");

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B:thinking",
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B:thinking", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content).toEqual([
      {
        type: "toolCall",
        id: "call_salvaged_1",
        name: "exec",
        arguments: {
          command: "pwd",
        },
      },
    ]);
  });

  it("salvages malformed invoke parameter names for Qwen models", async () => {
    const toolPayload = [
      '<invoke name="read">',
      "<parameter name>path>/Users/openclaw/.openclaw/workspace-teleclaw/memory/2026-04-21.md</parameter>",
      "</invoke>",
    ].join("\n");

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B:thinking",
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B:thinking", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "read",
            description: "Read a file",
            parameters: { type: "object" },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content).toEqual([
      {
        type: "toolCall",
        id: "call_salvaged_1",
        name: "read",
        arguments: {
          path: "/Users/openclaw/.openclaw/workspace-teleclaw/memory/2026-04-21.md",
        },
      },
    ]);
  });

  it("salvages generic known-tool wrappers for Qwen models", async () => {
    const toolPayload =
      "<exec>du -sh /Users/openclaw/.openclaw/workspace-teleclaw /Users/openclaw/.openclaw/workspace-shared</exec>";

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B",
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
              },
              required: ["command"],
            },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content).toEqual([
      {
        type: "toolCall",
        id: "call_salvaged_1",
        name: "exec",
        arguments: {
          command:
            "du -sh /Users/openclaw/.openclaw/workspace-teleclaw /Users/openclaw/.openclaw/workspace-shared",
        },
      },
    ]);
  });

  it("rejects salvaged tool payloads whose tool names are not in the active inventory", async () => {
    const toolPayload = JSON.stringify({
      tool_calls: [
        {
          name: "not_a_real_tool",
          arguments: {
            command: "pwd",
          },
        },
      ],
    });

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B",
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger, {
      retryInvalidEmptyTurns: false,
    });
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
              },
              required: ["command"],
            },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("stop");
    expect(doneMessage.content).toEqual([]);
    expect(logger.warn).not.toHaveBeenCalledWith(
      expect.stringContaining("Salvaged structured tool payload"),
    );
  });

  it("rejects salvaged tool payloads that do not satisfy required schema fields", async () => {
    const toolPayload = JSON.stringify({
      tool_calls: [
        {
          name: "exec",
          arguments: {},
        },
      ],
    });

    const mockStreamFn = vi
      .fn()
      .mockResolvedValueOnce(
        createReplayableStream(
          [
            {
              type: "done",
              reason: "stop",
              message: createAssistantMessage({
                model: "qwen/Qwen3.6-35B-A3B",
                content: [{ type: "text", text: toolPayload }],
              }),
            } as AssistantMessageEvent,
          ],
          createAssistantMessage({
            model: "qwen/Qwen3.6-35B-A3B",
            content: [{ type: "text", text: toolPayload }],
          }),
        ),
      )
      .mockResolvedValueOnce(
        createReplayableStream(
          [
            {
              type: "done",
              reason: "stop",
              message: createAssistantMessage({
                model: "qwen/Qwen3.6-35B-A3B",
                content: [{ type: "text", text: "workspace files use 42 MB" }],
              }),
            } as AssistantMessageEvent,
          ],
          createAssistantMessage({
            model: "qwen/Qwen3.6-35B-A3B",
            content: [{ type: "text", text: "workspace files use 42 MB" }],
          }),
        ),
      );

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "exec",
            description: "Execute a shell command",
            parameters: {
              type: "object",
              properties: {
                command: { type: "string" },
              },
              required: ["command"],
            },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(mockStreamFn).toHaveBeenCalledTimes(2);
    expect(doneMessage.content).toEqual([{ type: "text", text: "workspace files use 42 MB" }]);
  });

  it("preserves the first matching tool when canonical names collide", async () => {
    const toolPayload = JSON.stringify({
      tool_calls: [
        {
          name: "browser",
          arguments: {
            url: "https://example.com/first",
          },
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
            name: "Browser",
            description: "First colliding tool",
            parameters: { type: "object" },
          },
          {
            name: "browser!",
            description: "Second colliding tool",
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
      name: "Browser",
      arguments: {
        url: "https://example.com/first",
      },
    });
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
      expect.stringContaining("Retrying invalid tool-enabled turn"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"kimi"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_kimi_retry_invalid_tool_turn"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_kimi_retry_result"'),
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
    const tools = [
      {
        name: "get_weather",
        description: "Weather lookup",
        parameters: { type: "object" },
      },
    ];
    const resultStream = await wrapped(
      { id: "moonshotai/kimi-k2.5", api: "openai-completions" } as any,
      { messages: [], tools } as any,
      {} as any,
    );

    for await (const _event of resultStream) {
      // Exhaust stream
    }

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"kimi"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_kimi_repair_success"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"repairStage":"toolcall_end"'),
    );
  });

  it("salvages <find> pseudo-tool wrapper when tag name matches a known tool", async () => {
    const toolPayload = '<find name="find" pattern="**/*.ts" glob="**/nanogpt**/*.md"></find>';

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B",
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "find",
            description: "Find files",
            parameters: {
              type: "object",
              properties: {
                pattern: { type: "string" },
                glob: { type: "string" },
              },
              required: ["pattern"],
            },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content[0].name).toBe("find");
    expect(doneMessage.content[0].arguments).toEqual({ pattern: "**/*.ts", glob: "**/nanogpt**/*.md" });
  });

  it("salvages <find> pseudo-tool wrapper with partial arguments when a required field is missing", async () => {
    const toolPayload = '<find>glob="**/nanogpt*/**"</find>';

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B",
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "find",
            description: "Find files",
            parameters: {
              type: "object",
              properties: {
                pattern: { type: "string" },
                glob: { type: "string" },
              },
              required: ["pattern"],
            },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content).toContainEqual(
      expect.objectContaining({ type: "toolCall", name: "find", arguments: { glob: "**/nanogpt*/**" } }),
    );
  });

  it("salvages function-style tool call embedded in surrounding prose", async () => {
    const toolPayload = 'Let me search for that.\nfind({"pattern":"*.ts"})\nThis should work.';

    const mockStreamFn = vi.fn().mockResolvedValue((async function* () {
      yield {
        type: "done",
        reason: "stop",
        message: createAssistantMessage({
          model: "qwen/Qwen3.6-35B-A3B",
          content: [{ type: "text", text: toolPayload }],
        }),
      } satisfies AssistantMessageEvent;
    })());

    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "qwen/Qwen3.6-35B-A3B", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "find",
            description: "Find files",
            parameters: {
              type: "object",
              properties: {
                pattern: { type: "string" },
              },
              required: ["pattern"],
            },
          },
        ],
      } as any,
      {} as any,
    );

    const doneMessage = await (resultStream as any).result();
    expect(doneMessage.stopReason).toBe("toolUse");
    expect(doneMessage.content).toContainEqual(
      expect.objectContaining({ type: "toolCall", name: "find" }),
    );
  });

  it("keeps GLM models on the live guard path and logs semantic diagnostics for missing fields", async () => {
    const mockEvents: AssistantMessageEvent[] = [
      {
        type: "toolcall_delta",
        contentIndex: 0,
        delta: '{"selector":"#search"}',
        partial: createAssistantMessage({
          content: [{ type: "toolCall", id: "call_glm", name: "browser", arguments: {} }],
        }),
      },
      {
        type: "toolcall_end",
        contentIndex: 0,
        toolCall: {
          type: "toolCall",
          id: "call_glm",
          name: "browser",
          arguments: {},
        },
        partial: createAssistantMessage({
          content: [{ type: "toolCall", id: "call_glm", name: "browser", arguments: {} }],
        }),
      },
      {
        type: "done",
        reason: "toolUse",
        message: createAssistantMessage({
          content: [{ type: "toolCall", id: "call_glm", name: "browser", arguments: {} }],
          stopReason: "toolUse",
        }),
      },
    ];

    const originalStream = createReplayableStream(
      mockEvents,
      createAssistantMessage({
        content: [{ type: "toolCall", id: "call_glm", name: "browser", arguments: {} }],
        stopReason: "toolUse",
      }),
    );

    const mockStreamFn = vi.fn().mockResolvedValue(originalStream);
    const logger = { warn: vi.fn(), info: vi.fn() };
    const wrapped = wrapStreamWithToolCallRepair(mockStreamFn as any, logger);
    const resultStream = await wrapped(
      { id: "zai-org/glm-5:thinking", api: "openai-completions" } as any,
      {
        messages: [],
        tools: [
          {
            name: "browser",
            description: "Browser navigation tool",
            parameters: {
              type: "object",
              required: ["ref"],
              properties: {
                ref: { type: "string" },
                selector: { type: "string" },
                fields: { type: "array" },
              },
            },
          },
        ],
      } as any,
      {} as any,
    );

    expect(resultStream).toBe(originalStream);

    const receivedEvents: AssistantMessageEvent[] = [];
    for await (const event of resultStream as AsyncIterable<AssistantMessageEvent>) {
      receivedEvents.push(event);
    }

    const toolEndEvent = receivedEvents.find((event) => event.type === "toolcall_end") as any;
    expect(toolEndEvent.toolCall.arguments).toEqual({});
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('GLM semantic tool issue for tool "browser"'),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("missing required field(s): ref"),
    );
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("likely missing ref/selector/fields-style argument(s): ref, fields"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"plugin":"nanogpt"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"family":"glm"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"event":"nanogpt_glm_semantic_tool_issue"'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"missingRequiredFields":["ref"]'),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('"missingHighlightedFields":["ref","fields"]'),
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
