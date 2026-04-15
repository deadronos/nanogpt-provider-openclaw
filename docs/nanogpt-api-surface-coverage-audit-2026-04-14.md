# NanoGPT API surface coverage audit (2026-04-14)

This report compares NanoGPT's documented public API surfaces against what this repository explicitly implements.

It is based on:

- NanoGPT's docs sitemap plus linked API-reference pages.
- This repository's implementation files, plugin metadata, and tests.
- **This repo only** — not the broader OpenClaw core unless this plugin explicitly wires the behavior.

## Rating legend

- 🟢 **Green** — explicitly implemented here, with strong runtime wiring and/or direct tests.
- 🟡 **Yellow** — partially implemented, subset-only, pass-through-only, or wired without full surface coverage.
- 🔴 **Red** — no dedicated implementation in this repo.

## Scope notes

- Concrete endpoints and cross-cutting integration behaviors are scored below.
- Guide/index pages like `text-generation`, `image-generation`, `video-generation`, `speech-to-text`, `text-to-speech`, `embeddings`, and `tee-verification` were used to find surfaces, but the concrete endpoints they describe are what get scored.
- Docs-only/support pages such as `javascript`, `typescript`, `chrome-extension`, `for-providers`, and `auto-recharge` are **not** scored as standalone API surfaces.
- `Locations` lists the most relevant implementation/test anchors, not an exhaustive call graph.

## High-level takeaways

- Strong coverage today is concentrated in:
  - text model discovery/routing,
  - OpenAI chat-completions transport,
  - opt-in OpenAI responses transport,
  - provider-selection pricing lookup and request headers,
  - direct NanoGPT web search in a basic subset,
  - NanoGPT image generation/editing in a curated subset,
  - subscription usage snapshots.
- Partial coverage mostly means one of two things:
  - the repo exposes only a **subset** of a wider NanoGPT surface, or
  - the surface may work only as **pass-through** behavior because the repo preserves raw model IDs / base transport choices without adding first-class wrappers.
- Entirely uncovered families are embeddings, Anthropic `messages`, legacy `completions`, video, TTS/STT/music, voice cloning, standalone memory, account/deposit/team/payment surfaces, X-402 helper flows, and TEE verification endpoints.

## Text, catalogs, and routing

| Surface | Rating | Coverage in this repo | Key locations | Main gaps |
| --- | --- | --- | --- | --- |
| `GET /api/v1/models`; `GET /api/subscription/v1/models` | 🟢 | Core model discovery is explicitly implemented, including `?detailed=true` handling, routing-aware catalog choice, fallback models, and provider metadata normalization. | `models.ts:5`; `runtime.ts:341`; `runtime.ts:353`; `runtime.ts:378`; `provider-catalog.ts:54`; `runtime.test.ts:112`; `openclaw-discovery.test.ts:254` | No issue here for the core canonical/subscription text-catalog path. |
| `GET /api/paid/v1/models` | 🟡 | The base URL and `catalogSource: "paid"` plumbing exist, so the repo can target the paid-only catalog. | `models.ts:6`; `models.ts:12`; `runtime.ts:353`; `openclaw.plugin.json:37`; `README.md:122` | No dedicated tests or repo-specific behaviors validating the paid-only catalog path. |
| `GET /api/personalized/v1/models` | 🟡 | The base URL and `catalogSource: "personalized"` path are wired in. | `models.ts:7`; `models.ts:12`; `runtime.ts:353`; `openclaw.plugin.json:37`; `README.md:122` | No direct tests for personalized catalog fetches; no support for the related visibility-management endpoints documented by NanoGPT. |
| `GET /api/models/:canonicalId/providers` | 🟢 | Provider-selection pricing discovery is explicitly implemented and fed into model metadata. | `runtime.ts:420`; `runtime.ts:453`; `runtime.ts:517`; `runtime.test.ts:716`; `provider-catalog.test.ts:204` | Only the pricing-discovery path is covered; persistent NanoGPT provider-preferences APIs are not. |
| `POST /api/v1/chat/completions` | 🟢 | This is the repo's primary text-generation transport. The plugin builds an OpenClaw provider using NanoGPT base URLs, discovered models, dynamic model resolution, and native streaming-usage compat. | `runtime.ts:290`; `runtime.ts:367`; `provider-catalog.ts:54`; `provider-catalog.ts:92`; `index.ts:389`; `index.ts:406`; `index.ts:407`; `provider-catalog.test.ts:90` | NanoGPT-specific chat subfeatures like prompt-caching helpers, memory flags, and advanced web-search bodies are not first-class repo features; they are scored separately below. |
| `POST /api/v1/responses` | 🟡 | The plugin can switch the text provider to `openai-responses` via `requestApi: "responses"`, and has subscription-routing fallback logic for that transport. | `models.ts:22`; `runtime.ts:290`; `runtime.ts:371`; `provider-catalog.ts:25`; `provider-catalog.ts:92`; `runtime.test.ts:50`; `provider-catalog.test.ts:21`; `provider-catalog.test.ts:43` | Coverage is transport-level only. The repo does not add wrappers for retrieval, deletion, storage, background polling, or response-encryption flows from the full NanoGPT Responses docs. |
| `GET /api/v1/responses/{id}`; `DELETE /api/v1/responses/{id}`; stored/background response lifecycle | 🔴 | No dedicated implementation. | — | No client/wrapper for stored response retrieval, deletion, background job polling, retention management, or BYOK encryption headers. |
| `POST /api/v1/messages` | 🔴 | No Anthropic Messages transport is registered by this plugin. | — | Anthropic SDK compatibility, tool-use blocks, Anthropic-style SSE, and prompt-caching headers for `messages` are uncovered here. |
| `POST /api/v1/completions` | 🔴 | The repo's `requestApi: "completions"` means OpenAI **chat** completions transport in OpenClaw terms, not NanoGPT's legacy text-completions endpoint. | `README.md:132`; `runtime.ts:293` | No wrapper or tests for NanoGPT's legacy `POST /api/v1/completions` surface. |
| Dynamic NanoGPT model IDs / suffix pass-through | 🟡 | The resolver preserves exact unknown NanoGPT model IDs so requests can still be sent, and it can reuse known catalog metadata when a related template model exists. This likely helps suffix-based NanoGPT variants flow through. | `runtime.ts:227`; `runtime.ts:235`; `runtime.ts:236`; `runtime.test.ts:577`; `runtime.test.ts:606`; `index.ts:406` | Explicitly tested for `:thinking`-style IDs, not for every NanoGPT suffix/flag (`:online`, `:memory`, `:reasoning-exclude`, etc.). Treat as pass-through-only, not first-class support. |

