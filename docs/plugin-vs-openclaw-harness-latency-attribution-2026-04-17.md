# Plugin vs OpenClaw harness latency attribution for Kimi K2.5

**Date:** 2026-04-17  
**Question:** Is the observed latency for `moonshotai/kimi-k2.5:thinking` coming from this NanoGPT plugin, or from the broader OpenClaw agent harness?  
**Short answer:** Both contribute, but in different ways: the plugin appears to cause poor **user-visible streaming/TTFT** for Kimi, while the broader OpenClaw harness appears to add a large amount of **extra total latency** beyond the provider path itself.

---

## Summary

- the plugin's subscription probe and model-discovery setup calls were **sub-second**, so they do **not** explain the full multi-second or multi-tens-of-seconds delay
- the measured direct NanoGPT path had median **TTFT 4.1s** and median **total latency 4.3s**
- the measured `openclaw infer model run --gateway` path had median **TTFT 16.8s** and median **total latency 16.8s**
- the measured full `openclaw agent` path had median **TTFT 32.6s** and median **total latency 32.7s**
- the current Kimi-specific reliability wrapper in this plugin buffers and replays the stream, which is strong evidence that the plugin is hurting **user-visible TTFT/streaming** for Kimi
- however, the jump from the slimmer infer path to the full agent path is still large, which points to substantial additional overhead in the broader OpenClaw harness

Bottom line:

- **plugin setup overhead:** likely small
- **plugin Kimi stream-wrapper overhead:** likely real and significant for visible TTFT
- **full OpenClaw agent harness overhead:** also large, and likely the bigger contributor to the final 30+ second agent latency

---

## Measurements used for attribution

### End-to-end comparison

| Path | Median TTFT | Median total latency | Notes |
| --- | ---: | ---: | --- |
| Direct NanoGPT streaming Chat Completions | 4.1s | 4.3s | `POST /api/subscription/v1/chat/completions` |
| `openclaw infer model run --gateway` | 16.8s | 16.8s | same model, same prompt, no full agent loop |
| `openclaw agent` | 32.6s | 32.7s | full agent path |

### Plugin cold-path HTTP calls

These are the obvious up-front NanoGPT HTTP calls performed during provider construction for a subscription-active, completions-mode path:

| Call | Median latency | Notes |
| --- | ---: | --- |
| `GET /api/subscription/v1/usage` | 106ms | subscription-state probe |
| `GET /api/subscription/v1/models?detailed=true` | 386ms | model discovery |

Combined, those measured calls are still only about **0.5s** at the median.

That is useful because it rules out the simplest theory that provider setup alone is responsible for the observed 16-33 second delays.

---

## What the code says

### Provider setup looks lightweight

The provider construction path in `provider-catalog.ts` builds the NanoGPT provider by:

- parsing plugin config
- resolving routing mode via `resolveNanoGptRoutingMode(...)`
- resolving catalog source
- discovering models with `discoverNanoGptModels(...)`
- building request headers and base URL

The corresponding runtime logic in `runtime.ts` shows that, in the tested subscription-active completions case, the key up-front network operations are:

- `probeNanoGptSubscription(...)` -> `GET https://nano-gpt.com/api/subscription/v1/usage`
- `discoverNanoGptModels(...)` -> `GET https://nano-gpt.com/api/subscription/v1/models?detailed=true`

Those calls are measurable, but they are nowhere near large enough to account for the full end-to-end latency observed in the OpenClaw CLI benchmarks.

### The Kimi stream wrapper is a stronger latency candidate

The more interesting code path is in `index.ts`.

For Kimi-family models, `wrapStreamFn` does this:

- detects the model family via `shouldRepairNanoGptToolCallArguments(...)`
- returns `wrapStreamWithToolCallRepair(...)`

For non-Kimi models, the plugin uses the lighter `wrapStreamWithMalformedToolCallGuard(...)` path instead.

That matters because the Kimi wrapper in `repair.ts` does more than inspect tool calls. It:

1. calls `collectRepairAttempt(...)`
2. fully iterates the upstream stream inside that function
3. only after collection returns a replay wrapper via `createReplayStream(...)`

