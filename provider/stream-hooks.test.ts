import { createAssistantMessageEventStream, type AssistantMessage } from "@mariozechner/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { wrapNanoGptStreamFn } from "./stream-hooks.js";

const MODEL_ID = "moonshotai/kimi-k2.5:thinking";
type WarnMock = ((message: string, meta?: Record<string, unknown>) => void) & {
  mock: { calls: unknown[][] };
};

function buildUsage(isEmpty: boolean): AssistantMessage["usage"] {
  if (isEmpty) {
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

  return {
    input: 8,
    output: 12,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 20,
    cost: {
      input: 0.01,
      output: 0.02,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0.03,
    },
  };
}

function buildAssistantMessage(params: {
  content: AssistantMessage["content"];
  stopReason?: AssistantMessage["stopReason"];
  usageEmpty?: boolean;
}): AssistantMessage {
  return {
    role: "assistant",
    content: params.content,
    api: "openai-completions",
    provider: "nanogpt",
    model: MODEL_ID,
    usage: buildUsage(params.usageEmpty ?? false),
    stopReason: params.stopReason ?? "stop",
    timestamp: Date.now(),
  };
}

function createWrappedStream(params: {
  message: AssistantMessage;
  retryMessage?: AssistantMessage;
  onPayload?: (payload: unknown) => void;
  modelCompat?: Record<string, unknown>;
  logger?: { warn?: (message: string, meta?: Record<string, unknown>) => void };
  config?: Record<string, unknown>;
}) {
  const warn = (params.logger?.warn ?? vi.fn()) as WarnMock;
  const logger = params.logger ?? { warn };
  const messages = [params.message, ...(params.retryMessage ? [params.retryMessage] : [])];
  let streamCallIndex = 0;
  const baseStreamFn = vi.fn(async (_model: unknown, _context: unknown, options?: any) => {
    if (typeof options?.onPayload === "function") {
      const observedPayload = await options.onPayload({ stream: true }, {});
      params.onPayload?.(observedPayload);
    }

    const message = messages[Math.min(streamCallIndex, messages.length - 1)];
    streamCallIndex += 1;
    const stream = createAssistantMessageEventStream();
    const reason =
      message.stopReason === "length"
        ? "length"
        : message.stopReason === "toolUse"
          ? "toolUse"
          : "stop";
    stream.push({ type: "done", reason, message });
    stream.end(message);
    return stream;
  });

  const wrapped = wrapNanoGptStreamFn(
    {
      provider: "nanogpt",
      modelId: MODEL_ID,
      extraParams: {},
      model: {
        id: MODEL_ID,
        api: "openai-completions",
        compat: params.modelCompat ?? {},
      },
      streamFn: baseStreamFn,
    } as any,
    logger,
    params.config,
  );

  return { warn, wrapped, baseStreamFn };
}

function extractWarnMessages(warn: WarnMock): string[] {
  return warn.mock.calls.map(([message]) => String(message));
}

describe("nanoGPT stream hooks", () => {
  it("forces stream_options.include_usage for completions streams and warns when usage is empty", async () => {
    const observedPayloads: unknown[] = [];
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "ok" }],
      usageEmpty: true,
      stopReason: "stop",
    });
    const { warn, wrapped } = createWrappedStream({
      message,
      onPayload: (payload) => {
        observedPayloads.push(payload);
      },
    });

    expect(wrapped).toEqual(expect.any(Function));
    const stream = await wrapped?.({} as any, {} as any, {});
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedPayloads[0]).toMatchObject({
      stream_options: {
        include_usage: true,
      },
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not log anomalies for a clean non-tool turn", async () => {
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "plain response" }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const { warn, wrapped } = createWrappedStream({ message });

    const stream = await wrapped?.({} as any, {} as any, {});
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).not.toHaveBeenCalled();
  });

  it("warns when a tool-enabled turn ends without parsed tool calls and visible output", async () => {
    const message = buildAssistantMessage({
      content: [],
      usageEmpty: false,
      stopReason: "stop",
    });
    const { warn, wrapped } = createWrappedStream({ message });

    const stream = await wrapped?.(
      {} as any,
      {
        tools: [{ name: "read", description: "Read a file", parameters: {} }],
      } as any,
      {},
    );
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const messages = extractWarnMessages(warn);
    expect(messages).toHaveLength(2);
    expect(
      messages.some((message) => message.includes("tool_enabled_turn_without_tool_call")),
    ).toBe(true);
    expect(
      messages.some((message) => message.includes("tool_enabled_turn_with_empty_visible_output")),
    ).toBe(true);
  });

  it("does not warn tool-enabled plain-text turns without tool-like output", async () => {
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "I can answer that directly." }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const { warn, wrapped } = createWrappedStream({ message });

    const stream = await wrapped?.(
      {} as any,
      {
        tools: [{ name: "read", description: "Read a file", parameters: {} }],
      } as any,
      {},
    );
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not inject response_format by default for tool-enabled requests", async () => {
    const observedPayloads: unknown[] = [];
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "ok" }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const { wrapped } = createWrappedStream({
      message,
      onPayload: (payload) => observedPayloads.push(payload),
    });

    await wrapped?.({} as any, { tools: [{ name: "read", parameters: {} }] } as any, {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Default responseFormat is false (off), so no injection happens.
    expect(observedPayloads[0]).not.toHaveProperty("response_format");
  });

  it("does not inject response_format for non-tool requests", async () => {
    const observedPayloads: unknown[] = [];
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "hello" }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const { wrapped } = createWrappedStream({
      message,
      onPayload: (payload) => observedPayloads.push(payload),
    });

    await wrapped?.({} as any, {} as any, {}); // no tools
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedPayloads[0]).not.toHaveProperty("response_format");
  });

  it("does not inject configured response_format for non-tool requests", async () => {
    const observedPayloads: unknown[] = [];
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "hello" }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const { wrapped } = createWrappedStream({
      message,
      config: { responseFormat: "json_object" },
      onPayload: (payload) => observedPayloads.push(payload),
    });

    await wrapped?.({} as any, {} as any, {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedPayloads[0]).not.toHaveProperty("response_format");
  });

  it("warns on tool-like text and leaked reasoning markers without exposing raw content", async () => {
    const message = buildAssistantMessage({
      content: [
        {
          type: "text",
          text: "<thinking>plan</thinking> <tool>run</tool> <function=read>",
        },
      ],
      usageEmpty: false,
      stopReason: "stop",
    });
    const originalMessage = JSON.parse(JSON.stringify(message)) as typeof message;
    const { warn, wrapped } = createWrappedStream({ message });

    const stream = await wrapped?.(
      {} as any,
      {
        tools: [{ name: "read", description: "Read a file", parameters: {} }],
      } as any,
      {},
    );
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const messages = extractWarnMessages(warn);
    expect(
      messages.some((message) => message.includes("tool_enabled_turn_without_tool_call")),
    ).toBe(true);
    expect(
      messages.some((message) => message.includes("tool_enabled_turn_with_tool_like_text")),
    ).toBe(true);
    expect(
      messages.some((message) => message.includes("visible_output_contains_reasoning_tags")),
    ).toBe(true);
    expect(
      messages.some((message) =>
        message.includes("visible_output_contains_xml_like_tool_wrappers"),
      ),
    ).toBe(true);
    expect(
      messages.some((message) => message.includes("visible_output_contains_function_call_markers")),
    ).toBe(true);
    expect(messages.some((message) => message.includes(`model=${MODEL_ID}`))).toBe(true);
    expect(messages.some((message) => message.includes("family=kimi"))).toBe(true);
    expect(messages.some((message) => message.includes("plan"))).toBe(false);
    expect(messages.some((message) => message.includes("run"))).toBe(false);
    expect(message).toEqual(originalMessage);
  });

  it("warns on unbalanced reasoning tags without double-reporting the balanced leak kind", async () => {
    const message = buildAssistantMessage({
      content: [
        {
          type: "text",
          text: "<analysis>unfinished",
        },
        {
          type: "toolCall",
          id: "call_1",
          name: "read",
          arguments: { path: "/tmp/test.txt" },
        } as any,
      ],
      usageEmpty: false,
      stopReason: "toolUse",
    });
    const { warn, wrapped } = createWrappedStream({ message });

    const stream = await wrapped?.(
      {} as any,
      {
        tools: [{ name: "read", description: "Read a file", parameters: {} }],
      } as any,
      {},
    );
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const messages = extractWarnMessages(warn);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("visible_output_contains_unbalanced_reasoning_tags");
    expect(messages[0]).not.toContain("visible_output_contains_reasoning_tags");
    expect(messages[0]).not.toContain("unfinished");
  });

  it("keeps stream observability active when supportsUsageInStreaming=false without forcing include_usage", async () => {
    const logger = { warn: vi.fn() };
    const observedPayloads: unknown[] = [];
    const message = buildAssistantMessage({
      content: [],
      usageEmpty: true,
      stopReason: "stop",
    });
    const baseStreamFn = vi.fn(async (_model: unknown, _context: unknown, options?: any) => {
      if (typeof options?.onPayload === "function") {
        const observedPayload = await options.onPayload({ stream: true }, {});
        observedPayloads.push(observedPayload);
      }

      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    });

    const wrapped = wrapNanoGptStreamFn(
      {
        provider: "nanogpt",
        modelId: MODEL_ID,
        extraParams: {},
        model: {
          id: MODEL_ID,
          api: "openai-completions",
          compat: { supportsUsageInStreaming: false },
        },
        streamFn: baseStreamFn,
      } as any,
      logger,
    );

    expect(wrapped).not.toBe(baseStreamFn);

    const stream = await wrapped?.(
      {} as any,
      {
        tools: [{ name: "read", description: "Read a file", parameters: {} }],
      } as any,
      {},
    );
    await stream?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedPayloads[0]).toEqual({ stream: true });
    expect(
      extractWarnMessages(logger.warn).some((message) =>
        message.includes("tool_enabled_turn_without_tool_call"),
      ),
    ).toBe(true);
    expect(
      extractWarnMessages(logger.warn).some((message) =>
        message.includes("requested stream_options.include_usage"),
      ),
    ).toBe(false);
  });

  it("deduplicates identical anomaly warnings across requests that share the same logger", async () => {
    const logger = { warn: vi.fn() };
    const message = buildAssistantMessage({
      content: [],
      usageEmpty: false,
      stopReason: "stop",
    });

    const first = createWrappedStream({
      message,
      logger,
    });
    const second = createWrappedStream({
      message,
      logger,
    });

    const streamOne = await first.wrapped?.(
      {} as any,
      {
        tools: [{ name: "read", description: "Read a file", parameters: {} }],
      } as any,
      {},
    );
    await streamOne?.result();

    const streamTwo = await second.wrapped?.(
      {} as any,
      {
        tools: [{ name: "read", description: "Read a file", parameters: {} }],
      } as any,
      {},
    );
    await streamTwo?.result();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const messages = extractWarnMessages(logger.warn);
    expect(
      messages.filter((message) => message.includes("tool_enabled_turn_without_tool_call")),
    ).toHaveLength(1);
    expect(
      messages.filter((message) => message.includes("tool_enabled_turn_with_empty_visible_output")),
    ).toHaveLength(1);
    expect(messages).toHaveLength(2);
  });

  it("injects the object bridge system prompt when bridgeMode=always", async () => {
    const observedPayloads: unknown[] = [];
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "ok" }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const { wrapped } = createWrappedStream({
      message,
      onPayload: (payload) => observedPayloads.push(payload),
      config: { bridgeMode: "always", bridgeProtocol: "object" },
    });

    await wrapped?.(
      {} as any,
      {
        tools: [
          {
            name: "read",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      } as any,
      {},
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const payloadMessages = (observedPayloads[0] as Record<string, unknown>).messages as Array<
      Record<string, unknown>
    >;
    expect(payloadMessages[0]?.content).toContain('"v"');
    expect(payloadMessages[0]?.content).toContain('"tool_calls"');
  });

  it("rewrites object bridge content into parsed tool calls", async () => {
    const message = buildAssistantMessage({
      content: [
        {
          type: "text",
          text: '{"v":1,"mode":"tool","message":"I will inspect the file now.","tool_calls":[{"name":"read","arguments":{"path":"src/index.ts"}}]}',
        },
      ],
      usageEmpty: false,
      stopReason: "stop",
    });
    const { wrapped } = createWrappedStream({
      message,
      config: { bridgeMode: "always", bridgeProtocol: "object" },
    });

    const stream = await wrapped?.(
      {} as any,
      {
        tools: [
          {
            name: "read",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      } as any,
      {},
    );
    const result = await stream?.result();

    expect(result?.stopReason).toBe("toolUse");
    expect(result?.content).toMatchObject([
      { type: "text", text: "I will inspect the file now." },
      { type: "toolCall", name: "read", arguments: { path: "src/index.ts" } },
    ]);
  });

  it("retries one invalid empty bridged turn", async () => {
    const invalidMessage = buildAssistantMessage({
      content: [{ type: "text", text: '{"v":1,"mode":"tool","message":"","tool_calls":[]}' }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const retryMessage = buildAssistantMessage({
      content: [
        {
          type: "text",
          text: '{"v":1,"mode":"tool","message":"Retrying now.","tool_calls":[{"name":"read","arguments":{"path":"retry.ts"}}]}',
        },
      ],
      usageEmpty: false,
      stopReason: "stop",
    });
    const observedPayloads: unknown[] = [];
    const { wrapped, baseStreamFn } = createWrappedStream({
      message: invalidMessage,
      retryMessage,
      onPayload: (payload) => observedPayloads.push(payload),
      config: { bridgeMode: "always", bridgeProtocol: "object" },
    });

    const stream = await wrapped?.(
      {} as any,
      {
        tools: [
          {
            name: "read",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      } as any,
      {},
    );
    const result = await stream?.result();

    expect(baseStreamFn).toHaveBeenCalledTimes(2);
    expect(
      (
        (observedPayloads[1] as Record<string, unknown>).messages as Array<Record<string, string>>
      ).at(-1)?.content,
    ).toContain("invalid because it contained no visible content or tool call");
    expect(result?.stopReason).toBe("toolUse");
    expect(result?.content[1]).toMatchObject({
      type: "toolCall",
      name: "read",
      arguments: { path: "retry.ts" },
    });
  });

  it("supports the xml bridge protocol", async () => {
    const message = buildAssistantMessage({
      content: [
        {
          type: "text",
          text: "<open>I will inspect the file now.</open><read><path>src/index.ts</path></read>",
        },
      ],
      usageEmpty: false,
      stopReason: "stop",
    });
    const { wrapped } = createWrappedStream({
      message,
      config: { bridgeMode: "always", bridgeProtocol: "xml" },
    });

    const stream = await wrapped?.(
      {} as any,
      {
        tools: [
          {
            name: "read",
            description: "Read a file",
            parameters: { type: "object", properties: { path: { type: "string" } } },
          },
        ],
      } as any,
      {},
    );
    const result = await stream?.result();

    expect(result?.stopReason).toBe("toolUse");
    expect(result?.content).toMatchObject([
      { type: "text", text: "I will inspect the file now." },
      { type: "toolCall", name: "read", arguments: { path: "src/index.ts" } },
    ]);
  });

  it("injects json_object response_format when configured", async () => {
    const observedPayloads: unknown[] = [];
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "ok" }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const baseStreamFn = vi.fn(async (_model: unknown, _context: unknown, options?: any) => {
      if (typeof options?.onPayload === "function") {
        const observedPayload = await options.onPayload({ stream: true }, {});
        observedPayloads.push(observedPayload);
      }
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    });

    const wrapped = wrapNanoGptStreamFn(
      {
        provider: "nanogpt",
        modelId: MODEL_ID,
        extraParams: {},
        model: { id: MODEL_ID, api: "openai-completions" },
        streamFn: baseStreamFn,
      } as any,
      { warn: vi.fn() },
      { responseFormat: "json_object" },
    );

    await wrapped?.({} as any, { tools: [{ name: "read", parameters: {} }] } as any, {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedPayloads[0]).toMatchObject({
      response_format: { type: "json_object" },
    });
  });

  it("injects json_schema response_format with provided schema", async () => {
    const observedPayloads: unknown[] = [];
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "ok" }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const schema = { type: "object", properties: { path: { type: "string" } } };
    const baseStreamFn = vi.fn(async (_model: unknown, _context: unknown, options?: any) => {
      if (typeof options?.onPayload === "function") {
        const observedPayload = await options.onPayload({ stream: true }, {});
        observedPayloads.push(observedPayload);
      }
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    });

    const wrapped = wrapNanoGptStreamFn(
      {
        provider: "nanogpt",
        modelId: MODEL_ID,
        extraParams: {},
        model: { id: MODEL_ID, api: "openai-completions" },
        streamFn: baseStreamFn,
      } as any,
      { warn: vi.fn() },
      { responseFormat: { type: "json_schema", schema } },
    );

    await wrapped?.({} as any, { tools: [{ name: "read", parameters: {} }] } as any, {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedPayloads[0]).toMatchObject({
      response_format: { type: "json_schema", json_schema: { schema } },
    });
  });

  it("does not inject response_format when configured as false", async () => {
    const observedPayloads: unknown[] = [];
    const message = buildAssistantMessage({
      content: [{ type: "text", text: "ok" }],
      usageEmpty: false,
      stopReason: "stop",
    });
    const baseStreamFn = vi.fn(async (_model: unknown, _context: unknown, options?: any) => {
      if (typeof options?.onPayload === "function") {
        const observedPayload = await options.onPayload({ stream: true }, {});
        observedPayloads.push(observedPayload);
      }
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message });
      stream.end(message);
      return stream;
    });

    const wrapped = wrapNanoGptStreamFn(
      {
        provider: "nanogpt",
        modelId: MODEL_ID,
        extraParams: {},
        model: { id: MODEL_ID, api: "openai-completions" },
        streamFn: baseStreamFn,
      } as any,
      { warn: vi.fn() },
      { responseFormat: false },
    );

    await wrapped?.({} as any, { tools: [{ name: "read", parameters: {} }] } as any, {});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(observedPayloads[0]).not.toHaveProperty("response_format");
  });
});
