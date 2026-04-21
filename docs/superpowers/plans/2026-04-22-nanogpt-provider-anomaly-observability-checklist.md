# NanoGPT Provider Anomaly Observability Implementation Checklist

> Goal: implement a passive, warning-only observability layer for NanoGPT
> provider anomalies so we can classify leaked reasoning output, malformed or
> swallowed tool-calling behavior, and replay-history corruption before adding
> any rewriting or repair behavior.
>
> Source spec: [`../specs/2026-04-22-nanogpt-provider-anomaly-observability.md`](../specs/2026-04-22-nanogpt-provider-anomaly-observability.md)

## Objectives

- [ ] Add same-turn anomaly detection in the provider stream wrapper.
- [ ] Add replay-history anomaly detection through provider replay hooks.
- [ ] Reuse or extract a shared warn-once logging surface for safe anomaly logs.
- [ ] Preserve current request behavior: warning-only, no rewriting, no
      blocking.
- [ ] Produce logs that are actionable enough to support later model-family or
      exact-model mitigations.

## File Map

- `index.ts`
  - wire new replay/reasoning hooks and shared anomaly helpers into provider
    registration
- `provider/stream-hooks.ts`
  - detect same-turn anomalies from tool-enabled requests and final stream
    results
- `provider/error-hooks.ts`
  - preserve structured provider-failure anomaly logging and share warn-once
    behavior where practical
- `provider/tool-schema-hooks.ts`
  - keep model-family helpers aligned with anomaly targeting
- `provider/replay-hooks.ts`
  - new replay-policy, sanitize, and validate hooks for follow-up-turn anomaly
    detection
- `provider/anomaly-logger.ts`
  - new shared warning formatter, signature builder, and safe-summary helpers
- `provider/stream-hooks.test.ts`
  - extend with same-turn anomaly detection coverage
- `provider/error-hooks.test.ts`
  - keep warn-once and safe-summary behavior covered
- `provider/replay-hooks.test.ts`
  - new replay anomaly coverage

## Phase 0: Guardrails

- [ ] Confirm the first pass is strictly observability-only.
- [ ] Confirm no response rewriting or tool-call repair is reintroduced in this
      plan.
- [ ] Keep logging safe: no raw prompts, raw assistant output, or raw tool
      arguments.
- [ ] Reuse the existing warn-once pattern from `provider/error-hooks.ts`
      instead of inventing a second inconsistent logger.
- [ ] Capture a clean verification baseline before behavior changes if needed.

## Phase 1: Define the anomaly surface

- [ ] Create a shared anomaly-kind taxonomy and stage names.
- [ ] Define the minimum anomaly payload shape used by all warning sites.
- [ ] Define helper functions for:
  - [ ] resolving model id
  - [ ] resolving model family
  - [ ] building expected-shape summaries
  - [ ] building observed-shape summaries
- [ ] Decide whether the anomaly types stay inside one helper module or need a
      dedicated `provider/anomaly-types.ts` file.

## Phase 2: Extract shared logging helpers

- [ ] Create `provider/anomaly-logger.ts`.
- [ ] Add warn-once signature generation for anomaly events.
- [ ] Add helpers to summarize marker names, tool counts, tool names, and other
      safe metadata.
- [ ] Add truncation or normalization helpers for any short freeform messages.
- [ ] Ensure the logger can be used both by stream hooks and replay hooks.
- [ ] Decide whether `provider/error-hooks.ts` should import the shared logger
      or continue owning the provider-error-specific message text separately.

## Phase 3: Add same-turn stream observability

- [ ] Extend `provider/stream-hooks.ts` beyond streaming-usage warnings.
- [ ] Capture whether a request was tool-enabled using safe request metadata.
- [ ] Capture expected tool names and tool count without logging raw args.
- [ ] After stream completion, inspect the final assistant result for:
  - [ ] missing parsed tool calls on a tool-enabled turn
  - [ ] empty or suspicious visible output on a tool-enabled turn
  - [ ] leaked reasoning tags
  - [ ] unbalanced reasoning tags
  - [ ] XML-like tool wrappers
  - [ ] function-call markers in visible text
- [ ] Emit warning-only anomaly logs using the shared logger.
- [ ] Keep existing streaming-usage warning behavior intact.

## Phase 4: Add replay anomaly detection

- [ ] Create `provider/replay-hooks.ts`.
- [ ] Implement `buildReplayPolicy` for the intended NanoGPT replay contract.
- [ ] Implement `sanitizeReplayHistory` in warn-only mode first.
- [ ] Implement `validateReplayTurns` in warn-only mode first.
- [ ] Detect follow-up-turn anomalies such as:
  - [ ] leaked reasoning blocks preserved in replay content
  - [ ] tool-like visible text inside assistant replay turns
  - [ ] malformed assistant/tool ordering
  - [ ] missing or inconsistent tool-call ids
- [ ] Decide whether `resolveReasoningOutputMode` belongs in the same module or
      a nearby helper.

## Phase 5: Wire hooks into provider registration

- [ ] Update `index.ts` to register the new replay and reasoning hooks.
- [ ] Keep `index.ts` as a composition layer that wires prebuilt helpers.
- [ ] Reuse the same logger instance already passed to provider error and stream
      hooks.
- [ ] Verify that the provider surface remains stable and no public behavior is
      accidentally changed.

## Phase 6: Align family targeting helpers

- [ ] Reuse or extract a shared `detectNanoGptModelFamily(...)` helper so stream,
      replay, and schema diagnostics classify models consistently.
- [ ] Ensure logs always include both exact model id and derived family when
      available.
- [ ] Keep the family taxonomy small and stable: `kimi`, `glm`, `qwen`,
      `other`.
- [ ] Avoid hard-coding mitigation behavior in this phase; only capture the
      targeting information.

## Phase 7: Tests

- [ ] Add or update `provider/stream-hooks.test.ts` to cover:
  - [ ] tool-enabled turn without parsed tool calls
  - [ ] visible reasoning-tag leakage
  - [ ] XML-like tool wrapper leakage
  - [ ] clean non-anomalous turn produces no new warning
- [ ] Add `provider/replay-hooks.test.ts` to cover:
  - [ ] replay reasoning leak detection
  - [ ] replay tool-order validation
  - [ ] missing tool-call id detection
  - [ ] clean replay history produces no warning
- [ ] Keep `provider/error-hooks.test.ts` passing and extend only if shared
      logger extraction changes behavior.

## Phase 8: Documentation follow-through

- [ ] Link the implementation work back to the spec in any follow-up notes.
- [ ] If behavior becomes user-visible later, update `README.md`; otherwise keep
      user-facing docs unchanged for an observability-only pass.
- [ ] Update `AGENTS.md` only if the new module layout becomes a stable repo
      convention worth documenting.

## Verification Checklist

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] Manual inspection of warning text for safe summaries
- [ ] Manual inspection that no raw assistant output or raw tool arguments are
      logged
- [ ] Manual inspection that normal turns remain warning-free

## Done Criteria

- [ ] The provider can warn on same-turn anomalies without mutating responses.
- [ ] The provider can warn on replay-history anomalies without mutating replay
      state by default.
- [ ] Warning logs include model id, family, stage, and expected versus observed
      summaries.
- [ ] Warning logs do not expose secrets or raw payloads.
- [ ] The implementation produces enough evidence to choose later family-level
      or exact-model mitigations with confidence.