In practical terms, that means the downstream consumer can be forced to wait until the whole upstream stream has already been collected before seeing replayed events.

For user-visible streaming, this is a big deal.

---

## Why the plugin can affect plain-text Kimi turns too

An important subtlety is that the Kimi repair path is selected based on the **model id**, not on whether the specific turn actually used tools.

That means even a plain-text prompt like:

- `Reply with exactly PING.`

can still flow through `wrapStreamWithToolCallRepair(...)` for `moonshotai/kimi-k2.5:thinking`.

The retry logic inside that wrapper is only relevant for empty tool-enabled turns, but the initial collection-and-replay structure still happens before that distinction becomes useful for downstream streaming behavior.

This is why the plugin remains a credible cause of poor visible TTFT even in a minimal non-tool benchmark.

---

## Attribution by layer

### What is probably **not** the main problem

#### NanoGPT routing and discovery setup

The measured setup calls are far too small to explain the full latency gap:

- plugin cold-path HTTP work: roughly **0.5s median combined**
- infer path median total: **16.8s**
- full agent path median total: **32.7s**

So the plugin's route selection and model discovery do not look like the main culprit.

### What likely **is** a real plugin-side problem

#### Kimi stream buffering / replay

The measured behavior matches the implementation shape:

- direct NanoGPT streaming showed visible output in a few seconds
- both `infer` and `agent` user-visible TTFTs were much larger
- for Kimi, the plugin currently wraps the stream in a collect-then-replay path

That is strong evidence that the plugin is likely harming **streaming UX and visible TTFT** for Kimi-family models.

### What likely belongs to the larger OpenClaw harness

#### The extra gap from infer to full agent

The `infer` path uses the provider/plugin path without the entire agent orchestration loop, while `openclaw agent` adds the broader harness.

Measured medians:

- direct total: **4.3s**
- infer total: **16.8s**
- full agent total: **32.7s**

This suggests two distinct overhead regions:

1. **direct -> infer**: about **12.5s** median extra
2. **infer -> full agent**: about **15.9s** median extra

That second jump is hard to pin on the plugin alone. It much more strongly suggests broader OpenClaw work such as:

- session plumbing
- context assembly
- memory/hook activity
- agent orchestration
- CLI presentation behavior

The OpenClaw config used during measurement also had `blockStreamingDefault: "on"`, which is consistent with the observed lack of visible incremental output in the CLI.

---

## Verdict

The most defensible reading of the evidence is:

### 1. The plugin is probably causing bad visible TTFT for Kimi

This is the strongest plugin-specific finding.

Why:

- Kimi models are routed through `wrapStreamWithToolCallRepair(...)`
- that path collects the stream before replaying it
- this matches the observed collapse of user-visible streaming behavior

### 2. The full OpenClaw harness is still the bigger contributor to the huge final agent latency

This is the strongest system-level finding.

Why:

- the slimmer `infer --gateway` path is much faster than `openclaw agent`
- plugin setup calls are too small to explain the difference
- the remaining latency likely lives in broader agent/session/context machinery

### 3. The plugin's route/setup logic is probably not the main latency problem

Why:

- the measured setup calls are sub-second
- the observed end-to-end gap is much larger than that

---

## Practical interpretation

If the question is:

- "Is the plugin solely to blame for the 30+ second latency?"

the answer is:

- **No.**

If the question is:

- "Is the plugin contributing materially to poor user-visible TTFT for Kimi?"

the answer is:

- **Very likely yes.**

If the question is:

- "Is the full OpenClaw agent harness also a major part of the problem?"

the answer is:

- **Yes, also very likely yes.**

---

## Most useful next steps

1. change the Kimi repair path so plain non-tool turns do **not** buffer the full stream before replay
2. only fall back to buffering/repair when a tool-reliability condition is actually detected
3. compare `openclaw infer model run --gateway` with and without the Kimi repair wrapper to quantify the plugin-specific TTFT penalty directly
4. profile the full `openclaw agent` path separately to isolate session/context/hook overhead from provider transport time

---

## Related reports

- `docs/openclaw-vs-direct-kimi-latency-report-2026-04-17.md`
- `docs/live-api-findings-2026-04-12.md`
