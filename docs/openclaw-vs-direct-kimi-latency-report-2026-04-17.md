# OpenClaw vs direct NanoGPT latency report for Kimi K2.5

**Date:** 2026-04-17  
**Question:** How does a manual OpenClaw CLI agent turn compare with a manual direct NanoGPT call for `moonshotai/kimi-k2.5:thinking`?  
**Environment:** local macOS host, OpenClaw CLI/Gateway `2026.4.16`, NanoGPT API key loaded from `.env`  
**Prompt under test:** `Reply with exactly PING.`

---

## Summary

- the NanoGPT key used for this check was subscription-active (`active: true`, `state: "active"`)
- the direct benchmark therefore used `POST https://nano-gpt.com/api/subscription/v1/chat/completions`
- median direct TTFT to first visible content token was **5.5s**; median total latency was **5.6s**
- median OpenClaw agent TTFT to first visible reply text was **32.6s**; median total latency was **32.7s**
- from the user-visible CLI boundary, the direct call was about **5.9x faster** to first output and about **5.8x faster** end-to-end
- in this setup, the OpenClaw CLI did not visibly stream partial reply text for the tested turn, so TTFT effectively matched completion latency on the agent side

---

## Methodology

### OpenClaw path

- used gateway-backed `openclaw agent` (not `--local`)
- used fresh session ids for each trial
- used `--thinking off`
- temporarily set `agents.defaults.model.primary` to `nanogpt/moonshotai/kimi-k2.5:thinking`
- restored the original default model after the run

### Direct NanoGPT path

- used streaming Chat Completions SSE against the subscription endpoint
- request body included:
  - `model: "moonshotai/kimi-k2.5:thinking"`
  - one user message with the prompt above
  - `stream: true`
  - `temperature: 0`
  - `max_tokens: 128`
- recorded both first `reasoning` delta and first visible `content` delta

### TTFT definitions

- **OpenClaw agent TTFT:** time from process start until the first visible reply text matching `PING` appeared on stdout
- **Direct TTFT:** time from request start until the first streamed `content` token arrived
- because the OpenClaw CLI did not expose partial streamed reply text in these runs, the OpenClaw TTFT values should be read as **user-visible TTFT**, not necessarily upstream provider TTFT

---

## Route selection

| Check                    | Result                                                           | Notes                                                                         |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| NanoGPT usage probe      | subscription-active                                              | payload included `active: true`, `state: "active"`                            |
| Plugin-like direct route | subscription Chat Completions                                    | matches the current completions-routing behavior for active subscription keys |
| Direct endpoint used     | `POST https://nano-gpt.com/api/subscription/v1/chat/completions` | same model as the OpenClaw agent run                                          |
| Agent transport          | `openclaw agent` via gateway                                     | not `openclaw infer model run`, not embedded `--local`                        |

---

## Trial results

### OpenClaw agent

| Trial |  TTFT | Total | Outcome |
| ----- | ----: | ----: | ------- |
| 1     | 48.3s | 48.3s | `PING`  |
| 2     | 32.6s | 32.7s | `PING`  |
| 3     | 32.2s | 32.2s | `PING`  |

Observed behavior:

- the CLI returned the expected text on all three trials
- no partial reply text was visibly streamed before the final `PING`
- as a result, first visible output and completion time were almost identical on every agent trial

### Direct NanoGPT call

| Trial | First reasoning delta | First content delta | Total | Output                                                         |
| ----- | --------------------: | ------------------: | ----: | -------------------------------------------------------------- |
| 1     |                  5.1s |                5.5s |  5.6s | `PING`                                                         |
| 2     |                  1.1s |                9.0s |  9.0s | reasoning-like visible content instead of a clean short `PING` |
| 3     |                  1.4s |                3.8s |  4.3s | `PING`                                                         |

Observed behavior:

- the direct streaming path started producing output much sooner than the OpenClaw agent path
- one trial returned reasoning-like visible content rather than a clean short answer, even with a trivial prompt and `temperature: 0`
- the first visible reasoning delta consistently arrived before the first visible content delta

---

## Aggregates

| Metric                       | OpenClaw agent | Direct NanoGPT |
| ---------------------------- | -------------: | -------------: |
| Mean TTFT                    |          37.7s |           6.1s |
| Median TTFT                  |          32.6s |           5.5s |
| Mean total latency           |          37.7s |           6.3s |
| Median total latency         |          32.7s |           5.6s |
| Median first reasoning delta |              — |           1.4s |

Using the median values:

- user-visible OpenClaw agent overhead before first reply was roughly **27.2s** beyond the direct call path
- the direct path was roughly **5.9x faster** to first visible content
- the direct path was roughly **5.8x faster** end-to-end

---

## Interpretation

The direct NanoGPT streaming path started returning model output within a few seconds. The OpenClaw agent path, by contrast, took roughly half a minute before the user saw the first visible reply text.

That gap likely includes more than raw provider transport time. In this measurement, the OpenClaw side bundled together:

- agent orchestration
- session plumbing
- prompt/context assembly
- hooks and memory-related work
- reply presentation behavior in the CLI

One especially relevant factor is that the OpenClaw config at measurement time had `blockStreamingDefault: "on"`. That matched the observed behavior here: the CLI did not surface partial tokens for the tested turn, so user-visible TTFT effectively collapsed into final completion latency.

The first OpenClaw trial was notably slower than trials 2 and 3, which suggests some amount of first-turn or cold-path overhead.

The direct second trial is also worth noting. It shows that `moonshotai/kimi-k2.5:thinking` can still emit visible reasoning-oriented content rather than a clean tiny final answer, even for a minimal prompt that tries to force a trivial response.

---

## Caveats

- this compared a **full OpenClaw agent turn** against a **raw direct NanoGPT API call**; it is not a pure provider-transport microbenchmark
- the OpenClaw numbers are **user-visible CLI timings**, not a direct measurement of when upstream NanoGPT first emitted tokens internally
- only three trials were run per path
- one direct trial produced atypical output, so medians are more representative than means here
- network conditions and provider-side load likely contributed to variance

---

## Follow-up ideas

- compare `openclaw agent` vs `openclaw infer model run --gateway` vs direct NanoGPT to isolate where the extra latency is introduced
- repeat the benchmark with streamed reply blocking disabled so user-visible TTFT can be measured under incremental output
- rerun with a non-thinking Kimi variant or stricter output constraints to see whether the direct-path outlier is specific to the reasoning model

---

## Cleanup confirmation

- original OpenClaw default model was restored to `minimax-portal/MiniMax-M2.7`
