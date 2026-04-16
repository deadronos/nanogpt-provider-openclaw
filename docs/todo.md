# TODO

Actionable follow-up work based on:

- [`nanoproxy-openclaw-tool-reliability-report-2026-04-16.md`](./nanoproxy-openclaw-tool-reliability-report-2026-04-16.md)
- [`openclaw-provider-model-request-lifecycle-hooks-2026-04-16.md`](./openclaw-provider-model-request-lifecycle-hooks-2026-04-16.md)
- [`nanogpt-api-surface-coverage-audit-2026-04-14.md`](./nanogpt-api-surface-coverage-audit-2026-04-14.md)
- [`openclaw-vs-nanogpt-provider-capability-coverage-2026-04-14.md`](./openclaw-vs-nanogpt-provider-capability-coverage-2026-04-14.md)
- [`nanogpt-audio-openclaw-fit-and-pricing-2026-04-14.md`](./nanogpt-audio-openclaw-fit-and-pricing-2026-04-14.md)

## High-priority cleanup

### Docs and behavior alignment

- [ ] Resolve the Kimi `web_fetch` aliasing mismatch.
  - `README.md` still says Kimi aliases `web_fetch` to `fetch_web_page`.
  - `models.ts` currently keeps aliasing disabled via an empty alias-model set.
  - Pick one truth:
    - re-enable the alias with fresh tests and evidence, or
    - remove the README claim and document the current disabled state.
- [ ] Refresh or trim stale findings docs.
  - `docs/findings.md` contains at least some observations that are no longer true on `main`.
  - Re-scan and either update it or archive old findings into dated docs.

### Reliability observability

- [ ] Add structured, opt-in debug artifacts for tool-call reliability failures.
  - Capture at least:
    - model id
    - request API (`completions` vs `responses`)
    - tool name
    - raw argument length
    - repair stage (`toolcall_end` vs final message)
    - whether repair succeeded or failed
    - whether the turn ended with no recognized tool call
  - Likely files:
    - `repair.ts`
    - `index.ts`
- [ ] Document the debug mode once added.
  - Update `README.md` with the intended troubleshooting flow.

### Reliability test coverage

- [ ] Expand the failure-taxonomy tests beyond malformed JSON arguments.
  - Add targeted cases for:
    - empty tool-enabled turns
    - prose-wrapped tool payloads
    - fenced JSON tool payloads
    - flattened tool arguments
    - mismatches between streamed tool-call events and the final assistant message
  - Likely files:
    - `repair.test.ts`
    - possibly a new reliability-focused test file if the matrix grows too large

## Next reliability improvements

### Move reliability earlier in the lifecycle

- [ ] Prototype a stronger reliability seam than argument-only repair.
  - Current behavior is mainly `wrapStreamFn` + `jsonrepair(...)` after tool-call parsing already happened.
  - The OpenClaw lifecycle review suggests the better seams are:
    - `createStreamFn`
    - `prepareExtraParams`
    - `wrapStreamFn`
- [ ] Add a one-shot retry for invalid empty tool turns.
  - Scope it narrowly:
    - tool-enabled turns only
    - known-problem model families only
    - exactly one retry
  - This should be treated as a protocol-recovery step, not a general retry policy.
- [ ] Add broader salvage parsing for near-valid tool payloads.
  - Accept or normalize more than just malformed argument JSON when practical.
  - Focus on cases where the model output is structurally obvious but not in the exact downstream tool-call shape.
- [ ] Decide whether raw-response recovery belongs in-process or behind a sidecar/proxy mode.
  - If OpenClaw hook access is too late for full salvage, evaluate a proxy/sidecar option instead of overloading the current wrapper path.

### Reliability profiles instead of one-off model hacks

- [ ] Introduce model-scoped reliability profiles.
  - Example profile shapes:
    - native only
    - native + argument repair
    - native-first + one retry
    - bridge fallback
    - bridge-always for known-problem models
  - Likely home:
    - `models.ts`
    - `index.ts`
    - a new reliability helper module if needed

### Canonicalization and compatibility helpers

- [ ] Replace one-off aliasing with a broader canonicalization strategy if tool-name drift becomes a recurring issue.
  - Tool-name aliasing should be documented, tested, and kept consistent with the README.
  - Only do this after the transport-level reliability work is clearer.

## Feature expansion

### Embeddings

- [ ] Add NanoGPT embeddings support.
  - This is still the strongest next missing OpenClaw capability.
  - Best fit:
    - implement the OpenClaw embeddings provider surface
    - document embeddings as paygo-first unless NanoGPT clearly supports subscription-backed embeddings

### Web search expansion

- [ ] Deepen the existing NanoGPT web-search provider.
  - Current implementation is intentionally narrow and hard-codes:
    - `provider: "linkup"`
    - `depth: "standard"`
    - `outputType: "searchResults"`
  - Add support for a richer subset where OpenClaw can consume it cleanly, such as:
    - provider selection
    - depth selection
    - alternate output types
    - structured output / schema
    - sourced answers
    - date filters
  - Likely file:
    - `web-search.ts`

### Image generation expansion

- [ ] Expand image generation beyond the curated subset.
  - Candidate follow-ups:
    - official image-model discovery
    - more request knobs
    - broader response modes
    - mask/inpainting support where useful
  - Likely file:
    - `image-generation-provider.ts`

### Optional audio expansion

- [ ] If audio is added, do STT first.
  - Best first fit:
    - `POST /api/v1/audio/transcriptions`
  - Treat it as paygo-first in docs and UX.
- [ ] Add TTS second if audio becomes a real product goal.
  - Best first fit:
    - `POST /api/v1/audio/speech`

## Lower-priority or deferred work

- [ ] Defer stored/background Responses lifecycle helpers unless a real use case appears.
- [ ] Defer `prepareRuntimeAuth` work unless NanoGPT adds a runtime auth exchange flow that needs it.
- [ ] Defer standalone web-fetch/scrape integration unless it becomes important to actual workflows.
- [ ] Defer video generation, realtime voice, realtime transcription, and music generation.
- [ ] Defer NanoGPT account, balance, team, referral, payment, and TEE surfaces unless the plugin scope broadens significantly.

## Suggested execution order

1. [ ] Fix README/code drift and refresh stale findings docs.
2. [ ] Add structured debug artifacts for reliability work.
3. [ ] Expand reliability test coverage.
4. [ ] Prototype one-shot invalid-empty retry and broader salvage parsing.
5. [ ] Decide whether a stronger in-process hook or a sidecar/proxy path is the right long-term reliability architecture.
6. [ ] Add embeddings.
7. [ ] Expand web search.
8. [ ] Deepen image generation.
9. [ ] Optionally add STT, then TTS.

## Likely owning files by theme

- Reliability and hook wiring:
  - `index.ts`
  - `repair.ts`
  - `models.ts`
- Text/catalog/runtime behavior:
  - `provider-catalog.ts`
  - `provider-discovery.ts`
  - `runtime.ts`
- Search and media:
  - `web-search.ts`
  - `image-generation-provider.ts`
- Docs and metadata:
  - `README.md`
  - `openclaw.plugin.json`
  - `docs/*.md`
- Tests:
  - `repair.test.ts`
  - `index.test.ts`
  - `runtime.test.ts`
  - capability-specific test files next to the owning module
