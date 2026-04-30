# Plugin Provider Tool Call Rewriting — Pattern Reference

> **Purpose:** Document the established patterns a plugin provider can use to detect, rewrite, or proxy malformed tool calls.

---

## TL;DR Decision Tree

```
Tool schema structurally wrong?          → normalizeToolSchemas (provider hook)
Runtime tool call malformed?             → before_tool_call (general hook)
LLM output stream has bad tool calls?    → wrapStreamFn (provider) or llm_output (general hook)
Provider-specific encoding issues?      → model compat patches
Provider-specific codegen quirks?       → replay policy + wrapStreamFn
```

---

## Layer 1 — Tool Schema Normalization

**Hook:** `normalizeToolSchemas` (provider hook)  
**Stage:** Before OpenClaw registers tools with the embedded runner  
**What it fixes:** Structural problems in tool schema definitions (wrong types, unsupported keywords, nonconformant parameter shapes)

```typescript
// Provider plugin registers this on the provider object:
normalizeToolSchemas: (ctx: ProviderNormalizeToolSchemasContext) => {
  // ctx.tools is the full list of AnyAgentTool[]
  // Return the normalized list (or null/undefined to fall through to default)
  return ctx.tools.map((tool) => ({
    ...tool,
    parameters: normalizeParameters(tool.parameters),
  }));
};
```

The SDK exports helper families via `buildProviderToolCompatFamilyHooks("gemini")` which wires schema cleanup + diagnostics automatically for supported transport families.

**Diagnostics layer:** `inspectToolSchemas` runs after normalization and surfaces transport-specific warnings without teaching core about provider-specific keyword rules.

**Example providers using this:** Google (Gemini-safe schemas), xAI (HTML-entity argument decoding, unsupported schema keywords)

---

## Layer 2 — Runtime Tool Call Rewriting

**Hook:** `before_tool_call` (general plugin hook)  
**Stage:** Immediately before each tool call executes  
**What it fixes:** Individual malformed tool call params, blocking bad calls, injecting approval requirements

```typescript
api.registerHook({
  name: "before_tool_call",
  priority: 50, // higher runs first; results merge with last-defined wins
  handler: async (event, ctx) => {
    // event.params — the tool call params
    // event.toolName, event.toolCallId, event.args (parsed JSON)
    return {
      params: rewriteMalformed(event.params), // modified params
      block: false, // or true to block
      requireApproval: false, // or true to require user approval
    };
  },
});
```

**Merge policy:**

- `block` / `requireApproval` — first defined wins (fail-closed for blocking)
- `params` — last defined wins (higher-priority hooks cannot be overridden)

**Priority conflict:** If a higher-priority plugin sets params, lower-priority plugins cannot override them (frozen result).

---

## Layer 3 — LLM Output Stream Rewriting

**Hook:** `wrapStreamFn` (provider hook)  
**Stage:** On the raw response stream before OpenClaw parses tool calls from deltas  
**What it fixes:** Malformed tool calls embedded in LLM output, bad JSON in delta stream, thinking payload quirks

```typescript
// Provider plugin on the provider object:
wrapStreamFn: (ctx: ProviderCreateStreamFnContext) => {
  return async (transport, model, params, stream) => {
    // intercept and transform the stream
    return transformStream(stream, {
      rewriteToolCalls: (rawDelta) => {
        // fix malformed tool_call deltas before OpenClaw parses them
        return fixMalformedToolDelta(rawDelta);
      },
    });
  };
};
```

**Example providers:** Moonshot (thinking payload normalization), OpenRouter (reasoning injection), MiniMax (fast-mode rewrites)

---

## Layer 4 — LLM Output Hook (General)

**Hook:** `llm_output` (general plugin hook)  
**Stage:** After raw LLM output, before tool call parsing  
**What it fixes:** Provider-agnostic stream rewriting, injecting reasoning, patching model output

```typescript
api.registerHook({
  name: "llm_output",
  handler: async (event, ctx) => {
    // event.rawOutput — raw text
    // event.toolCalls — parsed tool calls
    // Return modified event or null to fall through
    return {
      rawOutput: rewriteBadToolCalls(event.rawOutput),
    };
  },
});
```

---

## Layer 5 — Model Compat Patches

