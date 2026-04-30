# NanoProxy → OpenClaw: Comparison, Disagreements, and Consolidated Recommendations

**Date:** 2026-04-22
**Sources:**

- [2026-04-22-nanoproxy-opencode-plugin-deep-dive.md](2026-04-22-nanoproxy-opencode-plugin-deep-dive.md)
- [2026-04-22-nanoproxy-to-openclaw-hook-mapping.md](2026-04-22-nanoproxy-to-openclaw-hook-mapping.md)
  **Purpose:** Compare the two reports, resolve their disagreements, identify hidden tensions, and produce a single set of actionable recommendations for porting NanoProxy's reliability techniques to `nanogpt-provider-openclaw`.

---

## 1. Where the Two Reports Agree

Both reports are in full agreement on:

- NanoProxy's **core value proposition**: nano-gpt's native tool calling is unreliable; NanoProxy replaces it with a strict bridge protocol (object or XML) that nano-gpt produces correctly, then translates back to OpenAI format
- **What NanoProxy is**: a `globalThis.fetch` patch that intercepts nano-gpt traffic at the network layer, not a structured handler/plugin
- **The streaming SSE parsing** as the most complex and critical piece — `StreamingObjectParser` and `StreamingXmlParser` are state machines that scan incrementally and emit synthetic SSE chunks
- **Invalid turn retry** — one retry on empty bridge response, then give up and surface an error notice
- **Non-tool passthrough** — requests without tools should always pass through unchanged
- **SSE keepalive heartbeats** — 15-second downstream keepalive to prevent client timeout
- **Code license compatibility** — BSD-licensed code from the same org is reusable in this Apache-licensed plugin
- **`wrapStreamFn`** as the correct hook for the streaming SSE rewriting work
- **`normalizeToolSchemas`** as the correct hook for tool normalization
- The fundamental **layer mismatch**: NanoProxy operates at the network/fetch layer; OpenClaw plugins operate at the hook/handler layer

---

## 2. Where the Reports Disagree or Differ in Emphasis

### 2.1 System Prompt Injection — "Low" vs "Medium-High"

**Deep Dive (Report 1)** frames the bridge system prompt as a viable workaround:

> "The `transformSystemPrompt` equivalent could be used for system prompt injection"

**Hook Mapping (Report 2)** grades system prompt injection as **"Medium-High" feasibility**, with the caveat:

> "This works best when combined with request body rewriting (gap noted above)"

**Disagreement:** Report 2 correctly flags that without the ability to strip the `tools` array from the request, nano-gpt still receives native tool definitions alongside the bridge instructions — these two instructions **conflict**. The system prompt says "emit exactly one JSON object" but the `tools` array says "emit tool_calls structured fields." Which one wins? Report 1's framing understates this tension. Report 2's "Medium-High" with the gap caveat is the more accurate assessment.

**Resolution:** System prompt injection alone is **insufficient** as a standalone technique. It can only work if the `tools` array is also suppressed, which is the core structural gap (see 2.2).

---

### 2.2 Request Body Rewrite — "Gap" vs "Structural Gap"

**Deep Dive (Report 1)** notes in passing:

> "The equivalent functionality in an OpenClaw provider plugin would need to... use `createStreamFn` to provide a fully custom transport implementation"

And earlier:

> "For the OpenClaw plugin, the most relevant hooks are... `wrapStreamFn`"

**Hook Mapping (Report 2)** is more definitive, calling it a **"structural gap"** and identifying `createStreamFn` as the only way to do a full request rewrite, but noting it would require a complete transport replacement rather than a clean wrapper.

**Disagreement/Refinement:** Report 1's description of what "would need to be done" slightly undersells how invasive `createStreamFn` is. `createStreamFn` is not a wrapper — it's a complete replacement of the transport layer. NanoProxy's approach is a clean wrapper around the existing fetch; `createStreamFn` would mean reimplementing the entire OpenAI-compatible transport. Report 2's framing of this as a structural gap is more accurate. The practical implication: **the request body cannot be rewritten without replacing the entire transport**, which is not a realistic near-term option.

---

### 2.3 `transformRequestForObjectBridge` Reusability — Implicit vs Flagged

**Deep Dive (Report 1)** lists `transformRequestForObjectBridge` as part of `object_bridge.js` but does not call out that it has a **hard dependency on being able to rewrite the request body** (specifically: it deletes `tools`, `tool_choice`, `parallel_tool_calls` and prepends a system message to the messages array).

**Hook Mapping (Report 2)** lists `transformRequestForObjectBridge` in the code reuse section, but this is **misleading** — the function is not independently reusable. It:

1. Mutates the request body by deleting `tools`/`tool_choice`/`parallel_tool_calls`
2. Replaces the entire messages array with a rewritten version including the bridge system prompt

