# NanoGPT Error Surface Mapping for Issue #85

Date: 2026-04-21

Related issue: [#85](https://github.com/deadronos/nanogpt-provider-openclaw/issues/85)

## Scope

This note compares:

- NanoGPT's documented error surface
- the current `nanogpt-provider-openclaw` error handling
- the OpenClaw SDK/runtime failure buckets we can target today

The goal is to answer two questions:

1. Are we classifying NanoGPT failures granularly enough?
2. If not, how should NanoGPT statuses/types/codes map into OpenClaw failover paths?

## Short answer

Not yet.

The plugin currently does **not** parse NanoGPT's documented `error.type`, `error.code`, `param`, `Retry-After`, or SSE mid-stream error frames on the inference path. It mostly relies on OpenClaw's generic failover classifier plus one NanoGPT-specific warning in [`index.ts`](../index.ts) that treats any `402`-looking error as a billing event for logging purposes.

That means:

- classification is only as good as the raw error text OpenClaw happens to receive
- plugin logging is **too generic** for issue #85
- a NanoGPT error that is really a transient quota/rate-limit shape can still be logged as "billing"
- we are leaving documented NanoGPT machine-readable codes unused

## Sources consulted

NanoGPT docs:

- [Error Handling](https://docs.nano-gpt.com/api-reference/miscellaneous/error-handling)
- [Rate Limits](https://docs.nano-gpt.com/api-reference/miscellaneous/rate-limits)
- [Provider Selection](https://docs.nano-gpt.com/api-reference/miscellaneous/provider-selection)
- [Chat Completion](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion)

Plugin repo:

- [`index.ts`](../index.ts)
- [`runtime.ts`](../runtime.ts)
- [`provider-catalog.ts`](../provider-catalog.ts)
- [`docs/openclaw-provider-model-request-lifecycle-hooks-2026-04-16.md`](./openclaw-provider-model-request-lifecycle-hooks-2026-04-16.md)

OpenClaw source:

- `~/Github/openclaw/src/plugins/types.ts`
- `~/Github/openclaw/src/plugins/provider-runtime.ts`
- `~/Github/openclaw/src/agents/pi-embedded-helpers/errors.ts`
- `~/Github/openclaw/src/agents/pi-embedded-helpers/provider-error-patterns.ts`
- `~/Github/openclaw/src/agents/pi-embedded-helpers/types.ts`
- `~/Github/openclaw/src/commands/models/list.probe.ts`
- `~/Github/openclaw/src/agents/failover-policy.ts`
- `~/Github/openclaw/src/agents/pi-embedded-runner/run/failover-policy.ts`

Installed OpenClaw spot-check:

- `node_modules/openclaw/dist/plugin-sdk/src/plugins/types.d.ts`
- `node_modules/openclaw/dist/plugin-sdk/src/plugins/provider-runtime.d.ts`

## NanoGPT documented error surface

### Error envelopes

NanoGPT documents three common shapes:

1. OpenAI-compatible:

```json
{
  "error": {
    "message": "Human-readable error message",
    "type": "invalid_request_error",
    "code": "missing_required_parameter",
    "param": "model"
  }
}
```

2. Anthropic-compatible (`/api/v1/messages`):

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "max_tokens is required",
    "param": "max_tokens"
  }
}
```

3. Legacy/simple:

```json
{ "error": "Insufficient balance", "status": 402 }
```

### Documented status meanings

| HTTP          | NanoGPT meaning                     | Retry guidance from docs          |
| ------------- | ----------------------------------- | --------------------------------- |
| `400`         | Invalid request / validation failed | No                                |
| `401`         | Missing or invalid API key          | No                                |
| `402`         | Insufficient balance                | No                                |
| `403`         | Authenticated but not permitted     | No                                |
| `404`         | Resource not found                  | No                                |
| `408` / `504` | Timeout                             | Yes                               |
| `409`         | Conflict                            | No                                |
| `413`         | Payload too large                   | No                                |
| `429`         | Rate limited                        | Yes; use `Retry-After` if present |
| `500`         | Server error                        | Yes                               |
| `503`         | Temporarily unavailable             | Yes                               |

### Documented error types

| Type                                                 | Typical HTTP  |
| ---------------------------------------------------- | ------------- |
| `invalid_request_error`                              | `400`         |
| `authentication_error`                               | `401`         |
| `permission_denied_error` / `permission_error`       | `403`         |
| `not_found_error`                                    | `404`         |
| `rate_limit_error`                                   | `429`         |
| `server_error` / `service_unavailable` / `api_error` | `500` / `503` |

### Documented error codes

Request validation:

- `missing_required_parameter`
- `invalid_parameter_value`
- `invalid_json`
- `invalid_json_schema`
- `tool_choice_unsupported`
- `image_input_not_supported`

Content and context:

- `content_policy_violation`
- `context_length_exceeded`
- `empty_response`

Model and routing:

- `model_not_found`
- `model_not_allowed`
- `model_not_available`
- `all_fallbacks_failed`
- `no_fallback_available`
- `fallback_blocked_for_cache_consistency`

Balance and payment:

- `memory_balance_required`
- `webSearch_balance_required`
- `both_balance_required`

Rate limiting:

- `rate_limit_exceeded`
- `daily_rpd_limit_exceeded`
- `daily_usd_limit_exceeded`

Other documented behaviors worth using:

- `429` daily-key limits should include `Retry-After`
- SSE can fail mid-stream with an `error` object containing `status`, `message`, and `code`
- `402` may also arrive as an X-402 payment challenge with `error.code: "insufficient_quota"`

## OpenClaw surfaces we can target today

### Provider hooks available to this plugin

OpenClaw exposes these relevant provider hooks:

- `classifyFailoverReason(ctx)`
- `matchesContextOverflowError(ctx)`
- `resolveUsageAuth(ctx)`
- `fetchUsageSnapshot(ctx)`

The hook surface matches in both:

- local source at `~/Github/openclaw/src/plugins/types.ts`
- installed package types at `node_modules/openclaw/dist/plugin-sdk/src/plugins/types.d.ts`

### OpenClaw failover reasons

OpenClaw's failover reason union is:

- `auth`
- `auth_permanent`
- `format`
- `rate_limit`
- `overloaded`
- `billing`
- `timeout`
- `model_not_found`
- `session_expired`
- `unknown`

### Probe status collapse

OpenClaw's model-auth probe collapses those reasons to:

| Failover reason             | Probe status |
| --------------------------- | ------------ |
| `auth`, `auth_permanent`    | `auth`       |
| `rate_limit`, `overloaded`  | `rate_limit` |
| `billing`                   | `billing`    |
| `timeout`                   | `timeout`    |
| `model_not_found`, `format` | `format`     |
| `unknown` / unset           | `unknown`    |

### Why the exact mapping matters

The reason is not just cosmetic.

OpenClaw treats the buckets differently:

- `billing` can put a provider on billing cooldown and skip same-provider candidates
- `rate_limit`, `overloaded`, and `timeout` are treated as transient
- `model_not_found` and `format` avoid the same transient cooldown path
- `auth` and `auth_permanent` can push auth/profile rotation behavior

So misclassifying a transient NanoGPT quota/routing issue as `billing` is expensive.

## Current plugin behavior

### What the plugin already does well

- It strips `X-Provider` during subscription routing in [`runtime.ts`](../runtime.ts), which matches NanoGPT's docs that subscription requests ignore provider preferences unless billing is explicitly forced to paygo.
- It has a separate NanoGPT usage snapshot integration in [`runtime.ts`](../runtime.ts).

### Where the plugin is currently too generic

Inference-path error handling is effectively:

1. let OpenClaw's generic classifier inspect the raw error message
2. add one NanoGPT-specific warning in [`index.ts`](../index.ts) when the message contains `402` or `Insufficient balance`
3. do **not** parse NanoGPT `error.type` / `error.code`

Current code:

- [`index.ts`](../index.ts) logs a billing warning when `ctx.errorMessage.includes("402") || ctx.errorMessage.includes("Insufficient balance")`
- it then returns `undefined`, so the real failover reason still comes from OpenClaw generic matching

That means the plugin warning can say "billing" even when the core classifier would prefer something else.

## Key finding for issue #85

The current NanoGPT-specific logging is **not granular enough**.

For issue #85, there are two distinct possibilities:

1. NanoGPT is returning a genuine balance/payment failure.
2. NanoGPT is returning a transient quota/routing/provider state that is only surfacing as a generic `402`-ish message.

Today the plugin logs both as billing-like.

Also, because the plugin does not parse NanoGPT's machine-readable `error.code`, it cannot distinguish:

- true insufficient balance
- daily/key limits
- content policy / empty response
- model/routing failures
- X-402 payment challenge variants

from the NanoGPT surface itself.

## Recommended mapping

### Status/type/code to OpenClaw reason

| NanoGPT signal                                                               | Recommended OpenClaw mapping         | Notes                                                                        |
| ---------------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| `401` / `authentication_error`                                               | `auth`                               | Generic OpenClaw already does this well.                                     |
| `403` + generic permission/auth failure                                      | `auth`                               | Good default for actual credential/scope failures.                           |
| `403` + `model_not_allowed`                                                  | `model_not_found`                    | Better than `auth` for "this model is not usable, try another model".        |
| `404` / `not_found_error` / `model_not_found`                                | `model_not_found`                    | Generic OpenClaw already supports this.                                      |
| `402` + `Insufficient balance` / `insufficient_quota` / `*_balance_required` | `billing`                            | Real paid-balance failure.                                                   |
| `429` / `rate_limit_error` / `rate_limit_exceeded`                           | `rate_limit`                         | Should log `Retry-After` when visible.                                       |
| `429` / `daily_rpd_limit_exceeded` / `daily_usd_limit_exceeded`              | `rate_limit`                         | Daily limits are documented as `429`, not `402`.                             |
| `500` + transient `api_error` / `server_error`                               | `timeout`                            | Matches OpenClaw's current generic treatment.                                |
| `503` / `service_unavailable`                                                | `overloaded`                         | Better fit than billing; may already classify generically from message text. |
| `408` / `504`                                                                | `timeout`                            | Retryable.                                                                   |
| `400` / `422` validation codes                                               | `format`                             | Request needs fixing, not provider cooldown.                                 |
| `content_policy_violation`                                                   | `format`                             | Non-retryable request/content failure; should never look like billing.       |
| `context_length_exceeded`                                                    | `matchesContextOverflowError = true` | Prefer the dedicated context-overflow hook over a failover reason.           |
| `empty_response`                                                             | `format`                             | Best current fit in SDK; importantly, not `billing`.                         |
| `model_not_available`                                                        | `model_not_found`                    | Closest existing bucket; suggests switching models.                          |
| `all_fallbacks_failed`                                                       | `unknown`                            | Routing umbrella code; log it explicitly rather than guessing.               |
| `no_fallback_available`                                                      | `format`                             | Request/config-driven routing constraint, not provider billing.              |
| `fallback_blocked_for_cache_consistency`                                     | `format`                             | Also request/config-driven, not billing.                                     |

### Extra note on `402`

NanoGPT's docs describe real balance failures as `402`.

They separately document daily key limits as `429`.

So if we see issue #85 producing a `402` that later self-heals after a few hours, that is either:

- an undocumented NanoGPT transient quota/routing surface
- an upstream provider response being proxied through NanoGPT with reduced detail
- or a real NanoGPT billing path that is being triggered incorrectly upstream

That last-mile ambiguity is exactly why the plugin should parse as much structured NanoGPT error data as it can before falling back to text heuristics.

## What OpenClaw generic handling already gives us

OpenClaw is already more nuanced than the plugin-specific warning suggests:

- it can classify some `402` text as `rate_limit` instead of `billing`
- it distinguishes `auth`, `auth_permanent`, `model_not_found`, `timeout`, `overloaded`, and `format`
- it already has special handling for context overflow and some provider-specific payloads

So the main gap is **not** that OpenClaw lacks buckets.

The main gaps are:

1. the NanoGPT plugin does not feed those buckets structured NanoGPT information
2. the plugin's own warning text is too broad and can be misleading

## Proposed implementation plan

### 1. Add a NanoGPT-specific error parser

Create a small helper module, for example `nanogpt-errors.ts`, that can parse:

- OpenAI-compatible NanoGPT errors
- Anthropic-compatible NanoGPT errors
- legacy `{ error: string, status: number }` bodies
- SSE mid-stream error frames when they are surfaced as raw strings

It should extract:

- `status`
- `type`
- `code`
- `message`
- `param`
- whether the shape looks like X-402
- any visible `Retry-After`

### 2. Use provider-owned hooks instead of raw-string-only logging

In `registerProvider(...)`:

- replace the current broad `402` warning in [`index.ts`](../index.ts)
- implement NanoGPT-aware `classifyFailoverReason`
- implement `matchesContextOverflowError` for `context_length_exceeded`

### 3. Make logging reason-specific

Log by resolved reason, not by substring:

- `billing`: "NanoGPT reported insufficient paid balance / x402 requirement"
- `rate_limit`: "NanoGPT reported rate limiting or daily-key exhaustion"
- `model_not_found`: "NanoGPT rejected model/routing selection"
- `format`: "NanoGPT rejected request payload/content"
- `overloaded` / `timeout`: "NanoGPT transient upstream/service failure"

If we can see them, also log:

- NanoGPT `error.code`
- NanoGPT `error.type`
- `Retry-After`
- model id
- whether routing was `subscription` or `paygo`

### 4. Preserve the good subscription/paygo guardrail

Keep the current behavior that avoids sending `X-Provider` on subscription requests.

This matches NanoGPT's docs and remains the right default:

- subscription requests ignore provider overrides unless billing is explicitly forced to paygo
- sending provider overrides accidentally can produce paid-route behavior and misleading balance failures

### 5. Add tests for the full mapping

Suggested cases:

- `402` legacy insufficient balance -> `billing`
- `402` X-402 insufficient quota -> `billing`
- `429` `rate_limit_exceeded` -> `rate_limit`
- `429` `daily_rpd_limit_exceeded` -> `rate_limit`
- `400` `content_policy_violation` -> `format`
- `400` `context_length_exceeded` -> context-overflow hook
- `403` `model_not_allowed` -> `model_not_found`
- `404` `model_not_found` -> `model_not_found`
- `503` `service_unavailable` -> `overloaded`
- SSE error frame with `code: "service_unavailable"` -> `overloaded`

## Practical conclusion for issue #85

The current plugin is not "wrong" in the sense that it bypasses OpenClaw's failure taxonomy; OpenClaw core still does most of the real classification work.

But it is **too generic** in two ways that matter for this bug:

1. it does not parse NanoGPT's documented machine-readable error surface
2. it emits a NanoGPT-specific billing warning for any `402`-looking failure

So the right next step is not a broad retry layer first.

The right next step is:

1. parse NanoGPT errors structurally
2. map them into OpenClaw's existing failover buckets deliberately
3. make logging reflect the resolved bucket instead of a blanket "billing" story

That should let us separate:

- true NanoGPT paygo balance problems
- daily-key or quota exhaustion
- model/routing failures
- transient upstream/provider issues

which is exactly what issue #85 needs.