**Mechanism:** `contributeResolvedModelCompat` + `normalizeResolvedModel` on the provider  
**Stage:** During model resolution, tags models with compat flags  
**What it fixes:** Provider-specific encoding issues, schema profiles, argument encoding quirks that require provider-aware handling throughout the pipeline

```typescript
// Provider plugin:
contributeResolvedModelCompat: (ctx: ProviderResolveDynamicModelContext) => {
  return resolveXaiModelCompatPatch(ctx.modelId);
  // Returns e.g. { toolSchemaProfile: "xai", toolCallArgumentsEncoding: "json-stringify" }
};

normalizeResolvedModel: (model) => {
  // Apply compat patch to the resolved model object
  return applyModelCompatPatch(model, resolveXaiModelCompatPatch(model.id));
};
```

The compat flags are extracted at runtime by `resolveToolCallArgumentsEncoding()` and `hasToolSchemaProfile()` in `provider-model-compat.ts`.

**Current compat flags:**

| Flag                            | What it controls                                               |
| ------------------------------- | -------------------------------------------------------------- |
| `toolSchemaProfile`             | Which provider-specific schema profile to apply (e.g. `"xai"`) |
| `toolCallArgumentsEncoding`     | How tool call args are encoded (`"json-stringify"`, etc.)      |
| `unsupportedToolSchemaKeywords` | Schema keywords the provider doesn't support                   |

**Example providers:** xAI heavily uses compat patches for schema profile + HTML-entity decoding. MiniMax uses `hybrid-anthropic-openai` replay family.

---

## Layer 6 — Replay Policy Families

**Mechanism:** `buildReplayPolicy` on the provider hooks  
**Stage:** During transcript replay (when re-sending conversation history to the LLM)  
**What it fixes:** Tool-call-id sanitation, assistant-first ordering, Gemini-turn validation, Claude-specific thinking block cleanup

| Family                    | Use case                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------- |
| `openai-compatible`       | OpenAI-compatible transports; tool-call-id sanitation, assistant-first fixes        |
| `passthrough-gemini`      | Gemini models through OpenAI-compatible proxy (OpenRouter, Kilocode, Opencode)      |
| `anthropic-by-model`      | Claude-only cleanup scoped to actual Claude ids                                     |
| `hybrid-anthropic-openai` | Mixed Anthropic + OpenAI surface; Claude-only thinking drops stay on Anthropic side |
| `google-gemini`           | Native Gemini replay validation, bootstrap sanitation, tagged reasoning output      |

**How to wire:**

```typescript
import { buildProviderReplayFamilyHooks } from "openclaw/plugin-sdk/provider-model-shared";

const MY_PROVIDER_HOOKS = {
  ...buildProviderReplayFamilyHooks({ family: "openai-compatible" }),
  // ... other hooks
};

api.registerProvider({
  id: "my-provider",
  // ...
  ...MY_PROVIDER_HOOKS,
});
```

---

## Priority / Precedence Summary

| Stage                    | Mechanism                                                  | Runs in         |
| ------------------------ | ---------------------------------------------------------- | --------------- |
| Tool schema registration | `normalizeToolSchemas`                                     | Provider init   |
| Model resolution         | `contributeResolvedModelCompat` + `normalizeResolvedModel` | Provider init   |
| Transcript replay        | `buildReplayPolicy` (replay family)                        | On replay       |
| LLM output (raw)         | `llm_output` hook                                          | Per message     |
| LLM output (stream)      | `wrapStreamFn`                                             | Per message     |
| Tool call execution      | `before_tool_call` hook                                    | Per tool call   |
| Tool result persist      | `tool_result_persist` hook                                 | Per tool result |

---

## Key Source Files

- `src/plugins/hooks.ts` — Hook runner with `before_tool_call` merge logic
- `src/plugins/types.ts` — Type definitions for all provider hooks
- `src/plugins/provider-model-compat.ts` — Compat extraction and patching
- `src/plugins/provider-runtime.ts` — Runtime hook dispatcher
- `src/agents/tool-policy.ts` — Tool call policy pipeline
- `src/agents/tool-policy-match.ts` — Tool matching logic
- `src/plugins/provider-model-compat.ts` — `hasToolSchemaProfile`, `resolveToolCallArgumentsEncoding`
- Docs: `docs/plugins/sdk-provider-plugins.md` — Provider plugin SDK guide