## Cross-cutting text features

| Surface | Rating | Coverage in this repo | Key locations | Main gaps |
| --- | --- | --- | --- | --- |
| Provider selection (`X-Provider`) | 🟢 | Per-request provider override is explicitly wired for text requests, including provider-specific pricing enrichment. | `runtime.ts:420`; `runtime.ts:541`; `provider-catalog.test.ts:113`; `provider-catalog.test.ts:147`; `README.md:137` | No support for NanoGPT's persistent `/api/user/provider-preferences` APIs. |
| Persistent provider preferences (`GET/PATCH/DELETE /api/user/provider-preferences`) | 🔴 | No implementation. | — | User/session-scoped preferred/excluded provider management is not surfaced here. |
| Pay-as-you-go billing override (`billing_mode`, `X-Billing-Mode`) | 🟡 | `routingMode: "paygo"` exists in plugin config, and the repo automatically injects `X-Billing-Mode: paygo` when provider selection would otherwise ride a subscription route. | `openclaw.plugin.json:25`; `runtime.ts:330`; `runtime.ts:543`; `provider-catalog.test.ts:113` | No general-purpose per-request billing-override surface beyond routing config and the provider-selection helper path. |
| Streaming protocol / usage-in-streaming | 🟡 | The plugin explicitly applies native streaming usage compatibility so OpenClaw can consume streaming-usage data from NanoGPT more reliably. | `index.ts:407`; `index.test.ts:145`; `index.test.ts:152`; `index.test.ts:183` | No NanoGPT-specific SSE parser or event handling for Messages/Responses streams in this repo. |
| Extended thinking / reasoning controls | 🟡 | Reasoning-capable model metadata is preserved, and dynamic `:thinking`-style models are supported as pass-through/dynamic IDs. | `runtime.ts:236`; `runtime.ts:240`; `runtime.test.ts:255`; `runtime.test.ts:577`; `runtime.test.ts:606` | No first-class support for `reasoning.exclude`, `reasoning_effort`, `/api/v1legacy/chat/completions`, `/api/v1thinking/chat/completions`, or legacy `reasoning_content` compatibility flags. |
| Prompt caching | 🔴 | No dedicated helper/header wiring. | — | No repo-specific support for `promptCaching` / `prompt_caching`, inline `cache_control`, cache-cut headers, or cache-pricing fields. |
| Context Memory in chat completions (`:memory`, `memory: true`) | 🟡 | Likely limited to pass-through behavior via preserved model IDs / transport, not explicit repo support. | `runtime.ts:227`; `runtime.test.ts:577` | No dedicated config, docs, or tests for NanoGPT memory mode. |
| Standalone memory endpoint (`POST /api/v1/memory`) | 🔴 | No implementation. | — | No wrapper for NanoGPT's standalone memory-compression API. |
| Error-handling surface | 🟡 | Implemented surfaces do add friendly validation and wrapper-specific errors (missing NanoGPT API key, invalid image sizes, unsupported curated image models) and test these behaviors. | `web-search.ts:113`; `image-generation-provider.ts:61`; `image-generation-provider.ts:109`; `image-generation-provider.ts:151`; `web-search.test.ts:45`; `image-generation-provider.test.ts:215` | No generic retry/backoff layer, no explicit `Retry-After` handling, and no special handling for most documented NanoGPT error codes. |
| Rate-limit handling | 🔴 | No dedicated rate-limit support beyond ordinary upstream error propagation. | — | No retry scheduling, daily-limit UX, or `Retry-After` parsing. |
| X-402 payment-challenge flow (`X-X402`, `/api/x402/*`) | 🔴 | No implementation. | — | No opt-in header handling, payment-status polling, or completion endpoints are surfaced here. |
| BYOK request flags and key-management APIs | 🔴 | No implementation. | — | No `x-use-byok`, `x-byok-provider`, `/api/user/provider-keys`, or team BYOK management support. |