Both of these operations require a body rewrite hook that doesn't exist in OpenClaw. Porting `transformRequestForObjectBridge` would require nano-gpt to receive both the native `tools` array and the bridge system prompt simultaneously — a configuration that would likely cause degraded rather than improved results.

**Resolution:** `transformRequestForObjectBridge` and `transformRequestForXmlBridge` are **not independently reusable** in OpenClaw. Only the parsing side (parsers, result builders, SSE builders) is reusable. The request transformation functions are not.

---

### 2.4 Feasibility Grades Are Inconsistent Between Reports

Report 2 introduces a feasibility grading system (Low/Medium-High/Partial/Workaround/Gap). Applying those grades back to the full NanoProxy feature set reveals some inconsistencies in Report 2's own summary table:

| Feature                             | Report 2 Grade | Actual Grade                                                           |
| ----------------------------------- | -------------- | ---------------------------------------------------------------------- |
| Streaming object/XML bridge parsers | Low            | Low                                                                    |
| Tool normalization                  | Low            | Low                                                                    |
| Bridge system prompt injection      | Low            | **Medium** (conflicted by `tools` array presence)                      |
| SSE keepalive heartbeats            | Low            | Low                                                                    |
| Invalid turn retry                  | Medium         | **Low** (retry logic is entirely self-contained in the stream wrapper) |
| Non-tool passthrough                | Low            | Low                                                                    |
| Request body rewrite                | Gap            | Gap                                                                    |
| Native-first fallback               | Gap            | Gap                                                                    |

Report 2 grades "invalid turn retry" as **Medium** citing the body-rewrite gap for constructing the retry request, but the retry body construction actually just takes the original rewritten body and appends one more system message — it doesn't require stripping `tools` since the bridge request already has no `tools` field. However, since we can't apply the initial body rewrite, we can't get to the state where the retry is just "append a message." The retry logic itself is self-contained, but triggering it requires the bridge to be active, which requires the body rewrite. So "Medium" is actually fair.

---

### 2.5 What "Passthrough" Means for OpenClaw

Report 1 notes:

> "NanoProxy operates below the OpenAI API level... Non-tool requests pass through unchanged"

Report 2 says for OpenClaw:

> "Check `extraParams.tools?.length` in `wrapStreamFn` and passthrough if zero"

**Subtle disagreement:** In NanoProxy, passthrough means the request goes to nano-gpt **exactly as OpenClaw built it**, including the `tools` array if present. In OpenClaw, passthrough in `wrapStreamFn` means returning the original `streamFn` — but OpenClaw may have already included `tools` in the request body it built. There's no way in `wrapStreamFn` to actually see what the original request body looked like. The passthrough is only partial — we can skip bridge processing but we can't unsend the `tools` array.

**Resolution:** For OpenClaw, the only truly clean passthrough is non-tool requests (where `tools` was never included). For tool-enabled requests that we choose not to bridge, nano-gpt will still receive the native `tools` array. This is a meaningful difference from NanoProxy's behavior.

---

## 3. Hidden Tensions Not Explicitly Called Out

### 3.1 Bridge Instructions vs `tools` Array: Conflicting directives to nano-gpt

NanoProxy's bridge works because the bridge system prompt **completely replaces** tool usage with bridge protocol usage — `tools` is deleted, `tool_choice` is deleted. The model gets one instruction: "emit JSON object or XML." It is not told two different ways to emit tool calls.

In OpenClaw, even if we inject the bridge system prompt via `transformSystemPrompt`, OpenClaw will **also** send the `tools` array in the request body. nano-gpt receives two conflicting directives:

1. "Use the `tools` array to emit structured `tool_calls`" (from the `tools` param)
2. "Emit a JSON object with `mode`, `message`, `tool_calls`" (from the system prompt)

There is no OpenClaw hook to suppress the `tools` array for a specific request. This means any bridge implementation in OpenClaw is **intrinsically compromised** compared to NanoProxy — it can only work if nano-gpt happens to handle both directives gracefully.

**Implication:** The bridge will work _less well_ in OpenClaw than in NanoProxy. It may reduce the rate of empty/invalid tool responses but it won't eliminate them the way NanoProxy does.

### 3.2 `createStreamFn` Is Not a Clean Wrapper

Report 2 mentions `createStreamFn` as the only way to do full request body rewriting. But `createStreamFn` is a complete transport replacement — it receives raw parameters and must build and send the HTTP request itself. NanoProxy's fetch wrapper is a clean ~200-line overlay on top of `fetch`. `createStreamFn` would require reimplementing the entire OpenAI chat completion transport in the provider. This is a fundamentally different level of effort and maintenance burden.

**Implication:** `createStreamFn` is not a realistic path for this work. The structural gap is genuinely structural — it can't be worked around without either:

