# NanoGPT Provider Anomaly Observability

## Summary

Add a passive, nonblocking anomaly-observability layer to the NanoGPT provider
plugin so we can detect and log malformed tool-calling behavior, leaked
thinking/reasoning output, and replay-history corruption before we reintroduce
any response rewriting or repair behavior.

The immediate goal is not to mutate model output. The immediate goal is to make
runtime anomalies visible, deduplicated, and safe to analyze so we can decide
which model families or exact model ids need targeted mitigations later.

## Problem Statement

The plugin previously had a dedicated repair layer that focused on malformed
tool-call behavior. That layer has been removed during the recent module split.
The current codebase still has useful provider-hook surfaces for:

- tool-schema normalization and diagnostics
- stream wrapping
- provider error-surface classification
- model normalization and compat shaping

What it does not yet have is a coherent observability layer for successful but
badly formed model turns, such as:

- leaked `<thinking>` or reasoning-tag text in visible assistant output
- tool-enabled turns where the model emits text that looks like a tool call but
  OpenClaw never receives a valid parsed tool call
- malformed tool-call output that only breaks when the conversation is replayed
  on a follow-up request
- model-family-specific failure patterns that only become obvious after several
  occurrences in logs

Without that observability, adding repair or rewriting logic now would be too
speculative.

## Goals

- Detect same-turn request/response anomalies for NanoGPT model calls.
- Detect follow-up-turn replay anomalies that surface only when history is
  sanitized or revalidated.
- Emit informative, warning-level, nonblocking logs that include model identity
  and the expected versus observed shape.
- Avoid leaking prompts, raw tool arguments, API keys, or other secrets into
  logs.
- Deduplicate repeated warnings so one noisy model does not spam logs.
- Create a stable anomaly taxonomy that future mitigations can target by model
  family or exact model id.

## Non-Goals

- No automatic response rewriting in the first observability pass.
- No blocking of requests or tool calls based on anomaly detection alone.
- No OpenClaw core changes for the first iteration.
- No attempt to log full raw model output.
- No attempt to solve every tool-calling failure before we have evidence from
  logs.

## Current State

The current NanoGPT provider already uses these relevant hook surfaces:

- `normalizeToolSchemas`
- `inspectToolSchemas`
- `wrapStreamFn`
- `matchesContextOverflowError`
- `classifyFailoverReason`

Current strengths:

- `provider/error-hooks.ts` already implements warn-once structured logging for
  provider failures.
- `provider/tool-schema-hooks.ts` already applies model-family-specific schema
  hints and diagnostics for GLM and Qwen families.
- `provider/stream-hooks.ts` already demonstrates a best-effort, nonblocking
  post-stream warning flow for streaming usage anomalies.

Current gaps:

- no shared anomaly taxonomy for successful-but-bad model turns
- no replay-history sanitation or validation hooks wired into the provider
- no passive logging for tool-enabled turns that return malformed text or empty
  tool-call behavior
- no model-family/id-targeting policy surface for future mitigations

## Design Principles

- **Observe first, repair later.** The first implementation should only classify
  and log anomalies.
- **Provider-local before global.** Start inside the NanoGPT provider hook
  surface rather than introducing general cross-provider hooks.
- **Safe by default.** Log structure and summaries, not raw payloads.
- **Nonblocking.** Anomaly detection must never break the request path.
- **Deduplicated.** Repeat anomalies should collapse to warn-once signatures.
- **Model-targetable.** The detection output must be detailed enough to support
  future mitigation gates by family or exact model id.

## Target Behavior

### Same-turn observability

For live requests, the provider should detect and warn about anomalies such as:

- tool-enabled requests that finish without parsed tool calls and with empty or
  suspicious assistant text
- visible assistant text that appears to contain leaked tool-call wrappers such
  as XML-like tags or function-call markers
- visible assistant text that appears to contain leaked reasoning or thinking
  tags
- malformed or unbalanced reasoning delimiters that indicate partial reasoning
  leakage into user-visible content

These warnings should be emitted from the stream-wrapper path after the stream
result is available, using best-effort inspection that never blocks the live
request.

### Follow-up-turn observability

For replayed conversation history, the provider should detect and warn about
anomalies such as:

- leaked reasoning blocks preserved in assistant content when they should not be
  replayed
- malformed assistant/tool ordering that only becomes invalid on a subsequent
  request
- missing or inconsistent tool-call ids in replay turns
- replay history that contains tool-looking text rather than canonical tool
  turns