## Search, scraping, and related enrichment

| Surface | Rating | Coverage in this repo | Key locations | Main gaps |
| --- | --- | --- | --- | --- |
| Direct web search (`POST /api/web`) | 🟡 | The repo registers a dedicated OpenClaw `web_search` provider backed by NanoGPT's direct web-search endpoint. It supports `query`, `count`, `includeDomains`, and `excludeDomains`, then normalizes results. | `web-search.ts:120`; `web-search.ts:160`; `web-search.ts:173`; `web-search.ts:174`; `web-search.ts:175`; `web-search.ts:176`; `web-search.ts:177`; `index.ts:413`; `web-search.test.ts:104`; `web-search.test.ts:132` | The request is hard-coded to `provider: "linkup"`, `depth: "standard"`, and `outputType: "searchResults"`. No support for `sourcedAnswer`, `structured`, `structuredOutputSchema`, `includeImages`, `fromDate`, `toDate`, or provider-specific knobs. |
| Chat-integrated web search (`:online`, `webSearch`, `linkup` alias) | 🟡 | Possible only as pass-through behavior via raw model IDs / transport; there is no first-class helper for the docs surface. | `runtime.ts:227`; `runtime.test.ts:577` | No explicit support for request-body `webSearch`, provider/depth selection, `search_context_size`, `user_location`, or OpenAI-native web search knobs. |
| Brave-specific search surface (`model: brave/brave-pro/brave-research`, Brave `/api/web` options) | 🔴 | No dedicated implementation. | — | No Brave Answers model support, no Brave provider-field mapping, and no Brave-specific research tuning. |
| URL scraping (`POST /api/scrape-urls`) | 🔴 | No implementation. | — | Standalone scrape API, stealth mode, and formatted markdown scraping are not surfaced here. |
| YouTube transcription (`POST /api/youtube-transcribe`) and chat `youtube_transcripts` helper | 🔴 | No implementation. | — | No standalone transcription wrapper and no chat-level YouTube transcript helper support. |

## Embeddings and images

| Surface | Rating | Coverage in this repo | Key locations | Main gaps |
| --- | --- | --- | --- | --- |
| Embedding model catalog (`GET /api/v1/embedding-models`) | 🔴 | No implementation. | — | No discovery or mapping for NanoGPT embedding models. |
| Embeddings (`POST /api/v1/embeddings`) | 🔴 | No implementation. | — | No embedding request surface, no base64/float encoding controls, no dimensions support. |
| Image generation / edit (`POST /v1/images/generations`) | 🟡 | A dedicated image-generation provider exists with curated model aliases, size validation, text-to-image, single-image edit, and multi-image edit support. | `image-generation-provider.ts:69`; `image-generation-provider.ts:77`; `image-generation-provider.ts:85`; `image-generation-provider.ts:106`; `image-generation-provider.ts:117`; `image-generation-provider.ts:127`; `image-generation-provider.ts:129`; `index.ts:414`; `image-generation-provider.test.ts:115`; `image-generation-provider.test.ts:187` | Coverage is intentionally narrow: curated model allowlist only, `response_format` fixed to `b64_json`, no `maskDataUrl`, no hosted-URL response mode, no model-specific controls like `strength`, `guidance_scale`, `seed`, `num_inference_steps`, or `kontext_max_mode`. |
| Image model catalog (`GET /api/v1/image-models`) | 🔴 | No implementation. | — | The repo currently uses a curated image-model set instead of NanoGPT's image-model listing endpoint. |
| NSFW image classification (`POST /api/nsfw/image`) | 🔴 | No implementation. | — | No binary NSFW classification wrapper. |