- A new OpenClaw hook for request body mutation (feature request to OpenClaw)
- Living with the degraded bridge (works but less reliably than NanoProxy)

### 3.3 `response_format` vs Bridge: An Unmentioned Alternative

Both reports discuss bridging as the solution to nano-gpt's unreliable tool calling. Neither report considers **`response_format: { type: "json_object" }`** — nano-gpt's native structured output feature — as an alternative or complement to the bridge.

The `response_format` feature (per the API docs) asks nano-gpt to return valid JSON rather than prose. This is **much simpler** than the bridge protocol — it doesn't require a system prompt overhaul, doesn't require history translation, and doesn't require a streaming parser that tracks JSON state across SSE chunks.

A `response_format` approach would:

- Set `response_format: { type: "json_object" }` on tool-enabled requests
- Let nano-gpt return a JSON object as `content`
- Parse the JSON from `content` and extract `tool_calls` from it

This is closer to what NanoProxy's object bridge does, but without the elaborate prompt engineering. Whether it works for tool calls specifically (vs. general JSON responses) depends on nano-gpt's API behavior, which neither report verifies.

**Implication:** Before implementing the full NanoProxy bridge, `response_format` should be tested as a simpler alternative. It may achieve 80% of the reliability improvement at 20% of the implementation cost.

---

## 4. Consolidated Assessment: What Can Actually Be Ported

| NanoProxy Component                                                            | Reusable in OpenClaw? | Caveat                                                                                         |
| ------------------------------------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------- |
| `StreamingObjectParser` (streaming JSON parser)                                | ✅ Yes                | Fully self-contained, no body rewrite dependency                                               |
| `StreamingXmlParser` (streaming XML parser)                                    | ✅ Yes                | Fully self-contained                                                                           |
| `buildObjectBridgeSystemMessage()`                                             | ✅ Yes                | But less effective without `tools` stripping                                                   |
| `buildXmlBridgeSystemMessage()`                                                | ✅ Yes                | But less effective without `tools` stripping                                                   |
| `normalizeTools()` (tool schema normalization)                                 | ✅ Yes                | Independent of request rewriting                                                               |
| `buildBridgeResultFromText()` / `buildBridgeResultFromObjectText()`            | ✅ Yes                | Independent of request rewriting                                                               |
| `buildChatCompletionFromObjectBridge()` / `buildChatCompletionFromXmlBridge()` | ✅ Yes                | Independent of request rewriting                                                               |
| `buildSSEFromObjectBridge()` / `buildSSEFromXmlBridge()`                       | ✅ Yes                | Independent of request rewriting                                                               |
| `buildAggregateFromChatCompletion()`                                           | ✅ Yes                | Independent of request rewriting                                                               |
| `acceptNativeSSE()` / `acceptNativeJson()`                                     | ✅ Yes                | Native-first fallback; useful if we can detect valid responses                                 |
| `transformRequestForObjectBridge()`                                            | ❌ No                 | Hard dependency on request body mutation (delete `tools`, prepend message)                     |
| `transformRequestForXmlBridge()`                                               | ❌ No                 | Same as above                                                                                  |
| `translateMessagesForObjectBridge()` / `translateMessagesForXmlBridge()`       | ❌ No                 | Depends on system message injection that requires body rewrite                                 |
| Invalid turn retry logic                                                       | ⚠️ Partial            | Retry decision is self-contained; retry body construction requires bridge state we can't build |

**Net: ~60% of NanoProxy's code is independently reusable. The core request transformation is not.**

---

## 5. Consolidated Recommendations

### Recommendation 1: Test `response_format` Before Building the Full Bridge

**Before any implementation work**, write a small test that sends tool-enabled requests with `response_format: { type: "json_object" }` and checks whether nano-gpt returns valid JSON that can be parsed into `tool_calls`. This is a 1–2 day experiment that could render the entire bridge unnecessary.

- If it works: `response_format` becomes the primary reliability mechanism, and bridging becomes a fallback for when `response_format` isn't supported or fails
- If it doesn't work: we know bridging is necessary and can proceed with the full implementation

**Risk if skipped:** Building the full bridge (3+ weeks) and then discovering `response_format` would have been simpler and equally effective.

---

### Recommendation 2: Implement the Streaming Parsers First — They're Self-Contained

The `StreamingObjectParser` and `StreamingXmlParser` are the most valuable and most self-contained pieces. They have **no dependency on the request body rewrite**. They can be implemented and tested independently.

Implementation order:

