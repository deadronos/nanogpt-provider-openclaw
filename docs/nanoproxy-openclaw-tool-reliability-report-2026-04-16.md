# NanoProxy fit report for OpenClaw's NanoGPT plugin

**Date:** 2026-04-16  
**Question:** Are there NanoProxy ideas that are specifically useful for our OpenClaw integration and this plugin?  
**Short answer:** Yes. The most useful NanoProxy ideas are **structured bridge mode**, **one-shot retry for invalid empty tool turns**, **stronger salvage parsing**, and **better debug artifacts**. The catch is architectural: most of NanoProxy's value lives at the **transport/request-rewrite layer**, while this plugin currently only does **post-parse repair** on already-emitted tool-call events.

---

## Context map

### Local files most relevant to the comparison

| File                  | Why it matters                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`            | Registers the NanoGPT provider and wires in `wrapStreamFn`, tool normalization, and streaming compat hooks.                                    |
| `repair.ts`           | Current reliability layer: repairs malformed tool-call argument JSON after tool-call events already exist.                                     |
| `repair.test.ts`      | Shows the exact failure class currently covered: malformed or fenced/truncated tool-call arguments.                                            |
| `index.test.ts`       | Confirms repair is currently gated to Kimi-style models and that web-fetch aliasing is currently disabled.                                     |
| `provider-catalog.ts` | Shows this plugin mostly returns a `ModelProviderConfig`; it does not currently own NanoGPT request/response rewriting the way NanoProxy does. |
| `models.ts`           | Shows `NANOGPT_WEB_FETCH_TOOL_ALIAS` exists, but the alias model-id set is empty right now.                                                    |
| `README.md`           | Describes intended behavior, including a now-stale note about `web_fetch` aliasing.                                                            |

### External NanoProxy files inspected

| File                   | Why it matters                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `README.md`            | High-level design: object bridge, XML bridge, native-first fallback, retry policy.            |
| `src/core.js`          | Request rewriting, XML parsing, native-first acceptance heuristics, bridge result conversion. |
| `src/object_bridge.js` | Strict JSON-turn contract, object-mode parser, canonicalization, salvage logic.               |
| `src/plugin.mjs`       | OpenCode plugin transport interception, retry behavior, structured debug logging.             |
| `server.js`            | Standalone proxy implementation of the same bridge/retry/streaming ideas.                     |
| `selftest.js`          | Best source of concrete malformed payload cases NanoProxy intentionally supports.             |
| `issues/5`             | Confirms NanoProxy users also care about usage metadata in addition to tool reliability.      |

### Architectural constraint that matters most

From the current local code, this plugin's reliability hook is mainly:

- `index.ts` -> `wrapStreamFn`
- `repair.ts` -> `AssistantMessageEvent` repair after transport/parsing

That means the plugin currently improves cases where NanoGPT **already produced a tool call**, but the arguments were malformed. It does **not** currently perform the kind of request rewrite / raw response reparse / fallback bridging that NanoProxy uses.

---

## Current local baseline

The current plugin already has one useful reliability idea in place: **model-scoped JSON argument repair for Kimi-style models**.

Representative local snippet:

```ts
export function shouldRepairNanoGptToolCallArguments(modelId?: string): boolean {
  if (!modelId?.trim()) {
    return false;
  }
  const normalized = normalizeNanoGptRepairModelId(modelId);
  return normalized.startsWith("moonshotai/kimi");
}
```

And the actual repair strategy is intentionally narrow:

```ts
const repairedJson = jsonrepair(rawArgs);
const parsed = JSON.parse(repairedJson);
```

That is helpful when NanoGPT emits something like:

- truncated JSON arguments
- fenced JSON arguments
- arguments that failed the transport parser but still arrived as raw deltas

But it does **not** solve these broader failure classes:

- the model emits prose instead of tool calls
- the model emits a tool-enabled turn with no visible content and no tool call
- the model emits a near-valid tool payload that never becomes `toolcall_*` events
- the model mutates the envelope shape enough that the downstream parser never recognizes it as a tool call

There is also one important documentation/code mismatch worth noting:

- `README.md` still says Kimi models alias `web_fetch` to `fetch_web_page`
- `models.ts` currently has `const NANOGPT_WEB_FETCH_ALIAS_MODEL_IDS = new Set<string>([])`
- `index.test.ts` explicitly expects aliasing to be disabled

So the current repo state is **argument repair is real**, while **tool-name aliasing is currently disabled**.

---

## Which NanoProxy ideas are genuinely useful here?

## 1. Optional object-bridge mode is the biggest idea worth borrowing

**Usefulness:** High  
**Fit for OpenClaw:** High value, but **not** a drop-in for the current `wrapStreamFn` approach  
**Why it matters:** It solves the class of failures that the current plugin cannot touch.

NanoProxy's default strategy is to rewrite a tool-enabled request into a strict JSON-turn contract. The model is asked to emit exactly one object like:

```json
{
  "v": 1,
  "mode": "tool",
  "message": "I will inspect the relevant files now.",
  "tool_calls": [
    {
      "name": "read",
      "arguments": {
        "path": "src/index.js"
      }
    }
  ]
}
```

Representative NanoProxy rewrite snippet:

```js
const systemMessage = { role: "system", content: buildObjectBridgeSystemMessage(...) };
rewritten.messages = [systemMessage].concat(translatedMessages);
delete rewritten.tools;
delete rewritten.tool_choice;
delete rewritten.parallel_tool_calls;
```

Why this is useful for us:

- it does **not** depend on NanoGPT natively emitting OpenAI tool calls correctly
- it gives us a controlled envelope to parse
- it maps cleanly back to OpenAI-style `message.tool_calls`
- it directly addresses the failure mode where the model never emitted a valid tool call in the first place

Why it is **not** a drop-in port:

- this plugin currently returns a `ModelProviderConfig` in `provider-catalog.ts`
- its reliability hook in `repair.ts` runs **after** tool-call parsing has already happened
- NanoProxy's bridge needs control over the **request body** and the **raw upstream response**

### What this means for OpenClaw

If we want this behavior in this ecosystem, the cleanest fit is probably one of these:

1. an **optional lower transport hook** in the provider path
2. an **optional local sidecar/proxy mode** that the plugin can target
3. a future **OpenClaw runtime hook** that can rewrite tool-enabled requests before they leave the process

### Practical recommendation

If we only implement one larger NanoProxy idea, this should be the one.

---

## 2. One-shot retry for invalid empty tool turns is very worth borrowing

**Usefulness:** High  
**Fit for OpenClaw:** Good, if we gain access to the request/response body  
**Why it matters:** It is cheap, bounded, and directly targets a common "silent failure" shape.

NanoProxy treats this as a protocol failure:

- tool-enabled request
- no visible content
- no tool call

Representative NanoProxy snippet:

```js
if (bridgeResult.kind === "invalid" && attempt === 0) {
  activeResponse = await fetchUpstream(req, upstreamUrl, retryBuffer);
  continue;
}
```

And the retry prompt is deliberately narrow:

```js
"Your previous response was invalid because it contained no visible content or tool call. Return exactly one valid JSON turn object...";
```

Why this is useful for us:

- a single retry is low risk compared with unbounded repair loops
- it targets exactly the case where current `jsonrepair` cannot help
- it is especially relevant because our local reliability work is already model-scoped (`moonshotai/kimi*`)

### Recommended fit

If transport control becomes available, add a **single retry** only for:

- tool-enabled turns
- known-problem models
- responses that are structurally empty for tool use

That is a very sane reliability budget.

---

## 3. NanoProxy's salvage parser is broader than our current repair layer

**Usefulness:** High  
**Fit for OpenClaw:** Medium-to-high, but only if we can inspect raw model output  
**Why it matters:** NanoProxy is not just fixing JSON syntax; it is recovering meaning from several malformed-but-obvious payload shapes.

The current plugin repairs **tool arguments**. NanoProxy repairs **entire tool turns**.

Examples NanoProxy intentionally accepts or salvages (from `selftest.js` and `object_bridge.js`):

- fenced JSON object turns
- prose-wrapped object turns
- top-level tool-call arrays
- flattened tool-call arguments
- alternate envelope keys like `toolCalls`, `calls`, `actions`
- malformed batches with raw code strings and Windows paths
- legacy marker formats

Representative malformed shape that NanoProxy normalizes successfully:

```json
{
  "v": 1,
  "mode": "tool",
  "message": "Creating folders now.",
  "tool_calls": [
    {
      "name": "bash",
      "command": "mkdir -p src tests",
      "description": "Create folders"
    }
  ]
}
```

Representative salvage logic direction:

```js
const rawToolCalls = firstDefined(value, ["tool_calls", "toolCalls", "tools", "calls", "actions"]);
const toolCalls = normalizeToolCallsContainer(rawToolCalls);
```

And for malformed chunks:

```js
const normalized = normalizeObjectToolCall({ name: resolvedName, ...args }, knownToolMaps);
```

### Why this matters for our plugin

If NanoGPT is sometimes returning "almost tool calls" instead of fully valid ones, NanoProxy's salvage approach is much more aligned with the real failure surface than `jsonrepair(rawArgs)` alone.

### Limitation in our current architecture

This is only useful if we can access raw assistant content before or alongside downstream parsing. `wrapStreamFn` alone is too late for many of these cases.

---

## 4. Native-first with strict accept/reject heuristics is a good OpenClaw fit

**Usefulness:** Medium-high  
**Fit for OpenClaw:** Good  
**Why it matters:** Not every model needs heavy bridging all the time.

NanoProxy does something elegant:

- try native mode first for some models
- accept the native response only if it already looks structurally valid
- otherwise fall back to bridge mode

Representative logic from `core.js` / `plugin.mjs`:

```js
if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) return true;
return !shouldFallbackFromNativeText(message.content, choice.finish_reason);
```

And model selection is intentionally lightweight:

- bridge all tool-enabled requests by default, or
- bridge only matching model IDs via `BRIDGE_MODELS`, or
- try native-first for everyone else

### Why this maps well to our current plugin

We already have the concept of **model-scoped reliability handling**:

- Kimi models get argument repair
- other models do not

So a future bridge-mode design could naturally evolve into:

- native only
- native + argument repair
- native-first + fallback bridge
- bridge-always for known-problem models

That is a cleaner long-term shape than hard-coding one-off behavior forever.

---

## 5. Streaming incremental parsing is very relevant to OpenClaw UX

**Usefulness:** Medium-high  
**Fit for OpenClaw:** High if raw SSE is available  
**Why it matters:** Reliability should not come at the cost of turning streaming into a big blocking blob.

NanoProxy does two useful things here:

1. parse tool calls incrementally from the stream
2. after the full response arrives, recover any missed calls and emit them late if needed

Representative recovery pattern:

```js
if (recoveredCalls.length > parser.completedCalls.length) {
  for (const [offset, call] of recoveredCalls.slice(parser.completedCalls.length).entries()) {
    // emit recovered tool calls
  }
}
```

That is useful because it preserves responsive streaming while still giving the system a chance to salvage borderline outputs at the end.

### Why this matters here

OpenClaw benefits from fast incremental feedback. If we later add a bridge or raw-response salvage layer, this late-recovery pattern is worth copying.

---

## 6. Tool-name canonicalization and schema tolerance are small but practical wins

**Usefulness:** Medium  
**Fit for OpenClaw:** Good  
**Why it matters:** Some reliability failures are naming/envelope mismatches, not deep parser failures.

NanoProxy normalizes:

- `tool_calls`, `toolCalls`, `calls`, `actions`
- several mode synonyms (`tool`, `tools`, `action`, `call`, etc.)
- tool names using canonicalized matching
- both nested `arguments` objects and flattened argument fields

Representative snippets:

```js
if (
  ["tool", "tools", "tool_call", "tool_calls", "action", "actions", "call", "calls"].includes(
    normalized,
  )
)
  return "tool";
