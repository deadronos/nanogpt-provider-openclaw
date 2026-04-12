# NanoGPT Live API Findings

**Date:** 2026-04-12
**Scope:** Manual NanoGPT API validation for model catalog behavior, model-id behavior, and endpoint compatibility
**Model under test:** `moonshotai/kimi-k2.5:thinking`

---

## Summary

Manual live API checks showed that `moonshotai/kimi-k2.5:thinking` is a valid NanoGPT model for the tested account and key.

Key findings:

- the model appears in both the canonical and subscription NanoGPT model catalogs
- direct inference works on both Chat Completions endpoints
- direct inference works on the base Responses endpoint
- the subscription Responses endpoint returns `404`
- OpenClaw/plugin failures were therefore not caused by the model being absent from NanoGPT's API catalog
- one real plugin issue was endpoint selection for `requestApi: "responses"` when routing resolved to subscription mode

---

## Live endpoint matrix

### Catalog discovery

| Endpoint | Result | Notes |
| --- | ---: | --- |
| `GET https://nano-gpt.com/api/v1/models?detailed=true` | `200` | Returned ~276 models; included `moonshotai/kimi-k2.5:thinking` |
| `GET https://nano-gpt.com/api/subscription/v1/models?detailed=true` | `200` | Returned ~276 models; included `moonshotai/kimi-k2.5:thinking` |

Observed catalog facts:

- `moonshotai/kimi-k2.5:thinking` was present in both tested catalog responses
- display name reported by NanoGPT: **Kimi K2.5 Thinking**
- this disproved the earlier suspicion that the API catalog omitted the model entirely

### Inference endpoints

| Endpoint | Transport | Result | Notes |
| --- | --- | ---: | --- |
| `POST https://nano-gpt.com/api/v1/chat/completions` | Chat Completions | `200` | Accepted `moonshotai/kimi-k2.5:thinking` |
| `POST https://nano-gpt.com/api/subscription/v1/chat/completions` | Chat Completions | `200` | Accepted `moonshotai/kimi-k2.5:thinking` |
| `POST https://nano-gpt.com/api/v1/responses` | Responses | `200` | Accepted `moonshotai/kimi-k2.5:thinking` |
| `POST https://nano-gpt.com/api/subscription/v1/responses` | Responses | `404` | Returned non-JSON HTML body |

### Responses API nuance

A first probe against `POST /api/v1/responses` used too small a token limit and returned:

- `400 invalid_request_error`
- message: `max_output_tokens must be at least 16`

Retrying with `max_output_tokens: 16` succeeded.

---

## Response details observed

### Chat Completions

Both completions endpoints returned `200` for the tested model.

Observed behavior:

- NanoGPT echoed the requested model as `moonshotai/kimi-k2.5:thinking`
- `finish_reason` was `stop`
- the assistant `content` was empty in the minimal test payload
- a reasoning snippet and usage accounting were present

Implication:

- the model request itself was accepted
- the OpenClaw-side issue was not a simple "unknown model id" rejection by NanoGPT

### Responses

The base Responses endpoint returned `200` with:

- `object: response`
- `model: moonshotai/kimi-k2.5:thinking`
- `status: completed`

The subscription Responses endpoint returned `404`, which strongly suggests that NanoGPT does not expose a working subscription-scoped Responses surface at:

- `https://nano-gpt.com/api/subscription/v1/responses`

---

## What this means for the plugin

### Confirmed non-issue

The model `moonshotai/kimi-k2.5:thinking` should **not** be treated as missing from NanoGPT's API catalog for the tested account.

That means the earlier theory:

- "the website lists it but the API catalog does not"

was not supported by the live results gathered here.

### Confirmed issue

The combination below was broken in practice:

- `routingMode: "subscription"`
- `requestApi: "responses"`

Why:

- the plugin originally resolved request base URL from routing mode alone
- subscription routing therefore selected `https://nano-gpt.com/api/subscription/v1`
- Responses requests then targeted `https://nano-gpt.com/api/subscription/v1/responses`
- that endpoint returned `404`
- there was no fallback to the working base endpoint

### Plugin fix applied

The plugin was updated so that:

- Chat Completions in subscription mode still use the subscription endpoint
- Responses requests in subscription mode now use the base endpoint

Specifically, the plugin now routes this combination to:

- `https://nano-gpt.com/api/v1`

instead of:

- `https://nano-gpt.com/api/subscription/v1`

This keeps the known-good Chat Completions behavior while avoiding the broken subscription Responses path.

---

## Model-id handling notes

During investigation, one possible explanation was that NanoGPT might expose a different API id than the website-facing model label. Live testing did **not** support rewriting `moonshotai/kimi-k2.5:thinking` to a different model for this account.

Notably:

- `moonshotai/kimi-k2.5:thinking` worked directly on live inference endpoints
- the model appeared in the live catalog responses
- rewriting it to a different model id would therefore be unsafe

As a result, the safer provider behavior is:

- preserve the exact NanoGPT model id when the user/config explicitly requests it
- only treat endpoint/transport mismatches as compatibility issues when they are confirmed by live behavior

---

## Practical conclusions

1. **The model is real and usable** for the tested NanoGPT account.
2. **The base Responses endpoint works** for the tested model.
3. **The subscription Responses endpoint does not work** and returned `404` during live testing.
4. **The plugin needed endpoint fallback logic**, not model substitution logic, for the main failure observed.
5. If OpenClaw still shows old behavior after these fixes, the next likely cause is a stale installed plugin copy under `~/.openclaw/extensions/nanogpt` rather than the checked-out workspace code.

---

## Follow-up ideas

- add an integration-style smoke test path for NanoGPT endpoints behind an opt-in env flag
- document that NanoGPT Responses currently uses the base API URL even when routing mode resolves to subscription
- if NanoGPT later ships a working subscription Responses endpoint, re-evaluate the fallback behavior
- optionally capture provider-side warning text when a subscription Responses path returns `404` so operators can diagnose endpoint mismatches more quickly