1. Port `StreamingObjectParser` and `StreamingXmlParser` to `provider/stream-hooks.ts` or a new `provider/bridge/` directory
2. Port `buildAggregateFromChatCompletion()`, `buildBridgeResultFromText()`, `buildSSEFromObjectBridge()`, `buildSSEFromXmlBridge()`
3. Wire them into `wrapNanoGptStreamFn` — for now, detect tool-enabled requests and use the parsers to **post-process** the SSE stream even without a bridge transformation (just extract tool calls from whatever nano-gpt returns)
4. Add SSE keepalive heartbeat injection

This gives immediate value: even without the bridge transformation, the streaming parsers can handle malformed nano-gpt responses better than the current stream processing.

---

### Recommendation 3: Accept the `tools` Array Conflict as a Known Limitation

The full NanoProxy bridge cannot be replicated without a request body rewrite hook. The best achievable approximation is:

- Inject the bridge system prompt via `transformSystemPrompt` alongside the native `tools` array
- nano-gpt receives both directives — it may follow the bridge prompt preferentially, reducing (but not eliminating) malformed tool calls

**Accept this limitation** and don't try to oversell the bridge as equivalent to NanoProxy's. Document it as "best-effort bridging — more reliable than native tool calling, but not as reliable as NanoProxy's full fetch-level bridge."

If this limitation is unacceptable, file a feature request with OpenClaw requesting a `prepareRequestBody` or `mutateRequestBody` hook that runs before the request is sent.

---

### Recommendation 4: Drop Native-First Fallback from Scope

Native-first fallback (NanoProxy's `BRIDGE_MODELS=""` mode) requires the ability to send one request, inspect the response, and retry with a different request. OpenClaw's hook surface doesn't support this pattern. Rather than implementing a degraded version, **drop it from scope entirely** and always use the bridge for tool-enabled requests (NanoProxy's default behavior when `BRIDGE_MODELS` is unset).

This simplifies the implementation significantly and matches the most reliable operating mode of NanoProxy.

---

### Recommendation 5: Add Configuration Surface

When implementing, add provider config options:

```ts
interface NanoGptBridgeConfig {
  /** Which bridge protocol: "object" (default) or "xml" */
  bridgeProtocol?: "object" | "xml";
  /** Whether to apply the bridge: "always" (default), "never", "auto" */
  bridgeMode?: "always" | "never" | "auto";
  /** Which models get native-first treatment when bridgeMode is "auto" */
  bridgeNativeFirstModels?: string[];
}
```

`bridgeMode: "never"` is useful for testing — allows disabling the bridge without uninstalling the plugin.

---

### Recommendation 6: Keep the Bridge Parsers Independent of OpenClaw Types

When porting the parsers, keep them as **pure functions** with no OpenClaw SDK dependencies. They should accept simple POJOs and return simple POJOs. This:

- Makes them unit-testable without the full OpenClaw test harness
- Allows future reuse if the approach is ported to another context
- Makes the code clearly traceable to the NanoProxy original

Store them in `provider/bridge/` as `object-parser.ts`, `xml-parser.ts`, `bridge-result.ts`.

---

## 6. Implementation Phasing

### Phase 1: Response Format Test (1–2 days)

Test `response_format: { type: "json_object" }` for tool-enabled requests. Determines whether bridging is even necessary.

### Phase 2: Streaming Parsers (1 week)

Port `StreamingObjectParser`, `StreamingXmlParser`, `buildSSEFromBridge`, `buildBridgeResultFromText`. Wire into `wrapNanoGptStreamFn`. Non-bridging post-processing mode — just better parsing of whatever nano-gpt returns.

### Phase 3: System Prompt Bridge Injection (3–5 days)

Port `buildObjectBridgeSystemMessage()` and `buildXmlBridgeSystemMessage()`. Wire into `transformSystemPrompt`. Add `bridgeProtocol` config. Document the `tools` array conflict as a known limitation.

### Phase 4: Retry Logic (2–3 days)

Add invalid turn retry inside the stream wrapper. Use the parsed bridge result to detect invalid turns. Build retry request using the original (unrewriteable) request body + appended retry system message.

### Phase 5: Configuration and Polish (2–3 days)

Add `bridgeMode` and `bridgeNativeFirstModels` config. Add tests. Add anomaly logging for bridge activations and invalid turns.

**Total estimated: 3–4 weeks** if all phases proceed. Phase 1 could invalidate or shorten later phases.

---

## 7. Open Questions

1. Does nano-gpt's `response_format: { type: "json_object" }` work correctly for tool-enabled requests? Does it reduce malformed tool calls? (Answering this is prerequisite to all other work)
2. Does nano-gpt support `response_format: { type: "json_schema", json_schema: {...} }` for tool calls specifically, or only for non-tool JSON responses?
3. Is there an OpenClaw hook (or can one be added) that allows request body mutation before transport? If yes, the full bridge is achievable.
4. Should the bridge be opt-in via config, or always-on for tool-enabled requests? (Recommendation: always-on, with `bridgeMode: "never"` for testing)
