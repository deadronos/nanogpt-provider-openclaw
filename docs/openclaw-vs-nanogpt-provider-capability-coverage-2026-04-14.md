# OpenClaw vs NanoGPT provider capability coverage audit (2026-04-14)

This report compares:

- the **provider capability surface OpenClaw can consume** from `node_modules/openclaw@2026.4.8`, and
- the **capability surface this NanoGPT plugin currently implements**.

It complements:

- `docs/nanogpt-api-surface-coverage-audit-2026-04-14.md` — NanoGPT endpoint-level coverage
- `docs/openclaw-provider-capability-surface-audit-2026-04-14.md` — OpenClaw capability map

## Rating legend

- 🟢 **Green** — explicitly implemented against the relevant OpenClaw capability family.
- 🟡 **Yellow** — partial implementation, subset-only support, or OpenClaw surface is only partly satisfied.
- 🔴 **Red** — OpenClaw supports the capability family, but this NanoGPT plugin does not implement it.

## Scope notes

- This is an **OpenClaw-surface** comparison, not a rehash of every raw NanoGPT endpoint.
- I still use NanoGPT endpoint evidence when deciding whether an OpenClaw gap is worth filling.
- Priority is weighted toward the goals you stated: **text/chat, image generation, web search, maybe embeddings**. Video is low priority. Audio is interesting but likely pay-as-you-go-first.

## Bottom line

- **Strongly covered today:** text/chat provider integration; onboarding/auth; dynamic model/catalog hooks; usage snapshots; basic web search; curated image generation/edit.
- **Best next missing surface:** embeddings.
- **Best optional expansion after embeddings:** audio transcription and TTS.
- **Reason to defer:** realtime voice, video generation, and music generation are supported by OpenClaw but do not appear to be near-term priorities for this plugin.

## Coverage matrix

