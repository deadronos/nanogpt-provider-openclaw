# NanoProxy Bridge — Implementation Plan (3 Alternatives)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce malformed/empty tool calls from nano-gpt by implementing one of three increasingly capable alternatives.

**Architecture:** Each alternative targets a different scope and feasibility level. All operate inside `wrapStreamFn` in `provider/stream-hooks.ts`. The core architectural constraint: no hook exists to strip `tools`/`tool_choice` from the request body, so the `tools` array always reaches nano-gpt alongside any bridge instructions.

**Tech Stack:** TypeScript, vitest, existing `provider/stream-hooks.ts`, OpenClaw plugin SDK (`openclaw/plugin-sdk/provider-stream-shared`).

---

## Three Alternatives at a Glance

| Alternative                         | Effort    | Scope                                                                           | Key Limitation                                             |
| ----------------------------------- | --------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **A: `response_format` experiment** | 1–2 days  | NanoGPT native structured output, no new files                                  | May not work for tool calls specifically                   |
| **B: Streaming parsers only**       | 1 week    | Port `StreamingObjectParser` + `StreamingXmlParser` for better response parsing | No bridge prompt injection, no retry                       |
| **C: Best-effort full bridge**      | 3–4 weeks | B + system prompt injection + keepalive + retry                                 | `tools` array always present alongside bridge instructions |

**Recommendation:** Start with A to validate whether bridging is even necessary. If nano-gpt's `response_format: { type: "json_object" }` works for tool calls, Alternatives B and C become unnecessary.

---

## Alternative A: `response_format` Experiment

**Principle:** Test whether nano-gpt's native structured output feature eliminates the need for a full bridge at all.

### File Map

- Modify: `provider/stream-hooks.ts` — add `response_format` injection via `onPayload`
- Modify: `provider/stream-hooks.test.ts` — add tests for the new payload injection

### No new files created.

---

### Task 1: Add `response_format` injection to `wrapStreamFn`

**Files:**

- Modify: `provider/stream-hooks.ts` (lines 537–555)

- [ ] **Step 1: Write the failing test**

```typescript
it("injects response_format: { type: 'json_object' } for tool-enabled requests", async () => {
  const observedPayloads: unknown[] = [];
  const message = buildAssistantMessage({
    content: [{ type: "text", text: "ok" }],
    usageEmpty: false,
    stopReason: "stop",
  });
  const { wrapped, baseStreamFn } = createWrappedStream({
    message,
    onPayload: (payload) => observedPayloads.push(payload),
  });

  await wrapped?.({} as any, { tools: [{ name: "read", parameters: {} }] } as any, {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(observedPayloads[0]).toMatchObject({
    response_format: { type: "json_object" },
  });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run provider/stream-hooks.test.ts --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|response_format)"`
Expected: FAIL — `response_format` not yet injected

- [ ] **Step 3: Implement the injection**

In `wrapNanoGptStreamFn`, after the existing `ensureIncludeUsageInStreamingPayload` call, add:

```typescript
// Inject response_format for tool-enabled requests to request structured JSON output.
const hasTools = requestToolMetadata.toolEnabled;
if (hasTools) {
  // Only inject if not already present.
  const existing = (upstreamPayload as Record<string, unknown>).response_format;
  if (!existing) {
    (upstreamPayload as Record<string, unknown>).response_format = { type: "json_object" };
  }
}
```

Place this inside the `onPayload` callback, after the `ensureIncludeUsageInStreamingPayload` call.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run provider/stream-hooks.test.ts --reporter=verbose 2>&1 | grep -E "(PASS|FAIL|response_format)"`
Expected: PASS for both new tests

- [ ] **Step 5: Commit**

```bash
git add provider/stream-hooks.ts provider/stream-hooks.test.ts
git commit -m "feat: inject response_format for tool-enabled nano-gpt requests

Tests that nano-gpt's native structured output reduces malformed tool calls."
```

---

### Task 2: Validate with real API (manual experiment)

This task is **not test-automated**. It requires a live nano-gpt API key.

- [ ] **Step 1: Write a minimal test script**

Create `scripts/test-response-format.ts`:

```typescript
import { getRegisteredProvider } from "../provider/test-harness.js";

