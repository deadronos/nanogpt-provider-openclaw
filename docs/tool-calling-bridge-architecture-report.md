# Tool-Calling Bridge Architecture for NanoGPT OpenClaw Provider

**Date:** 2026-04-22  
**Status:** Analysis Report — Implementation Feasible  
**Author:** Nova 🦊 (Research Agent)

---

## Executive Summary

NanoGPT's native tool-calling is unreliable. NanoProxy was built specifically to solve this by wrapping tool-enabled requests in a stricter bridge protocol upstream. This report analyzes how a NanoProxy-style tool-calling bridge could be adapted into the `nanogpt-provider-openclaw` extension, identifies the exact OpenClaw plugin hooks available for integration, and documents how the existing `kimi-coding` extension achieves a similar result through markup-based tool-call rewriting.

---

## Background: The NanoGPT Tool-Calling Problem

NanoGPT's native `tools`/`tool_choice` parameter support is notoriously unreliable for coding workloads. Symptoms include:

- Empty tool calls (no visible content, no `tool_calls`)
- Malformed JSON in `tool_calls` arguments
- Silent failures where the model ignores tool definitions entirely
- Inconsistent behavior across model families (GLM vs Kimi K2.5 vs Qwen)

**NanoProxy** (nanogpt-community/NanoProxy, MIT license) was built to solve this by acting as a local proxy that:

1. Intercepts tool-enabled requests
2. Rewrites them into a stricter bridge protocol (JSON object or XML)
3. Passes the bridge protocol to NanoGPT upstream
4. Parses the bridged response incrementally
5. Converts it back into standard OpenAI-style `tool_calls`

---

## Reference Implementations

### 1. NanoProxy — External Bridge Proxy

NanoProxy runs as a standalone server (`server.js`) and also as an OpenCode plugin (`plugin.mjs`). It supports two bridge protocols:

#### Object Bridge (Default)

NanoProxy injects a system message instructing NanoGPT to emit a single structured JSON turn object:

```json
{
  "v": 1,
  "mode": "tool",
  "message": "I will inspect the relevant files now.",
  "tool_calls": [
    {
      "name": "read",
      "arguments": { "path": "src/index.js" }
    }
  ]
}
```

#### XML Bridge (Alternative)

NanoProxy instructs NanoGPT to emit tool calls as XML tags inside normal content:

```xml
I will inspect the relevant files now.

<open>I will inspect the relevant files now.</open>
<read>
 <path>src/index.js</path>
</read>
```

#### Key NanoProxy Behaviors

| Behavior          | Detail                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Bridge activation | Only for tool-enabled requests; passthrough for non-tool requests                             |
| Streaming         | Preserves SSE streaming for visible content and reasoning; incrementally parses bridge output |
| Retry             | One automatic retry for the specific "empty turn" failure (no content + no tool call)         |
| Native fallback   | `BRIDGE_MODELS=""` env var enables native-first mode with fallback to bridge                  |
| Keepalive         | Idle bridged SSE streams send comment frames to prevent client timeout                        |
| Logging           | Structured session logs; raw request/response artifacts on demand                             |

#### Source Files (MIT Licensed)

```
NanoProxy/
├── src/
│   ├── core.js          # Bridge decision logic, XML bridge, SSE parsing
│   ├── object_bridge.js # Object bridge protocol, system message builder, streaming parser
│   └── plugin.mjs       # OpenCode plugin entry, fetch patch, retry logic
├── server.js             # Standalone server
└── selftest.js           # Node --check + functional self-test
```

---

### 2. kimi-coding — OpenClaw Extension with Tool-Call Rewriting

The `kimi-coding` extension (bundled with OpenClaw at `extensions/kimi-coding/`) demonstrates how OpenClaw's plugin SDK hooks can achieve tool-call rewriting without an external proxy. This is the most directly relevant reference for the NanoGPT bridge adaptation.

#### Architecture

The kimi-coding extension uses two separate wrappers composed together:

