import { describe, it, expect, vi } from "vitest";
import {
  shouldRepairNanoGptToolCallArguments,
  wrapStreamWithToolCallRepair,
} from "./repair.js";
import type { AssistantMessageEvent } from "@mariozechner/pi-ai";

describe("shouldRepairNanoGptToolCallArguments", () => {
  it("only enables repair for Kimi-style NanoGPT model ids", () => {
    expect(shouldRepairNanoGptToolCallArguments("moonshotai/kimi-k2.5")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("moonshotai/kimi-k2.5:thinking")).toBe(true);
    expect(shouldRepairNanoGptToolCallArguments("nanogpt/moonshotai/kimi-k2.5:thinking")).toBe(true);
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
});