const provider = getRegisteredProvider();
const wrapStreamFn = provider.wrapStreamFn as any;

const baseStreamFn = async (model: any, context: any, options: any) => {
  console.log("Payload received by transport:", JSON.stringify(options?.__test_payload, null, 2));
  return {
    result: async () => ({ content: [{ type: "text", text: "ok" }], stopReason: "stop" }),
    [Symbol.asyncIterator]: () => ({
      next: async () => ({ done: true, value: undefined }),
      return: async () => ({ done: true, value: undefined }),
      throw: async () => ({ done: true, value: undefined }),
    }),
  };
};

const wrapped = wrapStreamFn({
  streamFn: baseStreamFn,
  modelId: "moonshotai/kimi-k2.5:thinking",
  model: { id: "moonshotai/kimi-k2.5:thinking", api: "openai-completions" },
  extraParams: {},
});

// Intercept onPayload to capture the built payload.
const testOptions = {
  onPayload: (payload: any) => {
    console.log("response_format in payload:", payload?.response_format);
    console.log("tools in payload:", payload?.tools?.length);
    return payload;
  },
  __test_payload: true,
};

await wrapped(
  { api: "openai-completions" },
  { tools: [{ name: "read", parameters: {} }] },
  testOptions,
);
```

Run: `npx tsx scripts/test-response-format.ts`

Expected: `response_format: { type: "json_object" }` appears in the captured payload, and `tools` array is also present (confirms the architectural constraint).

- [ ] **Step 2: Report findings**

Document whether `response_format` alone (with `tools` still present) is sufficient to reduce malformed tool calls. This is an empirical test — the result determines whether Alternatives B/C are needed.

---

## Alternative B: Streaming Parsers (No Bridge Prompt Injection)

**Principle:** Port the `StreamingObjectParser` and `StreamingXmlParser` from NanoProxy to do better response parsing. No bridge system prompt is injected — we parse whatever nano-gpt returns, but parse it more reliably.

### File Map

- Create: `provider/bridge/object-parser.ts` — `StreamingObjectParser` adapted from NanoProxy `src/object_bridge.js`
- Create: `provider/bridge/xml-parser.ts` — `StreamingXmlParser` adapted from NanoProxy `src/core.js`
- Create: `provider/bridge/bridge-result.ts` — shared result types and builders
- Create: `provider/bridge/bridge-result.test.ts` — unit tests for parsers
- Modify: `provider/stream-hooks.ts` — wire parsers into `wrapNanoGptStreamFn` under a config flag
- Modify: `provider/stream-hooks.test.ts` — add tests for parser behavior

---

### Task 1: Create `provider/bridge/` directory and result types

**Files:**

- Create: `provider/bridge/bridge-result.ts`
- Create: `provider/bridge/bridge-result.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// provider/bridge/bridge-result.test.ts
import { describe, expect, it } from "vitest";
import { buildNanoGptBridgeResult, type NanoGptBridgeResultKind } from "./bridge-result.js";

