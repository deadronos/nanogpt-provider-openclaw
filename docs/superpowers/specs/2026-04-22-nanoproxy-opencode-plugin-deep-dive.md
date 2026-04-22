# NanoProxy OpenCode Plugin — Deep Dive

**Date:** 2026-04-22
**Source:** [nanogpt-community/NanoProxy](https://github.com/nanogpt-community/NanoProxy) at `main` branch, accessed 2026-04-22
**Purpose:** Understand how NanoProxy's OpenCode plugin works and why it exists, as context for mapping its techniques to the OpenClaw plugin SDK.

---

## 1. What NanoProxy Is

NanoProxy is a **local proxy/bridge** between OpenAI-compatible coding clients (OpenCode, Roo Code, Kilo Code, Zed, Cline, etc.) and nano-gpt.com's API. It solves one specific problem: **nano-gpt's native tool calling is unreliable** — the model frequently returns malformed tool calls, empty tool-enabled responses, or inconsistent JSON structures.

Instead of relying on nano-gpt to correctly emit OpenAI-format `tool_calls` directly, NanoProxy:

1. Rewrites tool-enabled requests into a **stricter upstream bridge protocol** (object or XML)
2. Sends the rewritten request to nano-gpt
3. **Parses the model output incrementally** (even during streaming SSE)
4. Translates the bridge-format output back into standard OpenAI `content` + `reasoning` + `tool_calls`
5. Retries once if the response is an invalid empty bridge turn

NanoProxy also has a **native-first fallback** mode: for selected models (configurable via `BRIDGE_MODELS`), it first tries the normal tool-call request, and only falls back to bridging if the native response looks broken.

---

## 2. Why It Exists — The Core Problem

nano-gpt's tool calling reliability issues:

- Model returns empty tool-enabled responses (no visible content, no tool call)
- Model returns malformed `tool_calls` (bad JSON, wrong field shapes)
- Model ignores `tools` array and emits tool calls as prose/text instead
- Model emits tool calls inside markdown code fences rather than as structured fields

NanoProxy wraps around this by imposing a **stricter contract** on the model's output. Rather than asking nano-gpt to emit native `tool_calls` with all the structural requirements that implies, NanoProxy asks it to emit **one JSON object** (object bridge) or **XML tags** (XML bridge) — simpler, harder to get wrong, easier to parse reliably.

---

## 3. Bridge Protocols

NanoProxy supports two bridge protocols, selected by `BRIDGE_PROTOCOL` env var (defaults to `object`).

### 3.1 Object Bridge (default)

Asks the model to return **exactly one JSON object** per turn:

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

Fields:
- `v`: protocol version (must be 1)
- `mode`: `"tool"` | `"final"` | `"clarify"`
- `message`: user-facing assistant text
- `tool_calls`: array of tool call objects, required when `mode` is `"tool"`

The system prompt is built by `buildObjectBridgeSystemMessage()` in `object_bridge.js`. It:
- Lists all available tools with their schemas
- Explains the required JSON output contract in detail
- Emphasizes that **any prose outside the JSON object makes the response invalid**
- Handles the special case where `attempt_completion` tool exists (common in OpenCode's tool suite)
- Preserves any inherited system text

**Request transformation** (`transformRequestForObjectBridge`):
1. Normalizes the tools array to a simpler internal format
2. Builds the bridge system message
3. Translates conversation history: assistant tool calls become JSON strings, tool results become plain text
4. **Deletes** `tools`, `tool_choice`, `parallel_tool_calls` from the request body (the bridge replaces these)
5. Injects the bridge system message at the front of the message array

### 3.2 XML Bridge

Asks the model to emit tool calls as **XML tags** inside normal content:

```xml
<open>I will inspect the relevant files now.</open>
<read>
  <path>src/index.js</path>
</read>
```

Where:
- `<open>...</open>` carries visible user-facing text
- `<toolname>` emits a tool call for the named tool
- Tool arguments are child tags inside the tool tag

**System prompt** (`buildXmlBridgeSystemMessage`):
- Explains XML tool call format with examples
- Emphasizes the CRITICAL rules (exact XML format, no JSON tool calls, no markdown code fences)
- Includes concrete examples for each tool
- Includes a **batched example** when `parallel_tool_calls` is allowed

**Request transformation** (`transformRequestForXmlBridge`):
1. Normalizes tools
2. Builds XML bridge system message
3. Translates history: assistant tool calls become XML blocks, tool results become `[TOOL EXECUTION RESULT]` text
4. Deletes `tools`, `tool_choice`, `parallel_tool_calls`

---

## 4. How the Plugin Works (plugin.mjs)

NanoProxy registers itself as an OpenCode plugin by exporting `NanoProxyPlugin`. The plugin:

1. **Patches `globalThis.fetch`** — replaces the global fetch with a wrapper that intercepts requests going to `nano-gpt.com`
2. **Checks if request needs bridging** — only tool-enabled POST requests to nano-gpt are bridged
3. **Applies native-first logic** if `BRIDGE_MODELS=""` — tries native tool calling first, falls back to bridge on detected failure

### 4.1 Request interception

```js
globalThis.fetch = async function nanoproxyFetch(input, init, ...rest) {
  const urlStr = input instanceof Request ? input.url : String(input)
  if (!urlStr.includes("nano-gpt.com")) return originalFetch(input, init, ...rest)
  // ...
  if (method !== "POST") return originalFetch(input, init, ...rest)
  // Parse body, check if tool-enabled...
  if (!shouldBridgeImmediately) {
    // Try native first, check if response looks valid...
    if (acceptNativeSSE(...) || acceptNativeJson(...)) {
      return nativeResponse // pass through
    }
  }
  // Apply bridge transformation and send...
}
```

### 4.2 Native-first fallback detection

`acceptNativeSSE(status, streamText)` — examines SSE stream:
- Returns `true` if stream contains `tool_calls` in delta chunks
- Returns `true` if content doesn't look like XML tool payload or empty
- Otherwise falls back to bridge

`acceptNativeJson(status, payload)` — examines non-streaming JSON response:
- Returns `true` if `tool_calls` array present and non-empty
- Returns `true` if content is non-empty and doesn't look like an XML tool payload
- Otherwise falls back to bridge

### 4.3 Streaming response handling

The streaming path (`processStreamingResponse`) is the most complex part:

1. **Patches SSE stream** — reads the upstream SSE chunks, parses incrementally
2. **Uses `StreamingObjectParser` or `StreamingXmlParser`** — these parsers are state machines that:
   - For object bridge: scan the JSON buffer for `v`, `mode`, `message`, `tool_calls` keys and emit content/tool calls as they are completed
   - For XML bridge: character-by-character state machine detecting `<open>` tags, tool tags, and closing tags
3. **Emits synthetic SSE chunks** — as the parser completes content or tool calls, it writes new SSE chunks to the downstream response stream
4. **Handles invalid empty bridge turns** — if the stream ends with no content and no tool call (an invalid bridge response), it builds a retry request with a system message asking the model to produce valid output, and retries once
5. **Sends SSE keepalive heartbeats** — every 15 seconds of downstream silence, sends `: keepalive\n\n` comment frames to prevent client timeout

### 4.4 Non-streaming response handling

For non-streaming JSON responses:
1. Parses the full response with `buildAggregateFromChatCompletion`
2. Calls `buildBridgeResultFromText` which calls the appropriate bridge parser
3. If the result is `invalid` (empty tool turn), retries with modified system message
4. Wraps result in `buildChatCompletionFromBridge` to produce standard OpenAI-shaped response
5. Returns with `content-type: application/json`

---

## 5. Object Bridge Parser Details (StreamingObjectParser)

`StreamingObjectParser` is a state machine for incrementally parsing JSON turn objects during SSE streaming:

**State:**
- `buffer`: accumulated text from SSE chunks
- `mode`: `"tool"` | `"final"` | `"clarify"` | null
- `toolIndex`: next tool call index
- `completedCalls`: array of parsed tool calls
- `messageEmitted`: whether the `message` field has been emitted as content
- `toolCallsArrayStart` / `toolCallsCursor`: position tracking inside the `tool_calls` array
- `objectClosed`: whether the top-level `}` has been seen

**`_scanHeader()`** — after each buffer append:
- Checks first non-whitespace char is `{`
- Finds and validates `v` field (must be `1`)
- Finds and validates `mode` field (must be `"tool"`, `"final"`, or `"clarify"`)
- Finds and emits the `message` string (as content)
- If mode is `"tool"`, finds the start of the `tool_calls` array

**`_scanToolCalls()`** — after header scanned:
- Skips whitespace and commas
- Reads each `{...}` tool call object with `tryReadJsonObject`
- Normalizes the tool call with `normalizeObjectToolCall`
- Emits each completed call via `onToolCall` callback
- Tracks array closing `]` and object closing `}`

**`feed(text)`** — appends text, runs `_scanHeader()` then `_scanToolCalls()`
**`flush()`** — re-runs scans for any remaining data at end of stream

The parser is extremely careful about JSON parsing — it uses `tryReadJsonString` and `tryReadJsonObject` which manually scan the buffer character by character to find complete JSON values without calling `JSON.parse` on incomplete chunks.

---

## 6. Tool Call Normalization

Both bridges use a normalized internal tool format:

```ts
{
  name: string,
  description: string,
  args: Array<{
    name: string,
    type: string,
    description: string,
    schema: object
  }>,
  required: string[]
}
```

This is derived from the OpenAI `tools[]` format by `normalizeTools()`:
- Converts `tool.function.parameters` → flat `args[]` array
- Handles both `type: "function"` wrapped format and flat `{ name, description, parameters }` format
- Preserves schema, type, description, required list

Tool name resolution is case-insensitive and strips non-alphanumeric characters when matching (`canonicalizeToolName`).

---

## 7. Invalid Turn Recovery

When nano-gpt returns an invalid bridge turn (no visible content and no tool call), NanoProxy:

1. Builds a retry request with the same body plus a system message:
   - Object bridge: `"Your previous response was invalid because it contained no visible content or tool call. Return exactly one valid JSON turn object that matches the required bridge contract. Do not return an empty response."`
   - XML bridge: similar retry instruction adapted for XML format
2. Re-sends the retry request to nano-gpt
3. Parses the retry response

If the retry also fails, NanoProxy gives up and returns an error notice to the client.

---

## 8. Key Files Summary

| File | Role |
|------|------|
| `src/plugin.mjs` | OpenCode plugin entry — patches `globalThis.fetch`, routes requests through bridge, handles streaming/non-streaming responses |
| `src/core.js` | Request transformation, tool normalization, XML bridge parser, SSE helpers, bridge result builders |
| `src/object_bridge.js` | Object bridge system message builder, request/response transform, streaming JSON parser (`StreamingObjectParser`) |

---

## 9. Reliability Rules (from NanoProxy README)

- Bridge activates only for tool-enabled requests
- Requests without tools pass through unchanged
- Object bridge is the default; XML bridge available as alternative
- Bridged output is converted back into normal OpenAI-style response fields
- Invalid empty bridged turns trigger one retry
- Idle bridged SSE streams send keepalive comment frames
- `BRIDGE_MODELS` env var controls which models get native-first treatment

---

## 10. How It Differs from a Provider Plugin Approach

NanoProxy operates **below** the OpenAI API level — it's a network proxy that:
- Intercepts `fetch` calls at the network layer
- Rewrites request/response bodies
- Rewrites SSE streams byte by byte

This is fundamentally different from an OpenClaw provider plugin, which:
- Receives structured request objects (already parsed from the OpenClaw runner)
- Returns structured response objects (already assembled for the OpenClaw runner)
- Operates at the hook/handler level, not the network layer

The equivalent functionality in an OpenClaw provider plugin would need to:
- Use `wrapStreamFn` to intercept and rewrite streaming SSE responses
- Use a request-modifying hook (not currently exposed) to rewrite the request body before it reaches the transport
- Or use `createStreamFn` to provide a fully custom transport implementation

The good news: the **parsing logic** (tool normalization, bridge protocol parsing, invalid turn recovery) is entirely reusable — it just needs to be wired into OpenClaw hooks instead of a `globalThis.fetch` patch.
