# Response Format Config — Design

**Date:** 2026-04-22
**Status:** Approved
**Implementation:** Alternative A enhancement (configurable variant)

---

## Overview

Add `responseFormat` to `NanoGptPluginConfig` to control whether the plugin injects `response_format` into tool-enabled nano-gpt requests. Off by default — the feature is experimental and its effectiveness at improving tool-call reliability is unverified.

---

## Config Schema

```typescript
responseFormat?: false | "json_object" | { type: "json_schema"; schema?: Record<string, unknown> }
```

| Value                             | Injection                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `false` (default)                 | None                                                                                                                                  |
| `"json_object"`                   | `response_format: { type: "json_object" }`                                                                                            |
| `{ type: "json_schema", schema }` | `response_format: { type: "json_schema", json_schema: { schema } }` — schema defaults to the first tool's parameter schema if omitted |

---

## Behavior

- **Tool-enabled requests only** — non-tool requests are unaffected regardless of setting
- **No override** — if `response_format` is already present in the payload, the plugin does not replace it
- **Experimental** — whether `response_format` improves tool-call reliability when `tools` is also present is unverified; nano-gpt receives both directives simultaneously

---

## File Changes

| File                       | Change                                                                |
| -------------------------- | --------------------------------------------------------------------- |
| `models.ts`                | Add `responseFormat` to `NanoGptPluginConfig` interface               |
| `runtime/config.ts`        | Read and validate `responseFormat` from plugin config                 |
| `index.ts`                 | Pass `resolvedConfig.responseFormat` through to `wrapNanoGptStreamFn` |
| `provider/stream-hooks.ts` | Guard injection behind config check; support all three modes          |
| `README.md`                | Document new option under Text provider configuration                 |

---

## README Addition

Under `### Options` in the Text provider configuration section:

```typescript
responseFormat: false | "json_object" | { type: "json_schema"; schema?: Record<string, unknown> }
```

- `false` (default): no injection — nano-gpt receives native tool definitions as-is
- `"json_object"`: injects `response_format: { type: "json_object" }` for tool-enabled requests — nano-gpt returns valid JSON as `content`; parsing is the caller's responsibility
- `{ type: "json_schema", schema }`: injects `response_format: { type: "json_schema", json_schema: { schema } }` — `schema` is optional and defaults to the first tool's parameter schema

Only applies to tool-enabled requests. Only injected when not already present in the payload. Experimental: whether this improves tool-call reliability is unverified — nano-gpt receives both `response_format` and the native `tools` array simultaneously, and the interaction between the two is not yet tested.