These warnings should be emitted from provider replay hooks during sanitation or
validation of replay history.

### Failure-path observability

When NanoGPT returns explicit failure payloads, the provider should continue to
use structured warning logs from the error hooks and extend the shared logging
surface so failure anomalies and successful-turn anomalies use consistent log
signatures.

## Hook Selection

### Primary hooks for the first iteration

- `wrapStreamFn`
  - best provider-local hook for same-turn request/response anomaly detection
  - can observe whether a request was tool-enabled and inspect the final result
    best-effort
- `buildReplayPolicy`
  - defines the intended replay contract for NanoGPT families
- `sanitizeReplayHistory`
  - can remove or normalize obviously bad replay content later, but should start
    in warn-only mode for observability
- `validateReplayTurns`
  - best hook for follow-up-turn anomaly detection that only surfaces on replay
- `resolveReasoningOutputMode`
  - establishes whether provider reasoning is expected to be `tagged` or
    `native`, which informs leak detection
- `classifyFailoverReason` and `matchesContextOverflowError`
  - continue as explicit failure-path anomaly reporting hooks

### Supporting hooks

- `normalizeToolSchemas`
  - continue to steer model families toward better tool-calling behavior
- `inspectToolSchemas`
  - continue to surface preflight warnings for tool schema shapes that are hard
    to revalidate
- `normalizeResolvedModel` or compat patches
  - may later be used to apply family-level behavior flags or mitigation hints

### Hooks intentionally deferred for the first iteration

- `createStreamFn`
  - stronger transport control, but not needed unless `wrapStreamFn` cannot see
    enough signal
- general `llm_output` or `before_tool_call` hooks
  - useful later if we need cross-provider behavior, but unnecessary for an
    initial NanoGPT-local pass

## Anomaly Taxonomy

The observability layer should classify anomalies into stable kinds.

### Request-side anomaly kinds

- `tool_request_expected_no_tools_registered`
- `tool_request_expected_invalid_tool_choice`

### Same-turn response anomaly kinds

- `tool_enabled_turn_without_tool_call`
- `tool_enabled_turn_with_tool_like_text`
- `tool_enabled_turn_with_empty_visible_output`
- `visible_output_contains_reasoning_tags`
- `visible_output_contains_unbalanced_reasoning_tags`
- `visible_output_contains_xml_like_tool_wrappers`
- `visible_output_contains_function_call_markers`

### Replay anomaly kinds

- `replay_contains_reasoning_leak`
- `replay_contains_tool_like_text`
- `replay_has_invalid_tool_ordering`
- `replay_has_missing_tool_call_id`
- `replay_has_inconsistent_assistant_tool_state`

### Failure anomaly kinds

- `structured_provider_error_mapped`
- `structured_provider_error_unmapped`
- `structured_provider_error_unknown_envelope`
- `context_overflow_error_detected`

The exact list can evolve, but new categories should extend the taxonomy rather
than replacing old names casually so logs remain comparable over time.

## Detection Heuristics

### Reasoning-leak heuristics

The first pass should detect visible text containing markers such as:

- `<thinking>` / `</thinking>`
- `<reasoning>` / `</reasoning>`
- `<analysis>` / `</analysis>`
- family-specific tagged reasoning wrappers already implied by
  `resolveReasoningOutputMode`

Detection should distinguish between:

- **balanced tagged reasoning that leaked into visible text**
- **unbalanced or truncated tags** indicating partial or malformed reasoning

### Tool-call anomaly heuristics

For tool-enabled turns, detect:

- no parsed tool calls in the final message even though tools were available
- visible assistant text containing tool-like wrappers such as:
  - `<tool>...</tool>`
  - `<function=name>`
  - JSON-ish objects that appear to be tool-call envelopes
- empty or near-empty visible assistant text on a tool-enabled turn

### Replay anomaly heuristics

During replay sanitation or validation, detect:

- assistant content that still contains tool-like or reasoning-like text after
  generic cleanup
- tool turns that do not align with the preceding assistant turn
- tool-call ids that are missing, duplicated, or otherwise inconsistent

These heuristics should remain conservative; the first pass should prefer false
negatives over noisy false positives.

## Logging Contract

Warnings must be:

- informative
- nondestructive
- nonblocking
- deduplicated
- safe for logs

### Required log fields

- anomaly kind
- detection stage
  - `request`
  - `stream_result`
  - `replay_sanitize`
  - `replay_validate`
  - `provider_error`