```

```js
function canonicalizeToolName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}
```

### Relevance to this repo

This is especially interesting because the repo still carries a `fetch_web_page` alias constant, but aliasing is currently disabled. NanoProxy's broader canonicalization logic is a stronger general pattern than a one-off alias.

### Practical takeaway

If we revisit tool naming quirks, prefer:

- a documented canonicalization or alias table
- test coverage for mutated tool names
- keeping README and code aligned

---

## 7. Debug artifacts are probably the easiest immediate operational win

**Usefulness:** High  
**Fit for OpenClaw:** High  
**Why it matters:** Tool-call reliability bugs are hard to reason about without raw evidence.

NanoProxy logs:

- rewritten request body
- raw streaming content
- reasoning content
- parsed tool calls
- retry attempts
- finish reasons
- invalid-empty notices

That is enormously helpful for diagnosing live model behavior.

### What seems immediately portable here

Even without a full bridge, this plugin could probably benefit from richer opt-in debug output for reliability events such as:

- model id
- request API (`completions` vs `responses`)
- tool name
- whether repair happened at `toolcall_end` or final message
- original raw argument length
- whether the final message still differed from incremental events
- whether the response ended with no recognized tool calls

### Important caution

Given OpenClaw plugin install-scanner behavior, any future logging implementation should be done carefully and intentionally rather than by scattering ad-hoc environment checks inside network-heavy modules.

---

## Things that are useful conceptually but not worth copying directly

### OpenCode fetch monkeypatch architecture

NanoProxy's `src/plugin.mjs` intercepts `globalThis.fetch` for OpenCode. That is clever in its own environment, but it is not the right abstraction to port verbatim into this OpenClaw provider plugin.

### Standalone server / Docker packaging

Useful for NanoProxy users, but not directly relevant to the plugin's core integration strategy.

### XML bridge as the first move

XML bridge is valuable as a fallback idea, but if we ever add a structured bridge here, **object bridge should come first** because:

- it maps more directly to OpenAI/OpenClaw tool-call structure
- it preserves argument objects more naturally
- it is easier to compare against current argument-repair work

---

## Things this repo already covers or partially covers

### Kimi-targeted reliability gating already exists

That is good. NanoProxy also thinks in terms of selective model handling (`BRIDGE_MODELS`), so the direction is aligned.

### Usage-related streaming compatibility work already exists here

NanoProxy issue #5 asks for usage metadata on chat requests. This repo already has **related** work in the form of `applyNativeStreamingUsageCompat`, so usage visibility is not a new topic here even though the exact transport details differ.

### Current repo work is a subset of NanoProxy's reliability surface

A fair summary is:

- **current plugin:** fixes malformed tool-call arguments for selected models
- **NanoProxy:** can recover from malformed or missing tool-call structure at the request/response protocol layer

That is the real difference.

---

## Recommended roadmap for this plugin

### Low-risk / high-value next steps

1. **Add structured debug artifacts** for repair and tool-call failure cases.
2. **Add failure-taxonomy tests** for cases beyond argument truncation:
   - empty tool-enabled turn
   - prose-wrapped tool payload
   - flattened tool arguments
   - fenced JSON tool turn
3. **Fix the README/code mismatch** around `web_fetch` aliasing, either by updating docs or re-enabling the behavior with fresh evidence.

### Medium-effort follow-ups

1. **Add model-scoped invalid-empty-turn retry** if transport control becomes available.
2. **Add raw-response salvage parsing** if OpenClaw exposes a lower transport hook or if we intentionally add a sidecar path.

### High-impact longer-term option

1. **Add optional object-bridge mode** for known-problem NanoGPT models.
2. **Keep XML bridge as a fallback experiment**, not the first implementation target.

---

## Example snippets side-by-side

### Current plugin: argument-only repair

```ts
if (!shouldRepairNanoGptToolCallArguments(repairModelId)) {
  return ctx.streamFn;
}
return wrapStreamWithToolCallRepair(ctx.streamFn, api.logger);
```

```ts
const repairedJson = jsonrepair(rawArgs);
const parsed = JSON.parse(repairedJson);
```

### NanoProxy: strict object-bridge rewrite

```js
const systemMessage = { role: "system", content: buildObjectBridgeSystemMessage(...) };
rewritten.messages = [systemMessage].concat(translatedMessages);
delete rewritten.tools;
delete rewritten.tool_choice;
delete rewritten.parallel_tool_calls;
```

### NanoProxy: invalid-empty retry

```js
if (bridgeResult.kind === "invalid" && attempt === 0) {
  activeResponse = await fetchUpstream(req, upstreamUrl, retryBuffer);
  continue;
}
```

### NanoProxy: flattened arguments still recovered

```json
{
  "v": 1,
  "mode": "tool",
  "message": "Creating folders now.",
  "tool_calls": [
    {
      "name": "bash",
      "command": "mkdir -p src tests",
      "description": "Create folders"
    }
  ]
}
```

NanoProxy turns that into a normal OpenAI-style tool call. The current plugin does not do this unless a valid downstream tool-call event already exists and only the argument JSON needs repair.

---

## Bottom line

NanoProxy is **highly relevant** to this repo, but mostly as a **blueprint for a deeper NanoGPT reliability layer**, not as a direct drop-in to the current `wrapStreamFn` repair path.

The most valuable ideas for OpenClaw + this plugin are:

1. **object-bridge fallback for known-bad models**
2. **one-shot retry for invalid empty tool turns**
3. **broader salvage parsing for near-valid tool payloads**
4. **structured debug artifacts for field failures**
5. **native-first plus selective bridge activation**

If we stay inside the current architecture, the best immediate wins are **better observability** and **broader failure-taxonomy tests**. If we are willing to add transport-level control or a sidecar/proxy option, **NanoProxy's object bridge becomes the main idea worth borrowing**.

---

## Sources inspected

### Local repository

- `index.ts`
- `repair.ts`
- `repair.test.ts`
- `index.test.ts`
- `provider-catalog.ts`
- `models.ts`
- `README.md`

### NanoProxy

- <https://github.com/nanogpt-community/NanoProxy>
- <https://github.com/nanogpt-community/NanoProxy/blob/main/README.md>
- <https://github.com/nanogpt-community/NanoProxy/blob/main/src/core.js>
- <https://github.com/nanogpt-community/NanoProxy/blob/main/src/object_bridge.js>
- <https://github.com/nanogpt-community/NanoProxy/blob/main/src/plugin.mjs>
- <https://github.com/nanogpt-community/NanoProxy/blob/main/server.js>
- <https://github.com/nanogpt-community/NanoProxy/blob/main/selftest.js>
- <https://github.com/nanogpt-community/NanoProxy/issues/5>