```typescript
export function wrapKimiProviderStream(ctx: ProviderWrapStreamFnContext): StreamFn {
  const thinkingType = resolveKimiThinkingType({ ... });
  return createKimiToolCallMarkupWrapper(
    createKimiThinkingWrapper(ctx.streamFn, thinkingType)
  );
}
```

#### Wrapper 1: `createKimiThinkingWrapper`

Uses `streamWithPayloadPatch` to inject `thinking: { type: "enabled" | "disabled" }` into the upstream request payload, removing conflicting `reasoning`/`reasoning_effort` fields.

```typescript
export function createKimiThinkingWrapper(
  baseStreamFn: StreamFn | undefined,
  thinkingType: KimiThinkingType,
): StreamFn {
  return (model, context, options) =>
    streamWithPayloadPatch(underlying, model, context, options, (payloadObj) => {
      payloadObj.thinking = { type: thinkingType };
      delete payloadObj.reasoning;
      delete payloadObj.reasoning_effort;
      delete payloadObj.reasoningEffort;
    });
}
```

**Hook used:** `streamWithPayloadPatch` from `openclaw/plugin-sdk/provider-stream-shared`

#### Wrapper 2: `createKimiToolCallMarkupWrapper`

Uses `wrapStreamMessageObjects` to intercept and rewrite the streaming response. Kimi emits tool calls as tagged markup text:

```
<|tool_calls_section_begin|>
<|tool_call_begin>read:1<|tool_call_argument_begin|>{"path":"src/index.js"}<|tool_call_end|>
<|tool_calls_section_end|>
```

The parser (`parseKimiTaggedToolCalls`) extracts these into structured `KimiToolCallBlock` objects, then `rewriteKimiTaggedToolCallsInMessage` transforms the message content array by replacing `text` blocks with `toolCall` blocks and changing `stopReason` from `"stop"` to `"toolUse"`.

**Hook used:** `wrapStreamMessageObjects` from `openclaw/plugin-sdk/provider-stream-shared`

#### Kimi Coding Tool-Call Tags

| Tag | Meaning                  |
| --- | ------------------------ | ----------------------------------------------- | -------------------------- |
| `<  | tool_calls_section_begin | >`                                              | Start of tool-call section |
| `<  | tool_calls_section_end   | >`                                              | End of tool-call section   |
| `<  | tool_call_begin>`        | Start of individual tool call (name:id follows) |
| `<  | tool_call_argument_begin | >`                                              | Start of JSON arguments    |
| `<  | tool_call_end            | >`                                              | End of tool call           |

#### Key Differences from NanoProxy

| Aspect               | NanoProxy                           | kimi-coding                          |
| -------------------- | ----------------------------------- | ------------------------------------ |
| Scope                | External proxy (separate process)   | In-process via OpenClaw plugin hooks |
| Protocol             | JSON object bridge or XML           | Kimi's native tagged markup format   |
| Request modification | Rewrites upstream request entirely  | Injects `thinking` param only        |
| Response parsing     | Incremental SSE parsing + retry     | Stream message object rewriting      |
| Deployment           | Standalone server + OpenCode plugin | OpenClaw built-in extension          |

---

## OpenClaw Plugin Hooks for Bridge Integration

The `nanogpt-provider-openclaw` extension already has the hook infrastructure in place. The following hooks in `index.ts` are available for bridge integration:

### Hook 1: `wrapStreamFn` — Stream Response Transformation

**Current behavior:** Passes through to `wrapNanoGptStreamFn` which does anomaly logging only.

**Bridge integration point:**  
`provider/stream-hooks.ts` — `wrapNanoGptStreamFn()` would return a wrapped `StreamFn` that:

1. Intercepts the streaming response
2. Applies NanoProxy-style incremental JSON or XML parsing
3. Converts bridge output back into OpenAI `tool_calls` format
4. Handles the empty-turn retry case

**Signature:**