describe("NanoGPT bridge result types", () => {
  it("classifies a valid object-bridge turn with tool calls", () => {
    const result = buildNanoGptBridgeResult({
      rawText:
        '{"v":1,"mode":"tool","message":"reading file","tool_calls":[{"name":"read","arguments":{"path":"a.js"}}]}',
      parsedKind: "object",
    });
    expect(result.kind).toBe("valid");
    expect(result.message).toBe("reading file");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe("read");
  });

  it("classifies an invalid empty bridge turn", () => {
    const result = buildNanoGptBridgeResult({
      rawText: '{"v":1,"mode":"tool","message":"","tool_calls":[]}',
      parsedKind: "object",
    });
    expect(result.kind).toBe("invalid_empty");
  });

  it("classifies a malformed bridge turn", () => {
    const result = buildNanoGptBridgeResult({
      rawText: "not json at all",
      parsedKind: "object",
    });
    expect(result.kind).toBe("invalid_json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run provider/bridge/bridge-result.test.ts 2>&1`
Expected: FAIL — file does not exist

- [ ] **Step 3: Create the result type file**

`provider/bridge/bridge-result.ts`:

```typescript
export type NanoGptBridgeResultKind =
  | "valid"
  | "invalid_empty"
  | "invalid_json"
  | "invalid_xml"
  | "native";

export interface NanoGptBridgeToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface NanoGptBridgeResult {
  kind: NanoGptBridgeResultKind;
  rawText: string;
  message?: string;
  toolCalls?: NanoGptBridgeToolCall[];
  error?: string;
}

export function buildNanoGptBridgeResult(params: {
  rawText: string;
  parsedKind: "object" | "xml" | "native";
  message?: string;
  toolCalls?: NanoGptBridgeToolCall[];
}): NanoGptBridgeResult {
  if (!params.message && (!params.toolCalls || params.toolCalls.length === 0)) {
    return { kind: "invalid_empty", rawText: params.rawText };
  }
  return {
    kind: "valid",
    rawText: params.rawText,
    message: params.message,
    toolCalls: params.toolCalls,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run provider/bridge/bridge-result.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add provider/bridge/bridge-result.ts provider/bridge/bridge-result.test.ts
git commit -m "feat(bridge): add bridge result types"
```

---

### Task 2: Port `StreamingObjectParser`

**Files:**

- Create: `provider/bridge/object-parser.ts`
- Create: `provider/bridge/object-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// provider/bridge/object-parser.test.ts
import { describe, expect, it } from "vitest";
import { StreamingObjectParser } from "./object-parser.js";

describe("StreamingObjectParser", () => {
  it("emits content and tool calls from a complete object-bridge JSON", () => {
    const parser = new StreamingObjectParser();
    const events: string[] = [];
    parser.on("message", (msg) => events.push(`message:${msg}`));
    parser.on("toolCall", (tc) => events.push(`toolCall:${tc.name}`));
    parser.on("done", () => events.push("done"));

    parser.feed(
      '{"v":1,"mode":"tool","message":"reading","tool_calls":[{"name":"read","arguments":{"path":"a.js"}}]}',
    );
    parser.flush();

    expect(events).toEqual(["message:reading", "toolCall:read", "done"]);
  });

  it("handles incremental JSON streaming", () => {
    const parser = new StreamingObjectParser();
    const events: string[] = [];
    parser.on("message", (msg) => events.push(`message:${msg}`));
    parser.on("toolCall", (tc) => events.push(`toolCall:${tc.name}`));

    parser.feed('{"v":1,"mode":"tool","message":"rea');
    parser.feed('ding","tool_calls":[{"name":"read","arg');
    parser.feed('uments":{"path":"a.js"}}]}');
    parser.flush();

    expect(events).toEqual(["message:reading", "toolCall:read"]);
  });

  it("classifies invalid empty turn on flush", () => {
    const parser = new StreamingObjectParser();
    let resultKind: string = "";
    parser.on("done", () => {});
    parser.on("result", (r) => {
      resultKind = r.kind;
    });

    parser.feed('{"v":1,"mode":"tool","message":"","tool_calls":[]}');
    parser.flush();

    expect(resultKind).toBe("invalid_empty");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run provider/bridge/object-parser.test.ts 2>&1`
Expected: FAIL — file does not exist

- [ ] **Step 3: Port the parser from NanoProxy**

`provider/bridge/object-parser.ts` — adapted from NanoProxy `src/object_bridge.js` `StreamingObjectParser`. The key state machine:

```typescript
type ObjectParserState = {
  buffer: string;
  mode: "tool" | "final" | "clarify" | null;
  messageEmitted: boolean;
  toolCallsArrayStart: number;
  toolCallsCursor: number;
  objectClosed: boolean;
  completedCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
};

type ParserEvent = "message" | "toolCall" | "done" | "result";

export class StreamingObjectParser {
  private state: ObjectParserState = {
    buffer: "",
    mode: null,
    messageEmitted: false,
    toolCallsArrayStart: -1,
    toolCallsCursor: -1,
    objectClosed: false,
    completedCalls: [],
  };

  private listeners: Partial<Record<ParserEvent, Array<(arg: unknown) => void>>> = {};

  on(event: ParserEvent, cb: (arg: unknown) => void): void {
    (this.listeners[event] ??= []).push(cb);
  }

  private emit(event: ParserEvent, arg: unknown): void {
    this.listeners[event]?.forEach((cb) => cb(arg));
  }

  feed(text: string): void {
    this.state.buffer += text;
    this.scanHeader();
    if (this.state.mode === "tool") {
      this.scanToolCalls();
    }
  }

  flush(): void {
    if (
      this.state.buffer.trim() &&
      !this.state.messageEmitted &&
      this.state.completedCalls.length === 0
    ) {
      this.emit("result", { kind: "invalid_empty", rawText: this.state.buffer });
    }
    this.emit("done", undefined);
  }

  // Port _scanHeader() from NanoProxy: validates v=1, extracts mode, extracts message string.
  // Port _scanToolCalls(): scans tool_calls array character-by-character, calls tryReadJsonObject for each call.
  // Port normalizeObjectToolCall(): case-insensitive name matching.
}
```

Implement the full state machine from NanoProxy's `StreamingObjectParser` class. Key methods to port:

- `_scanHeader()` — validates `v` field, extracts `mode`, extracts `message` content
- `_scanToolCalls()` — scans through `tool_calls` array character by character
- `tryReadJsonObject(buffer, start)` — finds complete `{...}` spans without calling `JSON.parse` on incomplete chunks
- `tryReadJsonString(buffer, start)` — finds complete `"..."` strings
- `normalizeObjectToolCall()` — case-insensitive name canonicalization

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run provider/bridge/object-parser.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add provider/bridge/object-parser.ts provider/bridge/object-parser.test.ts
git commit -m "feat(bridge): port StreamingObjectParser from NanoProxy"
```

---

### Task 3: Port `StreamingXmlParser`

**Files:**

- Create: `provider/bridge/xml-parser.ts`
- Create: `provider/bridge/xml-parser.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { StreamingXmlParser } from "./xml-parser.js";

describe("StreamingXmlParser", () => {
  it("extracts visible text from <open> tag", () => {
    const parser = new StreamingXmlParser();
    const messages: string[] = [];
    parser.on("message", (m) => messages.push(m));
    parser.feed("<open>reading file</open>");
    parser.flush();
    expect(messages).toEqual(["reading file"]);
  });

  it("extracts tool call from XML tag", () => {
    const parser = new StreamingXmlParser();
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    parser.on("toolCall", (tc) => calls.push(tc));
    parser.feed("<read><path>src/index.js</path></read>");
    parser.flush();
    expect(calls[0]).toMatchObject({ name: "read", args: { path: "src/index.js" } });
  });

  it("handles mixed content", () => {
    const parser = new StreamingXmlParser();
    const messages: string[] = [];
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    parser.on("message", (m) => messages.push(m));
    parser.on("toolCall", (tc) => calls.push(tc));
    parser.feed("<open>I will read this.</open><read><path>a.js</path></read>");
    parser.flush();
    expect(messages).toEqual(["I will read this."]);
    expect(calls[0].name).toBe("read");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run provider/bridge/xml-parser.test.ts 2>&1`
Expected: FAIL

- [ ] **Step 3: Port from NanoProxy `src/core.js` `StreamingXmlParser`**

Implement a character-by-character state machine that:

- Detects `<open>...</open>` for visible content
- Detects `<toolname>...</toolname>` for tool calls
- Parses child tags as named arguments
- Uses `onMessage`, `onToolCall`, `onDone` callbacks

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run provider/bridge/xml-parser.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add provider/bridge/xml-parser.ts provider/bridge/xml-parser.test.ts
git commit -m "feat(bridge): port StreamingXmlParser from NanoProxy"
```

---

### Task 4: Wire parsers into `wrapNanoGptStreamFn` under config flag

**Files:**

- Modify: `provider/stream-hooks.ts`
- Modify: `provider/stream-hooks.test.ts`

This is the integration task. Under a `NANOGPT_ENABLE_BRIDGE_PARSERS=true` env var (or `pluginConfig.bridgeMode === "always"`), the `wrapNanoGptStreamFn` wrapper intercepts the upstream SSE stream and runs it through the appropriate parser.

The key challenge: `wrapStreamFn` receives a `StreamFn` that returns a `Response`-like object with a `ReadableStream` body. Rewriting that stream requires consuming the upstream SSE and producing a new downstream SSE. This is complex — see NanoProxy's `buildSSEFromObjectBridge()` for the pattern.

- [ ] **Step 1: Write the failing integration test**

```typescript
it("uses StreamingObjectParser when bridgeMode=always for tool-enabled requests", async () => {
  const message = buildAssistantMessage({
    content: [
      {
        type: "text",
        text: '{"v":1,"mode":"tool","message":"ok","tool_calls":[{"name":"read","arguments":{"path":"a.js"}}]}',
      },
    ],
    usageEmpty: false,
    stopReason: "stop",
  });
  const { wrapped } = createWrappedStream({ message });

  // With bridgeMode=always, the result should reflect parsed bridge output.
  const stream = await wrapped?.(
    {} as any,
    { tools: [{ name: "read", parameters: {} }] } as any,
    {},
  );
  const result = await stream?.result();
  expect(result.content).toMatchObject([
    { type: "text", text: "ok" },
    { type: "toolCall", name: "read" },
  ]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL — bridge mode not implemented

- [ ] **Step 3: Implement the SSE re-streaming wrapper**

This is the most complex part. Inside `wrapNanoGptStreamFn`, when bridge mode is active:

1. Call `streamFn(model, context, patchedOptions)` to get the upstream response
2. Read the `ReadableStream` body using a `ReadableStreamReader`
3. Decode SSE text chunks from the reader
4. Feed text to `StreamingObjectParser` or `StreamingXmlParser`
5. As parser emits events, build synthetic SSE chunks and push to a new `ReadableStream`
6. Return a new `Response` with that `ReadableStream` as body

The NanoProxy source to adapt: `buildSSEFromObjectBridge()` and `buildSSEFromXmlBridge()` in `src/object_bridge.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run provider/stream-hooks.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add provider/stream-hooks.ts provider/stream-hooks.test.ts
git commit -m "feat(bridge): wire streaming parsers into wrapStreamFn"
```

---

## Alternative C: Best-Effort Full Bridge

**Principle:** Everything in Alternative B, plus:

- Bridge system prompt injection via `onPayload`
- SSE keepalive heartbeat injection (15-second timer)
- Invalid turn retry (one automatic retry with corrective system message)

This is the closest approximation of NanoProxy's full behavior within OpenClaw's hook constraints. Known limitation: `tools` array cannot be removed, so nano-gpt receives both bridge instructions and native tool definitions.

### Additional File Map (beyond B)

- Modify: `provider/tool-schema-hooks.ts` — add `resolveSystemPromptContribution` for bridge system message
- Create: `provider/bridge/system-prompt.ts` — port `buildObjectBridgeSystemMessage()` and `buildXmlBridgeSystemMessage()` from NanoProxy
- Create: `provider/bridge/retry.ts` — invalid turn detection and retry logic
- Create: `provider/bridge/keepalive.ts` — SSE keepalive heartbeat injection
- Modify: `provider/stream-hooks.test.ts` — add retry and keepalive tests

---

### Task 5: Port `buildObjectBridgeSystemMessage()`

**Files:**

- Create: `provider/bridge/system-prompt.ts`
- Create: `provider/bridge/system-prompt.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildNanoGptObjectBridgeSystemMessage } from "./system-prompt.js";

describe("buildNanoGptObjectBridgeSystemMessage", () => {
  it("produces a valid system prompt instructing nano-gpt to emit object bridge format", () => {
    const tools = [
      {
        name: "read",
        description: "Read a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
        },
      },
    ];
    const msg = buildNanoGptObjectBridgeSystemMessage(tools);
    expect(msg).toContain('"v": 1');
    expect(msg).toContain('"mode": "tool"');
    expect(msg).toContain("read");
    expect(msg).toContain("tool_calls");
    // Must NOT contain any instruction to use native tool_calls format.
    expect(msg).not.toContain("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run provider/bridge/system-prompt.test.ts 2>&1`
Expected: FAIL

- [ ] **Step 3: Port from NanoProxy `src/object_bridge.js` `buildObjectBridgeSystemMessage()`**

Adapt the function signature to accept `AnyAgentTool[]` (from `provider/tool-schema-hooks.ts`) instead of NanoProxy's internal tool format.

The system prompt should:

- List each tool with name, description, and parameter schema
- Instruct nano-gpt to emit exactly one JSON object per turn
- Specify the required fields: `v=1`, `mode`, `message`, `tool_calls`
- State that prose outside the JSON object makes the response invalid
- Handle the `attempt_completion` tool case from NanoProxy

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run provider/bridge/system-prompt.test.ts 2>&1`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add provider/bridge/system-prompt.ts provider/bridge/system-prompt.test.ts
git commit -m "feat(bridge): port object bridge system message builder"
```

---

### Task 6: Add bridge system prompt injection to `wrapStreamFn`

**Files:**

- Modify: `provider/stream-hooks.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it("injects bridge system message via onPayload for tool-enabled requests when bridgeMode=always", async () => {
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

  await wrapped?.(
    {} as any,
    {
      tools: [
        {
          name: "read",
          parameters: {
            type: "object",
            properties: { path: { type: "string" } },
            required: ["path"],
          },
        },
      ],
    } as any,
    {},
  );

  expect(observedPayloads[0]).toHaveProperty("messages");
  const msgs = observedPayloads[0].messages as Array<Record<string, unknown>>;
  // First message should be a system message with bridge protocol.
  const systemMsg = msgs?.find((m) => m.role === "system");
  expect(systemMsg?.content as string).toContain('"v": 1');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run provider/stream-hooks.test.ts 2>&1 | grep -E "(PASS|FAIL|BRIDGE|bridge)"`

- [ ] **Step 3: Implement injection**

In the `onPayload` callback in `wrapNanoGptStreamFn`, after the existing payload modifications, add:

```typescript
// Inject bridge system prompt for tool-enabled requests when bridge mode is active.
const bridgeMode = resolvedConfig?.bridgeMode ?? "never";
if (hasTools && bridgeMode === "always") {
  const bridgeSystemMessage = buildNanoGptObjectBridgeSystemMessage(context.tools);
  const messages =
    ((upstreamPayload as Record<string, unknown>).messages as Array<Record<string, unknown>>) ?? [];
  (upstreamPayload as Record<string, unknown>).messages = [
    { role: "system", content: bridgeSystemMessage },
    ...messages,
  ];
}
```

This prepends the bridge system message to the messages array — same pattern NanoProxy uses. The `context.tools` is already available from the `wrapNanoGptStreamFn` context parameter.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run provider/stream-hooks.test.ts 2>&1 | grep -E "(PASS|FAIL)"`

- [ ] **Step 5: Commit**

```bash
git add provider/stream-hooks.ts
git commit -m "feat(bridge): inject object bridge system prompt for tool-enabled requests"
```

---

### Task 7: Add SSE keepalive heartbeat injection

**Files:**

- Create: `provider/bridge/keepalive.ts`
- Create: `provider/bridge/keepalive.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { buildSseKeepaliveChunks } from "./keepalive.js";

describe("buildSseKeepaliveChunks", () => {
  it("produces a valid SSE keepalive comment frame", () => {
    const chunk = buildSseKeepaliveChunks();
    expect(chunk).toBe(": keepalive\n\n");
  });

  it("can be used as a ReadableStream chunk", () => {
    const chunks: string[] = [];
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(buildSseKeepaliveChunks());
        controller.close();
      },
    });
    const reader = stream.getReader();
    const result = await reader.read();
    expect(result.value).toBeInstanceOf(Uint8Array);
    const decoder = new TextDecoder();
    expect(decoder.decode(result.value as Uint8Array)).toBe(": keepalive\n\n");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run provider/bridge/keepalive.test.ts 2>&1`

- [ ] **Step 3: Implement the keepalive builder**

`provider/bridge/keepalive.ts`:

```typescript
const SSE_KEEPALIVE_CHUNK = ": keepalive\n\n";

export function buildSseKeepaliveChunks(): Uint8Array {
  return new TextEncoder().encode(SSE_KEEPALIVE_CHUNK);
}

export function createKeepaliveTimer(
  callback: () => void,
  intervalMs = 15_000,
): {
  start: () => void;
  stop: () => void;
} {
  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    start() {
      timer = setInterval(callback, intervalMs);
    },
    stop() {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run provider/bridge/keepalive.test.ts 2>&1`

- [ ] **Step 5: Commit**

```bash
git add provider/bridge/keepalive.ts provider/bridge/keepalive.test.ts
git commit -m "feat(bridge): add SSE keepalive heartbeat support"
```

---

### Task 8: Add invalid turn retry logic

**Files:**

- Create: `provider/bridge/retry.ts`
- Create: `provider/bridge/retry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { buildRetrySystemMessage } from "./retry.js";

describe("buildRetrySystemMessage", () => {
  it("produces a corrective retry system message", () => {
    const msg = buildRetrySystemMessage("object");
    expect(msg).toContain("invalid");
    expect(msg).toContain("tool");
    expect(msg).toContain("JSON");
  });

  it("produces different message for xml vs object bridge", () => {
    const objectMsg = buildRetrySystemMessage("object");
    const xmlMsg = buildRetrySystemMessage("xml");
    expect(objectMsg).not.toEqual(xmlMsg);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --run provider/bridge/retry.test.ts 2>&1`

- [ ] **Step 3: Port from NanoProxy `src/plugin.mjs` `buildInvalidBridgeRetryBuffer`**

The retry logic:

1. After the upstream stream completes, inspect the `NanoGptBridgeResult`
2. If `kind === "invalid_empty"`, build a retry system message
3. Append it to the messages array in the retry request body
4. Re-call `streamFn` with the modified payload (one retry only)
5. If retry also fails, emit an error notice to the stream

Adapt the system message content from NanoProxy's `buildInvalidBridgeRetryBuffer()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --run provider/bridge/retry.test.ts 2>&1`

- [ ] **Step 5: Commit**

```bash
git add provider/bridge/retry.ts provider/bridge/retry.test.ts
git commit -m "feat(bridge): add invalid turn retry logic"
```

---

## Decision Matrix

| Criterion               | A: `response_format`         | B: Parsers Only                               | C: Full Bridge                           |
| ----------------------- | ---------------------------- | --------------------------------------------- | ---------------------------------------- |
| Days of effort          | 1–2                          | ~7                                            | 21–28                                    |
| New files               | 0                            | 8                                             | 12+                                      |
| Tests                   | 2                            | 6                                             | 10+                                      |
| Risk                    | Low (just an experiment)     | Medium (SSE re-streaming is complex)          | High (many moving parts)                 |
| Reliability improvement | Unknown (needs testing)      | Moderate (better parsing, no protocol change) | High (bridge protocol + parsers + retry) |
| Structural limitation   | `tools` still sent alongside | `tools` still sent alongside                  | `tools` still sent alongside             |

**Bottom line:** If A works, done. If A partially works, combine A + B. If A fails completely, consider C but accept the degraded bridge quality.

---

## Plan Selection

Three plans saved:

1. `docs/superpowers/plans/2026-04-22-nanoproxy-bridge-alternatives.md` (this file) — contains all three

**To proceed, choose one:**

**Option 1 — Subagent-Driven (recommended):** I dispatch a fresh subagent per task, review between tasks, fast iteration

**Option 2 — Inline Execution:** Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