| OpenClaw capability family | User-facing OpenClaw surface | Rating | Current NanoGPT plugin coverage | Key repo refs | Suggested next move |
| --- | --- | --- | --- | --- | --- |
| Text inference provider core | `openclaw infer model run`; `list`; `inspect`; `providers`; provider auth | 🟢 | Core text-provider registration is explicit. The plugin builds NanoGPT text providers, model discovery, catalog routing, request API selection, and provider pricing enrichment. | `index.ts:354`; `provider-catalog.ts:54`; `runtime.ts:290`; `runtime.ts:353`; `runtime.ts:378`; `provider-catalog.test.ts:21`; `provider-catalog.test.ts:90`; `openclaw-discovery.test.ts:254` | Keep as the primary focus area. This is already the strongest part of the plugin. |
| Provider onboarding and auth | OpenClaw provider setup and saved config/auth flows | 🟢 | The plugin exposes API-key auth plus onboarding/config wiring for NanoGPT-specific settings. | `index.ts:5`; `onboard.ts:7`; `onboard.ts:26`; `openclaw.plugin.json:8-76`; `onboard.test.ts:1-41` | No immediate change needed. |
| Dynamic model resolution and catalog augmentation | Model selection/runtime resolution paths | 🟢 | The plugin implements `augmentModelCatalog`, `normalizeResolvedModel`, `resolveDynamicModel`, and native streaming-usage compat. | `index.ts:396-407`; `runtime.ts:227-241`; `index.test.ts:139-183`; `index.test.ts:210-337`; `runtime.test.ts:577`; `runtime.test.ts:606` | Keep; this is important forward-compat glue for NanoGPT's fast-moving model IDs. |
| Usage / quota reporting | `/usage` and related provider reporting | 🟢 | The plugin implements `resolveUsageAuth` and `fetchUsageSnapshot` and maps NanoGPT subscription windows into OpenClaw usage snapshots. | `index.ts:409-410`; `runtime.ts:550-604`; `runtime.test.ts:179`; `openclaw-discovery.test.ts:254`; `docs/nanogpt-api-surface-coverage-audit-2026-04-14.md:107` | No immediate change needed. |
| Provider-owned runtime auth exchange | `prepareRuntimeAuth`-style runtime token exchange before inference | 🔴 | No `prepareRuntimeAuth` hook is implemented. | `index.ts:354-410`; `runtime.ts:1-604` | Low priority unless NanoGPT adds runtime token exchange or browser/session-to-bearer flows. |
| Provider-owned embeddings | `openclaw infer embedding create`; memory/search embedding adapter path | 🔴 | No `createEmbeddingProvider` hook and no memory embedding adapter registration exist in this plugin. | `index.ts:354-414`; `runtime.ts:1-604`; `api.ts:1-18` | **Highest-value next addition.** Add embeddings via `createEmbeddingProvider` so OpenClaw can call NanoGPT embeddings cleanly. |
| Web search provider | `openclaw infer web search`; `providers` | 🟡 | Implemented as a dedicated `web_search` provider, but only for a narrow NanoGPT subset: `query`, `count`, `includeDomains`, `excludeDomains`, with fixed provider/depth/output mode. | `index.ts:413`; `web-search.ts:120-177`; `web-search.test.ts:104-132`; `docs/nanogpt-api-surface-coverage-audit-2026-04-14.md:75-76` | Expand request mapping to expose richer NanoGPT search options that OpenClaw can already route through the tool contract. |
| Web fetch provider | `openclaw infer web fetch`; `providers` | 🔴 | No `registerWebFetchProvider(...)` implementation. | `index.ts:354-414`; `web-search.ts:1-204` | Medium/low priority. Add only if NanoGPT's scrape/fetch surfaces become important to your workflows. |
| Image generation and edit | `openclaw infer image generate`; `edit`; `providers` | 🟡 | Dedicated image-generation provider exists with curated models, size validation, text-to-image, and edit flows, but it covers only a subset of what both OpenClaw and NanoGPT can support. | `index.ts:414`; `image-generation-provider.ts:69-129`; `image-generation-provider.test.ts:115-215`; `docs/nanogpt-api-surface-coverage-audit-2026-04-14.md:89-91` | Good area to deepen after embeddings: broaden models, geometry, and advanced request options. |
| Media understanding: audio transcription | `openclaw infer audio transcribe` | 🔴 | No `registerMediaUnderstandingProvider(...)` implementation and no `transcribeAudio` support. | `index.ts:354-414`; `runtime.ts:1-604`; `web-search.ts:1-204`; `image-generation-provider.ts:1-229` | **Good optional next step after embeddings.** NanoGPT has strong STT endpoints that map well here. |
| Media understanding: image description | `openclaw infer image describe`; `describe-many` | 🔴 | No media-understanding implementation for image analysis. | `index.ts:354-414` | Low/medium priority unless you want multimodal analysis in addition to generation. |
| Media understanding: video description | `openclaw infer video describe` | 🔴 | No media-understanding implementation for video analysis. | `index.ts:354-414` | Low priority for this plugin. |
| Speech / TTS | `openclaw infer tts convert`; `voices`; `providers`; `status` | 🔴 | No `registerSpeechProvider(...)` implementation. | `index.ts:354-414`; `api.ts:1-18` | **Reasonable optional add-on.** Best fit is NanoGPT `POST /api/v1/audio/speech` for sync TTS, with optional `/api/tts` polling support. |
| Realtime transcription | Live STT session flows | 🔴 | No `registerRealtimeTranscriptionProvider(...)` implementation. | `index.ts:354-414` | Low priority. I did not find a clear NanoGPT realtime STT surface worth targeting yet. |
| Realtime voice | Duplex live voice flows | 🔴 | No `registerRealtimeVoiceProvider(...)` implementation. | `index.ts:354-414` | Low priority. No obvious NanoGPT duplex realtime voice surface surfaced in the current docs scan. |
| Video generation | `openclaw infer video generate` | 🔴 | No `registerVideoGenerationProvider(...)` implementation. | `index.ts:354-414` | Low priority, per your stated goals. |
| Music generation | Plugin/runtime music-generation family | 🔴 | No `registerMusicGenerationProvider(...)` implementation. | `index.ts:354-414` | Low priority. Useful only if music becomes an explicit product goal. |