---

## Deep Dive — Provider-Specific Encoding and Replay System

### How the Compat Patch System Works

The compat patch system (`contributeResolvedModelCompat` + `normalizeResolvedModel`) lets a provider tag individual resolved models with flags that flow downstream into schema normalization, argument decoding, and replay policy.

**Flow:**

```
Model Resolution
  → plugin.contributeResolvedModelCompat({ model }) → ModelCompatConfig patch
  → plugin.normalizeResolvedModel(model) → applyCompatPatchToModel(model, patch)
  → normalized model carries compat flags
  → Runtime: resolveToolCallArgumentsEncoding(model) / hasToolSchemaProfile(model)
  → Tool schemas, stream transforms, and replay all read compat flags
```

**How it looks in practice (xAI):**

```typescript
// provider-tools.ts — resolveXaiModelCompatPatch()
export function resolveXaiModelCompatPatch(): ModelCompatConfig {
  return {
    toolSchemaProfile: "xai",
    unsupportedToolSchemaKeywords: ["minLength", "maxLength", "minItems", "maxItems", ...],
    nativeWebSearchTool: true,
    toolCallArgumentsEncoding: "html-entities",  // ← key flag
  };
}

// Provider plugin registers it via:
contributeResolvedModelCompat: (ctx) => resolveXaiModelCompatPatch(),
normalizeResolvedModel: (model) => applyModelCompatPatch(model, resolveXaiModelCompatPatch()),
```

**Current compat flags and what they do:**

| Flag                            | Extracted by                             | Effect                                                                                                                     |
| ------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `toolSchemaProfile`             | `hasToolSchemaProfile()`                 | Selects schema normalization profile (e.g. `"xai"` → strip xAI-unsupported keywords)                                       |
| `toolCallArgumentsEncoding`     | `resolveToolCallArgumentsEncoding()`     | Tells the embedded runner how to decode tool call args (e.g. `"html-entities"` → decode HTML entities before JSON-parsing) |
| `unsupportedToolSchemaKeywords` | `resolveUnsupportedToolSchemaKeywords()` | Set of JSON Schema keywords to strip from tool schemas                                                                     |
| `nativeWebSearchTool`           | `hasNativeWebSearchTool()`               | Provider handles web search natively                                                                                       |

The compat extraction is in `src/plugins/provider-model-compat.ts` — it walks the model object hierarchy to find compat configs attached at any level.

---

### How Tool Call IDs Are Sanitized

File: `src/agents/tool-call-id.ts`

`sanitizeToolCallId(id, mode)` rewrites tool call IDs to match provider requirements:

- **`"strict"` (default):** strips anything not `[a-zA-Z0-9]`. Empty result → `"sanitizedtoolid"`
- **`"strict9"`:** alphanumeric-only, truncated/padded to exactly 9 chars (Mistral requirement)

The mode is set via `toolCallIdMode: "strict" | "strict9"` in the replay policy. The OpenAI-compatible replay family sets `toolCallIdMode: "strict"` because many OpenAI-compatible proxies reject non-alphanumeric IDs.

**What calls it:** `repairToolUseResultPairing` in `session-transcript-repair.ts` — when a tool result's `toolCallId`/`toolUseId` is missing or invalid, it sanitizes the ID before inserting synthetic tool results.

---

### How Tool Use Result Pairing Works

File: `src/agents/session-transcript-repair.ts`

`repairToolUseResultPairing` ensures that every `assistant` tool call is **immediately followed** by its matching `toolResult`. This matters because:

- **Anthropic, Cloud Code Assist, MiniMax** reject entire requests if tool results are displaced or missing
- Session history can accumulate tool results out of order (e.g., after later user turns) or duplicated

**Algorithm:**

1. Walk messages in order
2. When you see an `assistant` with tool calls, expect tool results immediately after
3. If a `toolResult` is missing for a tool call ID → insert a synthetic error tool result
4. If a `toolResult` appears later in the transcript → move it to sit directly after its tool call turn
5. Drop duplicate tool results (same ID appearing twice)
6. Drop orphaned tool results that don't match any known tool call ID

**Result report includes:** added synthetic tool results, dropped duplicates, dropped orphans, whether any message was moved.

---

### How the Replay Policy System Integrates

