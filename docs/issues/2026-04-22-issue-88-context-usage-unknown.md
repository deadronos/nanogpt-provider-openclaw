# Issue 88: `/status` shows `?/200k` for `nanogpt/openai/gpt-5.4-mini`

**Issue:** https://github.com/deadronos/nanogpt-provider-openclaw/issues/88  
**Date:** 2026-04-22

## Symptom

One user reported OpenClaw’s `/status` context usage showing `?/200k` when using the NanoGPT model id:

- `nanogpt/openai/gpt-5.4-mini`

but showing a normal “used/max” number for other NanoGPT models (example families mentioned: GLM, Kimi).

Interpretation: OpenClaw knows the model’s **max context window** (here: `200k`), but does not have a reliable “tokens used” value for the current session/turn, so it prints `?` for the numerator.

## How this can happen (in this plugin)

This repository does **not** compute tokens client-side. It relies on OpenClaw’s normal usage pipeline for OpenAI-compatible streaming transports:

- When OpenClaw believes a model supports “usage in streaming”, it adds `stream_options.include_usage: true` on OpenAI Chat Completions streams.
- If the upstream stream includes a final usage-only SSE chunk, OpenClaw can track prompt/completion token usage and `/status` displays a concrete numerator.
- If the upstream stream does **not** include usage (or it is not parseable by OpenClaw), OpenClaw can only display the denominator (`contextWindow`) and prints `?/<contextWindow>`.

### 1) `supportsUsageInStreaming` compat is only patched for `openai-completions`

The NanoGPT plugin opts completions-mode models into streaming usage compat via:

- `provider/catalog-hooks.ts` → `applyNanoGptNativeStreamingUsageCompat(...)`

That patch only applies when `providerConfig.api === "openai-completions"`. If the NanoGPT provider is configured to use the Responses transport (`requestApi: "responses"`), this patch is skipped, meaning OpenClaw may never request `stream_options.include_usage` for those turns.

In that case, if NanoGPT does not include usage by default on streams, `/status` can display `?/200k`.

### 2) An explicit `supportsUsageInStreaming: false` is preserved

`applyNanoGptNativeStreamingUsageCompat(...)` intentionally does **not** override an explicit `compat.supportsUsageInStreaming` value.

So if the user’s generated `<agentDir>/models.json` (or another config source) sets:

- `compat.supportsUsageInStreaming: false`

for `openai/gpt-5.4-mini`, then OpenClaw will not request `stream_options.include_usage` and the numerator may remain unknown (`?`).

### 3) NanoGPT may not emit usage for some upstream providers/models (even when requested)

Even if OpenClaw requests `stream_options.include_usage`, OpenClaw can only show a concrete numerator if the NanoGPT upstream stream actually includes a usage payload.

It’s plausible (and consistent with the report) that NanoGPT:

- emits usage for some upstream providers/models (GLM, Kimi, …), but
- does not emit usage for `openai/gpt-5.4-mini` on the chosen routing/transport path.

This repo currently does not add a NanoGPT-specific SSE parser or a post-hoc usage reconciliation layer; `wrapStreamFn` is pass-through (`provider/stream-hooks.ts`), so there’s no plugin-side repair for missing usage chunks.

## What to check to confirm the root cause

1. Inspect the generated provider snapshot:

- `<agentDir>/models.json` (see `models.ts` → `resolveNanoGptAgentDir(...)` for how `agentDir` is inferred)

Verify for the `nanogpt` provider:

- `api` is `openai-completions` (vs `openai-responses`)
- the model entry for `openai/gpt-5.4-mini` does **not** set `compat.supportsUsageInStreaming: false`

2. If `api` is `openai-responses`, confirm whether OpenClaw is emitting usage for Responses streaming at all, and whether NanoGPT forwards it.

3. If `api` is `openai-completions` and `supportsUsageInStreaming` is true, capture one raw streamed response and check whether any SSE chunk contains a `usage` object.

## Notes / likely next steps

- If the issue is “NanoGPT does not return usage in streaming for that model”, this plugin can’t invent correct token counts without implementing client-side tokenization (out of scope for the current design).
- A mitigation is to force `stream_options.include_usage` on NanoGPT completions streams (unless a model explicitly sets `compat.supportsUsageInStreaming: false`), and emit a loud-but-nonblocking warning if the final streamed result still has empty/invalid usage. This makes the “missing usage” failure mode visible in OpenClaw logs without breaking requests.
