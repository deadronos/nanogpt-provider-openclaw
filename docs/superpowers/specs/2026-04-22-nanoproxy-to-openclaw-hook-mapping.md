# Mapping NanoProxy Techniques to OpenClaw Plugin SDK

**Date:** 2026-04-22
**Sources:**
- NanoProxy: [nanogpt-community/NanoProxy](https://github.com/nanogpt-community/NanoProxy) `src/plugin.mjs`, `src/core.js`, `src/object_bridge.js`
- OpenClaw hooks: `docs/openclaw-provider-model-request-lifecycle-hooks-2026-04-16.md`
- This provider: `index.ts`, `provider/stream-hooks.ts`

**Purpose:** For each NanoProxy technique, identify the equivalent or closest OpenClaw provider hook, note gaps, and assess feasibility of porting the behavior to `nanogpt-provider-openclaw`.

---

## 1. Quick Reference: NanoProxy Techniques vs OpenClaw Hooks

| NanoProxy Technique | OpenClaw Hook(s) | Feasibility |
|---|---|---|
| Intercept outgoing request, rewrite body (inject bridge system prompt, strip tools) | `wrapStreamFn` (read-only on request) or `createStreamFn` (full replacement) | **Partial** — `wrapStreamFn` sees request info but doesn't allow body mutation before transport |
| Intercept upstream SSE stream, parse incrementally, emit rewritten SSE chunks | `wrapStreamFn` | **Good** — `wrapStreamFn` can return a wrapped stream function |
| Detect if native tool calling succeeded, fallback to bridge | `wrapStreamFn` + custom logic | **Partial** — must guess from response shape; no "try native then fallback" at request level |
| Invalid empty turn retry | No built-in retry hook | **Workaround** — retry logic lives entirely in the stream wrapper |
| Tool normalization from OpenAI format to bridge format | `normalizeToolSchemas` | **Good** — `normalizeToolSchemas` already exists |
| Build bridge system message (object/XML format instructions) | `resolveSystemPromptContribution` or `transformSystemPrompt` | **Good** — can inject bridge instructions into system prompt |
| Parse streaming JSON object bridge (`StreamingObjectParser`) | `wrapStreamFn` wraps SSE, can run parser internally | **Good** — same parser code, different wrapper |
| Parse streaming XML tool calls (`StreamingXmlParser`) | `wrapStreamFn` wraps SSE, can run parser internally | **Good** — same parser code, different wrapper |
| SSE keepalive heartbeat injection | `wrapStreamFn` | **Good** — can inject `: keepalive\n\n` frames in stream wrapper |
| Passthrough for non-tool requests | `wrapStreamFn` detects non-tool and returns original stream | **Good** — same pattern |
| Passthrough for non-nano-gpt URLs | Not applicable — plugin operates at fetch level | **N/A** — OpenClaw provider only handles nano-gpt |

---

## 2. Detailed Mapping

### 2.1 Request Interception and Body Rewrite

**NanoProxy does:**
- Intercepts `globalThis.fetch` calls to `nano-gpt.com`
- Parses the request body as JSON
- Rewrites it: strips `tools`/`tool_choice`/`parallel_tool_calls`, injects bridge system message at front of messages array, translates history

**OpenClaw equivalent:**
There is **no hook that mutates the request body before it is sent to the upstream API**. The hooks closest to this are:

- `prepareExtraParams` — merges extra params into the request params dict, but does not rewrite the body
- `createStreamFn` — provides a completely custom stream function, can build the entire request from scratch
- `wrapStreamFn` — wraps the stream function but is called after the request is already built

**Gap:** `createStreamFn` is the most powerful option but is a full replacement — NanoProxy's logic is cleanly layered as a wrapper around the existing transport, not a full replacement.

**Feasibility for nanogpt-provider-openclaw:** The most practical path is `wrapStreamFn` combined with storing the rewritten request metadata so the stream wrapper can handle the response appropriately. However, since `wrapStreamFn` only wraps the *stream function* (which produces the response), not the *request building*, NanoProxy's request-rewrite behavior cannot be directly replicated via the current hook surface.

Workaround: the **system prompt injection** (the bridge system message) can be done via `resolveSystemPromptContribution` or `transformSystemPrompt`. The tool stripping is the harder part — it requires nano-gpt to not receive `tools` in the request, which OpenClaw always sends for tool-capable models. This is a **structural gap**.

### 2.2 Streaming SSE Parsing and Rewriting

**NanoProxy does:**
- Reads upstream SSE chunks from nano-gpt
- Feeds text to `StreamingObjectParser` or `StreamingXmlParser`
- Emits synthetic SSE chunks downstream as content/tool calls are parsed
- Sends SSE keepalive heartbeats every 15 seconds

**OpenClaw equivalent:** `wrapStreamFn`

From the lifecycle docs, `wrapStreamFn`:
> "provider-owned wrapper around the chosen stream function — request/body/header mutation without replacing transport entirely"

It receives `extraParams`, `model`, and the base `streamFn`, and returns a wrapped stream function. The wrapped function can:
- Pass through non-streaming responses unchanged
- For streaming responses, return a `Response` with a `ReadableStream` body
- The `ReadableStream` can transform SSE chunks byte-by-byte

**Feasibility for nanogpt-provider-openclaw:** **High.** The `StreamingObjectParser` and `StreamingXmlParser` from NanoProxy can be ported directly into `provider/stream-hooks.ts` and invoked inside a `wrapStreamFn` wrapper. The wrapper reads upstream SSE, feeds the parser, and emits synthetic SSE to the downstream readable.

The `processStreamingResponse` function in NanoProxy's `plugin.mjs` is structurally very similar to what `wrapStreamFn` would produce.

### 2.3 Tool Normalization

**NanoProxy does:**
- Converts OpenAI `tools[]` format to internal normalized format (name, description, args[], required[])
- Used by both bridge protocols for building system messages and parsing responses

**OpenClaw equivalent:** `normalizeToolSchemas` and `inspectToolSchemas`

From the lifecycle docs:
> `normalizeToolSchemas` — rewrite tool schemas before registering them with the embedded runner
> `inspectToolSchemas` — emit diagnostics/warnings without requiring core to know provider-specific schema rules

**Feasibility for nanogpt-provider-openclaw:** **High.** The `normalizeTools()` function from NanoProxy's `core.js` can be ported to `provider/tool-schema-hooks.ts`. OpenClaw's existing `normalizeNanoGptToolSchemas` already does something similar — check if it can be enhanced or if the NanoProxy version offers additional normalization useful for the bridge.

### 2.4 System Prompt Bridge Instructions

**NanoProxy does:**
- Builds a bridge-specific system message (object bridge or XML bridge instructions)
- Injects it at the front of the messages array, replacing the original `tools[]` array

**OpenClaw equivalent:** `resolveSystemPromptContribution` or `transformSystemPrompt`

- `resolveSystemPromptContribution` — appends provider-owned prompt contribution before the full prompt is assembled
- `transformSystemPrompt` — rewrites the full system prompt after OpenClaw has assembled it

**Feasibility for nanogpt-provider-openclaw:** **Medium-High.** The bridge system message content (the contract instructions for the object/XML format) could be injected via `resolveSystemPromptContribution`. However, NanoProxy's system message is specifically designed to *replace* tool usage with bridge protocol usage — it's not a supplement but a replacement instruction set. This works best when combined with request body rewriting (gap noted above).

### 2.5 Invalid Turn Detection and Retry

**NanoProxy does:**
- Detects invalid bridge turns: no visible content AND no tool call
- Builds a retry request with a corrective system message appended to history
- Resends to nano-gpt once
- If retry fails, gives up and emits error notice to client

**OpenClaw equivalent:** No dedicated retry hook. Retry logic lives in the failover subsystem.

The failover hooks (`matchesContextOverflowError`, `classifyFailoverReason`) classify *why* a request failed, not whether the *response content* was invalid. There is no per-turn retry mechanism exposed to provider plugins.

**Feasibility for nanogpt-provider-openclaw:** **Workaround only.** The retry logic would have to live entirely inside `wrapStreamFn` — NanoProxy does the same (its retry is inside the fetch wrapper). The retry decision is based on `bridgeResult.kind === "invalid"` — this detection is part of the bridge result builder, which can be ported. The retry request body construction would face the same body-rewrite gap.

### 2.6 Native-First Fallback

**NanoProxy does:**
- For models in `BRIDGE_MODELS=""` (empty = native-first for all), sends the original tool-enabled request first
- Inspects the response: if SSE, calls `acceptNativeSSE`; if JSON, calls `acceptNativeJson`
- If the response looks valid (has tool_calls or non-broken content), passes it through unchanged
- If invalid, falls back to bridge transformation

**OpenClaw equivalent:** No equivalent hook. The provider plugin doesn't get a chance to "try native then decide" — the request is already built and sent.

`prepareExtraParams` is the closest but only modifies params, doesn't allow inspection-and-branch logic.

**Feasibility for nanogpt-provider-openclaw:** **Not directly feasible.** The native-first pattern requires intercepting the response before deciding whether to use it, which is a request-retry pattern OpenClaw doesn't expose. However, it could be approximated by:
1. Using a `wrapStreamFn` that always runs the bridge transformation
2. Abandoning native-first entirely (always bridge for tool-enabled requests, like NanoProxy's default mode when `BRIDGE_MODELS` is unset)

The simpler path that matches NanoProxy's default behavior: **always bridge tool-enabled requests**, skip native-first.

### 2.7 Non-Tool Request Passthrough

**NanoProxy does:**
- Checks `requestNeedsXmlBridge(body)` — returns true only if `tools` array is present and non-empty
- Non-tool requests pass through unchanged via `originalFetch`

**OpenClaw equivalent:** `wrapStreamFn` receives the `extraParams` which include whether tools are present. The wrapper can check `extraParams.tools?.length` and return the original `streamFn` unchanged if no tools.

**Feasibility for nanogpt-provider-openclaw:** **High.** Already possible today. Check `extraParams.tools?.length` in `wrapStreamFn` and passthrough if zero.

### 2.8 SSE Keepalive Heartbeats

**NanoProxy does:**
- Every 15 seconds of downstream silence, writes `: keepalive\n\n` to the SSE stream

**OpenClaw equivalent:** `wrapStreamFn` — the wrapped stream function controls the downstream `ReadableStream`.

**Feasibility for nanogpt-provider-openclaw:** **High.** The same timer logic from NanoProxy's `processStreamingResponse` can be ported into `wrapStreamFn` in `provider/stream-hooks.ts`.

---

## 3. Gap Analysis: What's Missing in OpenClaw's Hook Surface

| Gap | Impact | Workaround |
|-----|--------|------------|
| No hook to rewrite request body before transport | Can't strip `tools` array or inject bridge system message at the request level | Use `transformSystemPrompt` for system message injection only |
| No per-turn retry mechanism | Can't implement the "try native then bridge" pattern | Always bridge (NanoProxy default), skip native-first |
| `wrapStreamFn` sees `extraParams` but not the full built request body | Can't fully replicate NanoProxy's request inspection and rewrite | Store bridge context in closure alongside the wrapper |

---

## 4. Recommended Implementation Path

The most feasible approach for porting NanoProxy's reliability improvements to `nanogpt-provider-openclaw`:

### Phase 1: Streaming SSE Bridge (highest value, fully feasible)

In `provider/stream-hooks.ts`, extend `wrapNanoGptStreamFn` to:

1. **Detect tool-enabled requests** — check `extraParams.tools?.length > 0`
2. **Passthrough for non-tool requests** — return original `streamFn`
3. **For tool-enabled requests:**
   - Translate the tool schemas using NanoProxy's `normalizeTools()` logic (possibly enhanced)
   - Build the bridge system prompt using NanoProxy's `buildObjectBridgeSystemMessage()` or `buildXmlBridgeSystemMessage()`
   - Inject it via a modified `transformSystemPrompt` equivalent (or prepend to messages in the request rewrite if we can do it at the hook level)
   - Return a wrapped stream function that:
     - Reads upstream SSE chunks
     - Runs `StreamingObjectParser` (object bridge) or `StreamingXmlParser` (XML bridge) over the chunks
     - Emits synthetic SSE chunks downstream
     - Sends keepalive heartbeats every 15 seconds
     - Detects invalid empty turns and retries once

4. **Response translation** — `buildChatCompletionFromBridge` and `buildSSEFromBridge` from `object_bridge.js` can be directly ported and reused in the SSE wrapper

### Phase 2: System Prompt Bridge Injection

Use `resolveSystemPromptContribution` or `transformSystemPrompt` to prepend the bridge contract instructions to the system prompt. This tells nano-gpt to use the bridge format even if we're not stripping the `tools` array (since we can't fully rewrite the request body).

### Phase 3: Configuration Surface

Add provider config options:
- `bridgeProtocol: "object" | "xml"` — which bridge to use
- `bridgeEnabled: boolean | "auto"` — always bridge, never bridge, or auto (native-first with bridge fallback)
- `bridgeModels: string[]` — which models get native-first treatment (when `bridgeEnabled: "auto"`)

These map directly to NanoProxy's `BRIDGE_PROTOCOL`, absence of `BRIDGE_MODELS`, and `BRIDGE_MODELS` respectively.

---

## 5. Code Reuse Opportunities

The following NanoProxy functions are directly reusable ( BSD license from same org):

From `src/core.js`:
- `normalizeTools()` — tool schema normalization
- `buildObjectBridgeSystemMessage()` — object bridge system prompt builder
- `buildXmlBridgeSystemMessage()` — XML bridge system prompt builder
- `parseToolCallsFromText()` — XML tool call extraction
- `parseXmlAssistantText()` — XML bridge response parser
- `buildBridgeResultFromText()` — unified bridge result builder
- `buildAggregateFromChatCompletion()` — SSE/JSON → aggregate
- `acceptNativeSSE()` / `acceptNativeJson()` — native fallback detection

From `src/object_bridge.js`:
- `buildObjectBridgeSystemMessage()` — already listed
- `transformRequestForObjectBridge()` — request transformation
- `parseObjectBridgeAssistantText()` — object bridge response parser
- `StreamingObjectParser` — streaming JSON object parser
- `buildSSEFromObjectBridge()` — SSE response builder

The `globalThis.fetch` patching in `plugin.mjs` is **not reusable** — that technique is specific to OpenCode's plugin model. The equivalent in OpenClaw is `wrapStreamFn`.

---

## 6. Summary Table

| NanoProxy Feature | OpenClaw Hook | Porting Effort |
|---|---|---|
| Streaming object bridge parser | `wrapStreamFn` | Low — port `StreamingObjectParser` + SSE wrapper |
| Streaming XML bridge parser | `wrapStreamFn` | Low — port `StreamingXmlParser` + SSE wrapper |
| Tool normalization | `normalizeToolSchemas` | Low — port `normalizeTools()` |
| Bridge system prompt (object) | `transformSystemPrompt` | Low — port `buildObjectBridgeSystemMessage()` |
| Bridge system prompt (XML) | `transformSystemPrompt` | Low — port `buildXmlBridgeSystemMessage()` |
| SSE keepalive heartbeats | `wrapStreamFn` | Low — same timer pattern |
| Invalid turn retry | Inside `wrapStreamFn` | Medium — retry logic inside stream wrapper |
| Non-tool passthrough | `wrapStreamFn` | Low — check `extraParams.tools` |
| Request body rewrite (strip tools, inject bridge prompt) | None | **Gap** — `transformSystemPrompt` only, can't strip `tools` |
| Native-first fallback | None | **Gap** — not achievable with current hooks |
| URL-based request interception | None | **N/A** — provider only handles nano-gpt |

**Bottom line:** The streaming parsing, tool normalization, system prompt injection, and SSE rewriting are all readily mappable to `wrapStreamFn` + `normalizeToolSchemas` + `transformSystemPrompt`. The request body rewrite (stripping `tools` array) and native-first fallback are the two structural gaps that cannot be closed with the current OpenClaw hook surface.