## Video and audio/media families

| Surface | Rating | Coverage in this repo | Key locations | Main gaps |
| --- | --- | --- | --- | --- |
| Video model catalog (`GET /api/v1/video-models`) | 🔴 | No implementation. | — | No discovery or metadata mapping for NanoGPT video models. |
| Video generation family (`POST /api/generate-video`, `GET /api/video/status`, `GET /api/generate-video/recover`, `POST /api/generate-video/extend`, `GET /api/generate-video/content`, `POST /api/check-midjourney-status`) | 🔴 | No implementation. | — | Entire async video job surface is uncovered. |
| Audio model catalog (`GET /api/v1/audio-models`) | 🔴 | No implementation. | — | No discovery or metadata mapping for TTS/STT/music model catalogs. |
| Job-based TTS (`POST /api/tts`, `GET /api/tts/status`) | 🔴 | No implementation. | — | No NanoGPT TTS job submission/polling wrapper. |
| OpenAI-compatible audio speech/music (`POST /api/v1/audio/speech`) | 🔴 | No implementation. | — | No wrapper for low-latency TTS or music generation via NanoGPT's audio/speech endpoint. |
| STT family (`POST /api/transcribe`, `POST /api/transcribe/status`, `POST /api/v1/audio/transcriptions`) | 🔴 | No implementation. | — | No speech-to-text or video-to-text wrapper, sync or async. |
| Voice cloning (`POST /api/voice-clone/minimax`, `POST /api/voice-clone/minimax/status`, `POST /api/voice-clone/qwen`, `POST /api/voice-clone/qwen/status`) | 🔴 | No implementation. | — | Entire voice-cloning family is uncovered. |

## Usage, billing, account, payments, and TEE

| Surface | Rating | Coverage in this repo | Key locations | Main gaps |
| --- | --- | --- | --- | --- |
| Subscription usage (`GET /api/subscription/v1/usage`) | 🟢 | Fully explicit. The plugin resolves usage auth and maps NanoGPT daily/monthly quota windows into OpenClaw's usage snapshot surface, including `plan` extraction when present. | `runtime.ts:42`; `runtime.ts:206`; `runtime.ts:550`; `runtime.ts:560`; `runtime.ts:586`; `runtime.ts:592`; `runtime.ts:604`; `index.ts:409`; `index.ts:410`; `runtime.test.ts:179`; `openclaw-discovery.test.ts:254` | This covers quota-window reporting, not the broader NanoGPT account/balance/payment APIs. |
| Account balance + Nano receive (`POST /api/check-balance`, `POST /api/receive-nano`) | 🔴 | No implementation. | — | Balance/deposit address lookup and pending Nano receive flows are uncovered. |
| Deposits / transaction status / FX helpers (`/api/transaction/*`, `/api/get-nano-price`, `/api/get-fiat-prices`) | 🔴 | No implementation. | — | No crypto/fiat deposit or transaction-tracking support. |
| Invitations / referral-link surfaces (`POST /api/invitations/create`, `GET /api/subscription/referral-link`) | 🔴 | No implementation. | — | No invitation or referral link helpers. |
| Teams APIs | 🔴 | No implementation. | — | No session-authenticated team/member/invite/BYOK/usage/allowed-model management support. |
| TEE verification / attestation / signatures (`GET /api/v1/tee/attestation`, `GET /api/v1/tee/signature/{requestId}`) | 🔴 | No implementation. | — | No attestation fetch, signature verification, or TEE-specific request flow support. |

## Practical bottom line

If you look at the repo as a NanoGPT/OpenClaw provider plugin, the current support line is:

- **Strongly covered:** text model discovery, routing, chat-completions transport, responses transport selection, provider pricing lookup, direct web search (basic subset), curated image generation/editing, subscription usage.
- **Partially covered / pass-through only:** dynamic suffix-style models, some streaming/reasoning behavior, paid/personalized text catalogs, limited billing override behavior.
- **Not covered:** nearly every non-text NanoGPT API family and most account/payment/admin APIs.

## Best next expansions if the goal is broader NanoGPT parity

1. Add **embeddings** (`/api/v1/embedding-models`, `/api/v1/embeddings`).
2. Expand `/api/web` support to include **structured output, sourced answers, date filters, images, and provider selection**.
3. Upgrade image support from curated subset to **official image-model discovery + advanced request knobs**.
4. Decide whether this plugin should expose **audio/video** families at all, or keep the scope text/search/image-only.
5. If NanoGPT account features matter inside OpenClaw, add **balance/deposit** surfaces before teams/invitations/TEE.