File: `src/plugins/provider-replay-helpers.ts` + `src/agents/transcript-policy.ts`

**Policy resolution chain:**

```
resolveTranscriptPolicy(model)
  → resolveProviderRuntimePlugin(provider).buildReplayPolicy(context)
     → returns ProviderReplayPolicy (a config object, not a function)
  → mergeTranscriptPolicy(policy, basePolicy)
     → merges policy flags into DEFAULT_TRANSCRIPT_POLICY
```

**ProviderReplayPolicy flags and their effects:**

| Flag                                      | Effect                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------- |
| `sanitizeMode: "full"`                    | Full sanitize mode (vs `"images-only"` default). Enables aggressive cleanup. |
| `sanitizeToolCallIds: true`               | Run `sanitizeToolCallId()` on all tool call IDs                              |
| `toolCallIdMode: "strict"\|"strict9"`     | Which sanitization mode to apply                                             |
| `preserveNativeAnthropicToolUseIds: true` | Skip sanitization for IDs matching `toolu_[A-Za-z0-9_]+`                     |
| `repairToolUseResultPairing: true`        | Run `repairToolUseResultPairing()` on replay history                         |
| `preserveSignatures: true`                | Keep native provider-specific message signatures (Anthropic)                 |
| `validateGeminiTurns: true`               | Validate Gemini turn structure after replay                                  |
| `validateAnthropicTurns: true`            | Validate Anthropic message structure after replay                            |
| `applyAssistantFirstOrderingFix: true`    | Fix Google-assistant-first turn ordering issues                              |
| `dropThinkingBlocks: true`                | Strip thinking blocks from Claude messages on replay                         |
| `sanitizeThoughtSignatures`               | Strip Gemini thought signatures from replay                                  |
| `allowSyntheticToolResults: true`         | Allow insertion of synthetic error tool results                              |

**Built-in replay families:**

```typescript
// OpenAI-compatible (openai-completions, openai-responses, openai-codex-responses, azure-openai-responses)
buildOpenAICompatibleReplayPolicy(api)
→ sanitizeToolCallIds: true, toolCallIdMode: "strict"
→ For completions only: applyAssistantFirstOrderingFix: true, validateGeminiTurns: true, validateAnthropicTurns: true

// Strict Anthropic (Claude)
buildStrictAnthropicReplayPolicy({ dropThinkingBlocks?, sanitizeToolCallIds?, preserveNativeAnthropicToolUseIds? })
→ sanitizeMode: "full", sanitizeToolCallIds: true, repairToolUseResultPairing: true,
   preserveSignatures: true, validateAnthropicTurns: true, allowSyntheticToolResults: true

// Native Anthropic (preserve toolu_ IDs)
buildNativeAnthropicReplayPolicyForModel(modelId)
→ same as strict + preserveNativeAnthropicToolUseIds: true

// Google Gemini native
buildGoogleGeminiReplayPolicy()
→ sanitizeMode: "full", sanitizeToolCallIds: true, toolCallIdMode: "strict",
   sanitizeThoughtSignatures: { allowBase64Only: true, includeCamelCase: true },
   repairToolUseResultPairing: true, validateGeminiTurns: true


// Passthrough Gemini (proxy transports)
buildPassthroughGeminiSanitizingReplayPolicy(modelId)
→ only sanitizes thought signatures if modelId includes "gemini";
   no assistant-first ordering fix, no Gemini/Anthropic turn validation
```

---

### How xAI Handles HTML-Entity Encoded Tool Call Arguments

**Problem:** xAI's API returns tool call `arguments` as HTML-encoded JSON strings (e.g. `\&quot;name\&quot;` instead of `"`). Naive JSON parsing fails.

**Solution (xAI compat path):**

1. `resolveXaiModelCompatPatch()` sets `toolCallArgumentsEncoding: "html-entities"`
2. OpenClaw's embedded runner reads this flag when parsing tool call arguments
3. Before JSON-parsing, the raw arguments string is HTML-entity decoded → then JSON-parsed

**The actual decoding in the embedded runner:**

```typescript
// Reads toolCallArgumentsEncoding from model.compat
const encoding = resolveToolCallArgumentsEncoding(model);
if (encoding === "html-entities") {
  args = decodeHtmlEntities(args);
}
const parsed = JSON.parse(args);
```

