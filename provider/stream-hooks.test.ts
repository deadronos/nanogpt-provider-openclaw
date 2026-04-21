import { describe, expect, it, vi } from "vitest";
import { createAssistantMessageEventStream, type AssistantMessage } from "@mariozechner/pi-ai";
import { wrapNanoGptStreamFn } from "./stream-hooks.js";

describe("nanoGPT stream hooks", () => {
  it("forces stream_options.include_usage for completions streams and warns when usage is empty", async () => {
    const warn = vi.fn();
    let observedPayload: unknown;

    const baseStreamFn = vi.fn(async (_model: unknown, _context: unknown, options?: any) => {
      if (typeof options?.onPayload === "function") {
        observedPayload = await options.onPayload({ stream: true }, {});
      }

      const stream = createAssistantMessageEventStream();
      const message: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "ok" }],
        api: "openai-completions",
        provider: "nanogpt",
        model: "openai/gpt-5.4-mini",
        usage: {
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
        },
        stopReason: "stop",
        timestamp: Date.now(),
      };
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    });

    const wrapped = wrapNanoGptStreamFn(
      {
        provider: "nanogpt",
        modelId: "openai/gpt-5.4-mini",
        extraParams: {},
        model: {
          id: "openai/gpt-5.4-mini",
          api: "openai-completions",
          compat: {},
        },
        streamFn: baseStreamFn,
      } as any,
      { warn },
    );

    expect(wrapped).toEqual(expect.any(Function));
    const stream = await wrapped?.({} as any, {} as any, {});
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedPayload).toMatchObject({
      stream_options: {
        include_usage: true,
      },
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not override supportsUsageInStreaming=false", () => {
    const warn = vi.fn();
    const baseStreamFn = vi.fn();

    const wrapped = wrapNanoGptStreamFn(
      {
        provider: "nanogpt",
        modelId: "openai/gpt-5.4-mini",
        extraParams: {},
        model: {
          id: "openai/gpt-5.4-mini",
          api: "openai-completions",
          compat: { supportsUsageInStreaming: false },
        },
        streamFn: baseStreamFn,
      } as any,
      { warn },
    );

    expect(wrapped).toBe(baseStreamFn);
    expect(warn).not.toHaveBeenCalled();
  });
});