## Where the plugin is already a strong OpenClaw citizen

The plugin already uses several of the most valuable OpenClaw provider seams well:

- `registerProvider(...)` for text/chat
- `augmentModelCatalog(...)` for forward-compat model rows
- `normalizeResolvedModel(...)` and `resolveDynamicModel(...)` for pass-through and suffix-style model support
- `applyNativeStreamingUsageCompat(...)` for usage-in-stream compatibility
- `resolveUsageAuth(...)` plus `fetchUsageSnapshot(...)` for subscription reporting
- `registerWebSearchProvider(...)` for a dedicated web-search capability
- `registerImageGenerationProvider(...)` for dedicated image generation/editing

That is a good foundation. The main story is not “OpenClaw is missing features”; it is “the plugin currently uses only a subset of the features OpenClaw already exposes.”

## Recommended next steps, ranked for your goals

### 1. Add embeddings first

Why this is the best next move:

- It directly matches your “maybe embeddings” priority.
- OpenClaw already has a clean headless surface: `openclaw infer embedding create`.
- NanoGPT already documents embeddings as a real API surface.
- Embeddings also unlock future memory/search integrations, not just one-off vector creation.

Best OpenClaw fit:

- add `createEmbeddingProvider(...)` on the NanoGPT text provider
- optionally add config/docs so users understand embeddings are likely **paygo-first**, not subscription-backed

### 2. Add audio transcription before TTS if you want one audio feature first

Why it ranks ahead of TTS:

- OpenClaw's `audio transcribe` fits especially well with NanoGPT's documented STT surfaces
- transcription is often more generally useful for agent workflows than speech synthesis
- NanoGPT exposes both a simple OpenAI-compatible STT path and a richer async/diarization path

Best OpenClaw fit:

- implement `registerMediaUnderstandingProvider({ transcribeAudio })`
- start with `POST /api/v1/audio/transcriptions` for the simplest contract
- optionally add the richer `/api/transcribe` plus `/api/transcribe/status` path later for diarization and large-file workflows

### 3. Add TTS after STT if audio becomes a real product goal

Best OpenClaw fit:

- implement `registerSpeechProvider({ synthesize, listVoices? })`
- prefer `POST /api/v1/audio/speech` for low-latency synchronous TTS
- optionally fall back to `POST /api/tts` plus `GET /api/tts/status` for long-running or async models

### 4. Deepen the already-existing web-search integration

This is probably the highest-impact improvement among surfaces you already support.

OpenClaw's web-search provider contract is flexible, but the current NanoGPT implementation hard-codes:

- `provider: "linkup"`
- `depth: "standard"`
- `outputType: "searchResults"`

So there is room to expose more of NanoGPT's own search surface without any OpenClaw core change.

### 5. Expand image generation later, but only after embeddings/web-search/audio

You already have working image generation. That means improving it is an optimization step, not a capability unlock.

Good future work:

- broader model coverage
- richer geometry support
- advanced per-model request options
- hosted URL responses or mask/inpainting support where useful

## Suggested product stance from here

If the target product surface is mostly **text/chat + image generation + web search + maybe embeddings**, the pragmatic roadmap is:

1. keep text/chat as the center of gravity
2. add embeddings next
3. deepen web search
4. optionally add STT, then TTS
5. defer video, music, realtime voice, and richer media analysis until there is a concrete need

## Audio note

I also wrote a focused audio appendix in `docs/nanogpt-audio-openclaw-fit-and-pricing-2026-04-14.md`.

That document maps NanoGPT's TTS/STT endpoints onto OpenClaw's audio-related capability families and summarizes the current NanoGPT pricing docs. Short version: audio looks feasible, but it should be treated as **pay-as-you-go-first** rather than subscription-backed.