The compat flag propagates from `resolveXaiModelCompatPatch()` → `contributeResolvedModelCompat` → `normalizeResolvedModel` → embedded runner at tool call parse time.

---

### How Schema Profiles Work (Gemini / xAI)

**Gemini profile** — via `buildProviderToolCompatFamilyHooks("gemini")`:

- `normalizeGeminiToolSchemas`: strips `GEMINI_UNSUPPORTED_SCHEMA_KEYWORDS` from all tool schemas recursively (`minLength`, `maxLength`, `minItems`, `maxItems`, `minContains`, `maxContains`, `contentEncoding`, `contentSchema`)
- `inspectGeminiToolSchemas`: finds violations and returns `ProviderToolSchemaDiagnostic[]`

**xAI profile** — via `stripXaiUnsupportedKeywords`:

- Uses `XAI_UNSUPPORTED_SCHEMA_KEYWORDS` (a superset including `minLength`, `maxLength`, etc.)
- Recursively strips these keywords from the full schema tree
- Applied via `normalizeToolSchemas` when `toolSchemaProfile === "xai"`

---

### How wrapStreamFn Rewrites Tool Calls in Flight

`wrapStreamFn` is the provider's stream interceptor. It wraps the transport layer around the LLM's raw response stream.

```typescript
wrapStreamFn: (ctx: ProviderCreateStreamFnContext) => {
  return async (transport, model, params, stream) => {
    // stream is an AsyncIterable of raw deltas
    // return a transformed stream
    return transformStream(stream, {
      onToolCallDelta: (rawDelta) => {
        // rawDelta may be malformed JSON, have HTML entities, wrong field names
        return fixAndNormalizeToolDelta(rawDelta);
      },
      onTextDelta: (rawDelta) => {
        return fixMalformedText(rawDelta);
      },
    });
  };
};
```

Real examples:

- **Moonshot:** transforms thinking payloads (binary format → structured thinking block)
- **OpenRouter:** injects reasoning into the stream
- **MiniMax:** rewrites fast-mode model output in stream

---

## Key Source Files (Deep Dive)

| File                                       | Purpose                                                                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `src/plugin-sdk/provider-tools.ts`         | `resolveXaiModelCompatPatch`, `buildProviderToolCompatFamilyHooks`, `stripUnsupportedSchemaKeywords`, HTML entity encoding constant |
| `src/plugins/provider-model-compat.ts`     | `hasToolSchemaProfile`, `resolveToolCallArgumentsEncoding`, `applyModelCompatPatch`                                                 |
| `src/plugins/provider-replay-helpers.ts`   | All `build*ReplayPolicy` helpers, `sanitizeGoogleGeminiReplayHistory`                                                               |
| `src/agents/transcript-policy.ts`          | `resolveTranscriptPolicy`, `mergeTranscriptPolicy`, policy resolution                                                               |
| `src/agents/session-transcript-repair.ts`  | `repairToolUseResultPairing`, `repairToolCallInputs`, `sanitizeToolCallInputs`                                                      |
| `src/agents/tool-call-id.ts`               | `sanitizeToolCallId`, `extractToolCallsFromAssistant`, `extractToolResultId`, modes                                                 |
| `src/plugins/types.ts`                     | `ProviderReplayPolicy`, `ProviderNormalizeToolSchemasContext`, all provider hook types                                              |
| `src/plugins/provider-runtime.ts`          | `applyProviderResolvedModelCompatWithPlugins`, `normalizeResolvedModelWithPlugin`, `inspectProviderToolSchemasWithPlugin`           |
| `src/agents/pi-embedded-helpers/google.js` | Google-specific model detection                                                                                                     |

## See Also

- [Provider Plugin SDK Docs](file:///Users/openclaw/Github/openclaw/docs/plugins/sdk-provider-plugins.md)
- [Plugin Internals Architecture](file:///Users/openclaw/Github/openclaw/docs/plugins/architecture.md)
- Hook types: `src/plugins/hook-types.ts`
- Replay families: `openclaw/plugin-sdk/provider-model-shared`
- Tool compat families: `openclaw/plugin-sdk/provider-tools`

<!-- Deep Dive Sections: compat patches, HTML-entity encoding, replay policy, schema profiles, wrapStreamFn -->