```typescript
wrapStreamFn: (ctx: ProviderWrapStreamFnContext) => StreamFn | undefined;
```

**NanoProxy pattern to adapt:**

- `StreamingObjectParser` from `src/object_bridge.js`
- `buildBridgeResultFromObjectText()` — converts parsed bridge text to `tool_calls`
- `buildSSEFromObjectBridge()` — builds SSE stream from bridge chunks
- Retry logic from `plugin.mjs` (`buildInvalidBridgeRetryBuffer`)

---

### Hook 2: `normalizeToolSchemas` — Request-Time Tool Modification

**Current behavior:** Adds GLM/Qwen-specific hints to tool descriptions.

**Bridge integration point:**  
`provider/tool-schema-hooks.ts` — could return an additional `systemMessage` contribution that injects the bridge protocol instructions.

**NanoProxy pattern to adapt:**

- `buildObjectBridgeSystemMessage()` from `src/object_bridge.js` — generates the system prompt instructing NanoGPT to emit bridge format

---

### Hook 3: `streamWithPayloadPatch` — Upstream Request Transformation

**Current state:** Not used in nanogpt-provider-openclaw; re-exported from `openclaw/plugin-sdk/provider-stream-shared` (line 425 of `provider-stream-shared.ts`). The SDK helper `createPayloadPatchStreamWrapper` wraps it in a `StreamFn` factory pattern — identical to how kimi-coding's `createKimiThinkingWrapper` uses it.

**Bridge integration point:**  
`streamWithPayloadPatch` is available for use inside `wrapStreamFn` composition. However, it can only **add or modify** payload fields — it **cannot remove** existing fields. Specifically:

- ✅ Inject bridge system message content into the `messages` array via `onPayload`
- ❌ **Cannot** strip `tools`/`tool_choice`/`parallel_tool_calls` from the payload

This means the full NanoProxy bridge cannot be replicated: nano-gpt would receive both the native `tools` array AND the bridge system message instructions — two conflicting directives. The achievable approximation is a **best-effort bridge** where the bridge prompt coexists with the `tools` array.

**kimi-coding vs nanogpt-provider architecture:**

- kimi-coding uses `createKimiThinkingWrapper(streamFn, thinkingType)` which returns a `StreamFn` factory — compositional
- nanogpt-provider's `wrapNanoGptStreamFn` receives `ctx.streamFn` (a `StreamFn`) and wraps it inline — same capability, different wrapping style
- nanogpt-provider's existing `ensureIncludeUsageInStreamingPayload` demonstrates the same `onPayload` interception pattern in action (lines 539-554 of `provider/stream-hooks.ts`)

---

## Recommended Implementation Plan

### Phase 1: Bridge Stream Wrapper (Medium Effort, High Impact)

Implement `createNanoGptToolBridgeWrapper()` in `provider/stream-hooks.ts`:

1. Add `enableToolBridge: boolean` config option to `NanoGptPluginConfig`
2. Add `NANOGPT_BRIDGE_PROTOCOL=object|xml` env var support
3. Add `NANOGPT_BRIDGE_MODELS` env var (comma-separated, substring match — mirrors NanoProxy)
4. Implement incremental JSON parser for streaming responses
5. Implement retry logic for empty-turn failure case
6. Wire into `wrapStreamFn` under the config flag

**New files:**

- `provider/bridge/object-bridge.ts` — adapted from NanoProxy's `object_bridge.js`
- `provider/bridge/xml-bridge.ts` — adapted from NanoProxy's XML handling in `core.js`

### Phase 2: Bridge System Message Injection (Low Effort)

Implement `buildNanoGptBridgeSystemMessage()` and call it from `normalizeToolSchemas` or via `streamWithPayloadPatch`. This removes NanoGPT's native `tools` parameter and replaces it with a structured bridge protocol instruction.

### Phase 3: Debug Logging (Low Effort)

Mirror NanoProxy's structured logging:

- Session log per run in `~/.openclaw/extensions/nanogpt/Logs/`
- Raw request/response artifacts subdirectory
- `NANOGPT_DEBUG=1` env var + `.debug-logging` flag file support

### Phase 4: Self-Test Suite (Low Effort)

Mirror NanoProxy's `selftest.js`:

- `node --check` on all compiled output
- API connectivity dry-run (`/models` endpoint)
- Auth config validation

---

## Comparison Table

| Feature                 | NanoProxy            | kimi-coding | NanoGPT Bridge (Proposed) |
| ----------------------- | -------------------- | ----------- | ------------------------- |
| Runs in-process         | ❌ (separate server) | ✅          | ✅                        |
| OpenClaw native         | ❌                   | ✅          | ✅                        |
| JSON object bridge      | ✅                   | ❌          | ✅ (adapt from NanoProxy) |
| XML bridge              | ✅                   | ❌          | ✅ (adapt from NanoProxy) |
| Tagged markup parsing   | ❌                   | ✅          | ❌                        |
| Incremental SSE parsing | ✅                   | ✅          | ✅                        |
| Retry on empty turn     | ✅                   | ❌          | ✅                        |
| Native-first fallback   | ✅                   | N/A         | ✅                        |
| Debug logging           | ✅                   | Limited     | ✅                        |
| Self-test suite         | ✅                   | ❌          | ✅                        |
| Docker support          | ✅                   | N/A         | Optional                  |

---

## Reusable NanoProxy Components (MIT License)

NanoProxy is MIT licensed. The following components can be studied and adapted:

1. **System message templates** — `buildObjectBridgeSystemMessage()` generates the prompt instructing NanoGPT on the bridge format
2. **JSON turn schema** — The `{ v, mode, message, tool_calls }` structure is simple and well-documented
3. **Streaming parser state machine** — `StreamingObjectParser` in `object_bridge.js` handles incremental JSON parsing of SSE streams
4. **Retry buffer builder** — `buildInvalidBridgeRetryBuffer()` in `plugin.mjs` constructs the retry request with corrective system prompt
5. **SSE keepalive** — Comment frame (`// keepalive`) injection for idle streams

---

## Files Referenced

### NanoProxy (External)

- `src/core.js` — Bridge decision logic, XML bridge, SSE parsing utilities
- `src/object_bridge.js` — Object bridge protocol, system message builder, streaming parser
- `src/plugin.mjs` — OpenCode plugin entry, fetch patch, retry logic
- `server.js` — Standalone server implementation
- `selftest.js` — Self-test suite

### kimi-coding (OpenClaw Built-in)

- `extensions/kimi-coding/index.ts` — Plugin entry, `wrapKimiProviderStream`
- `extensions/kimi-coding/stream.ts` — `createKimiToolCallMarkupWrapper`, `createKimiThinkingWrapper`

### nanogpt-provider-openclaw (This Extension)

- `index.ts` — Plugin entry, hook registration
- `provider/tool-schema-hooks.ts` — `normalizeToolSchemas`, `inspectToolSchemas`
- `provider/stream-hooks.ts` — `wrapNanoGptStreamFn` (currently pass-through)

---

## Conclusion

The nanogpt-provider-openclaw extension is architecturally ready for a NanoProxy-style tool-calling bridge. The hook infrastructure (`wrapStreamFn`, `normalizeToolSchemas`, `streamWithPayloadPatch`) is in place, and the kimi-coding extension proves that OpenClaw's plugin SDK is sufficient for implementing stream-transforming tool-call rewriting without an external proxy.

The recommended approach is to start with Phase 1: implement the bridge stream wrapper using adapted NanoProxy patterns, gated behind a config flag. This preserves the current behavior for non-tool requests while enabling reliable tool-calling for models that need it.

---

_Report generated by Nova 🦊 — Research Agent_
_Extension: nanogpt-provider-openclaw_
_OpenClaw repo: ~/Github/openclaw_