- provider id
- model id
- model family
- transport api when known
- expected shape summary
- observed shape summary

### Optional log fields

- stop reason or finish reason
- expected tool names
- expected tool count
- observed tool count
- detected marker names
- replay turn indexes or role summary
- routing mode or provider override when already available from safe config

### Fields that must not be logged raw

- prompt text
- assistant raw output
- raw tool arguments
- API keys or auth headers
- full request bodies
- full error envelopes when they may contain secrets

### Safe-summary guidance

Where useful, logs may include:

- tool names
- argument key names, not values
- counts and lengths
- marker names
- truncated normalized error messages as already done in `provider/error-hooks.ts`

## Model Targeting Strategy

The observability layer should also create a future mitigation seam.

### Family targeting

The provider should continue to derive model family from model id, using a
shared helper that can classify at least:

- `kimi`
- `glm`
- `qwen`
- `other`

### Exact model targeting

In addition to family-level grouping, anomaly warnings should include the exact
resolved model id so later mitigations can target specific offenders without
blanket-enabling a family-wide rewrite.

### Future mitigation categories

Future work may use the anomaly taxonomy to enable:

- replay sanitation rules for families with leaked tagged reasoning
- stream-time salvage parsing for families that emit tool-like visible text
- family-specific prompt or tool-schema guidance
- exact-model fallback behavior for persistent offenders

This spec does not enable those mitigations yet. It only requires that the
observability layer produce the evidence needed to choose them.

## Proposed Module Layout

The implementation should preserve the current module split and add small,
cohesive helpers.

### Existing modules to extend

- `index.ts`
  - wire new replay and reasoning hooks into provider registration
- `provider/stream-hooks.ts`
  - same-turn anomaly inspection
- `provider/error-hooks.ts`
  - shared warn-once patterns for provider-failure anomalies
- `provider/tool-schema-hooks.ts`
  - keep schema diagnostics and family detection aligned with anomaly logic

### New modules to add

- `provider/replay-hooks.ts`
  - `buildReplayPolicy`, `sanitizeReplayHistory`, `validateReplayTurns`, and
    possibly `resolveReasoningOutputMode`
- `provider/anomaly-logger.ts`
  - warn-once signature builder, redaction/truncation helpers, and shared log
    message formatting for non-error anomalies
- `provider/anomaly-types.ts`
  - anomaly-kind unions, stage names, and shape summaries if the types become
    large enough to justify separation

If the types stay small, `provider/anomaly-types.ts` may be folded into
`provider/anomaly-logger.ts`.

## Testing Strategy

Tests should focus on passive detection, not rewriting.

### Stream-observability tests

- tool-enabled request finishes with no tool call and logs a warning
- visible assistant output contains `<thinking>` and logs a reasoning leak
- visible assistant output contains XML-like tool wrappers and logs a tool-like
  text warning
- non-tool normal responses do not log false positives

### Replay-observability tests

- replay sanitation detects leaked reasoning blocks
- replay validation detects malformed assistant/tool ordering
- replay validation detects missing tool-call ids
- clean replay history produces no warnings

### Error-observability tests

- existing structured error logging still deduplicates correctly
- anomaly logger does not emit raw sensitive payload fields

## Risks

- passive heuristics may still produce noisy warnings for some families
- `wrapStreamFn` may not expose enough raw response detail to distinguish all
  swallowed-tool-call cases
- replay validation may need careful tuning to avoid warning on valid but odd
  OpenClaw transcript shapes

## Mitigations

- start with a conservative anomaly taxonomy
- deduplicate aggressively with warn-once signatures
- prefer summary fields over raw output in all logs
- keep the first iteration warning-only
- escalate to `createStreamFn` only if logs show that `wrapStreamFn` lacks the
  signal needed to classify anomalies accurately

## Verification

### Automated

- targeted unit tests for stream anomaly detection
- targeted unit tests for replay anomaly detection
- existing provider error-hook tests continue to pass
- `npm test`
- `npm run typecheck`

### Manual

- inspect warning text to ensure it includes model id, family, stage, and
  expected versus observed summaries
- confirm no raw prompt or tool-argument payloads appear in warnings
- verify that ordinary non-anomalous turns do not emit new warnings

## Expected Outcome

After this work, the NanoGPT provider will have a lightweight anomaly
observability layer that:

- identifies same-turn and follow-up-turn reliability issues
- logs them safely and nonblockingly
- preserves the current request behavior
- creates the evidence base needed to introduce targeted model-family or
  model-id-specific mitigations later
