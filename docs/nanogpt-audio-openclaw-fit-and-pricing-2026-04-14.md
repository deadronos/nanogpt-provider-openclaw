# NanoGPT audio surfaces: OpenClaw fit and pricing (2026-04-14)

This appendix focuses on the audio-related capability families that matter if we later expand this NanoGPT plugin beyond text, image generation, and web search.

It answers three questions:

- Which OpenClaw audio-ish surfaces exist today?
- Which NanoGPT audio endpoints map cleanly onto them?
- What do the current NanoGPT docs say about pricing and sync/async behavior?

## Executive summary

- **Best STT fit for OpenClaw:** `registerMediaUnderstandingProvider({ transcribeAudio })` backed by NanoGPT `POST /api/v1/audio/transcriptions` first, with optional richer async support via `POST /api/transcribe` and `POST /api/transcribe/status` later.
- **Best TTS fit for OpenClaw:** `registerSpeechProvider({ synthesize })` backed by NanoGPT `POST /api/v1/audio/speech` for low-latency TTS, optionally complemented by `POST /api/tts` plus `GET /api/tts/status` for async models.
- **Likely pricing posture:** pay-as-you-go. NanoGPT's audio docs are explicit about per-character or per-minute billing, while this plugin's current usage integration only covers subscription quota windows from `GET /api/subscription/v1/usage`.
- **Realtime voice/realtime STT:** OpenClaw supports these capability families, but I did not find a clear NanoGPT realtime voice/realtime transcription transport worth targeting in the current docs pass.

## OpenClaw audio-related surfaces that matter

| OpenClaw surface                                          | Current OpenClaw contract                                                        | Best NanoGPT fit                                                                                          |
| --------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `registerSpeechProvider(...)`                             | One-shot TTS via `synthesize`; optional telephony output; optional voice listing | `POST /api/v1/audio/speech`; optionally `POST /api/tts` plus `GET /api/tts/status`                        |
| `registerMediaUnderstandingProvider({ transcribeAudio })` | File transcription in `openclaw infer audio transcribe` and related media flows  | `POST /api/v1/audio/transcriptions`; optionally `POST /api/transcribe` plus `POST /api/transcribe/status` |
| `registerRealtimeTranscriptionProvider(...)`              | Live streaming STT sessions                                                      | No clear NanoGPT realtime STT surface found in the scanned docs                                           |
| `registerRealtimeVoiceProvider(...)`                      | Duplex live voice bridge                                                         | No clear NanoGPT duplex realtime voice surface found in the scanned docs                                  |

Key OpenClaw refs:

- `node_modules/openclaw/docs/plugins/sdk-overview.md:307-310`
- `node_modules/openclaw/docs/cli/infer.md:112-114`
- `node_modules/openclaw/docs/cli/infer.md:162-189`
- `node_modules/openclaw/dist/plugin-sdk/src/plugins/types.d.ts:1510-1554`
- `node_modules/openclaw/dist/plugin-sdk/src/media-understanding/types.d.ts:111-120`

## Best endpoint mapping for each future NanoGPT audio feature

| Goal                          | Best NanoGPT endpoint(s)                              | Why it fits OpenClaw well                                                                       | Notes                                                                |
| ----------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Low-latency TTS               | `POST /api/v1/audio/speech`                           | Direct audio bytes back; OpenAI-compatible; maps naturally to `SpeechProviderPlugin.synthesize` | Best default TTS path                                                |
| Async / long-form TTS         | `POST /api/tts`; `GET /api/tts/status`                | Handles queued async models like ElevenLabs; useful when audio is not returned inline           | Good optional second phase                                           |
| Simple STT                    | `POST /api/v1/audio/transcriptions`                   | OpenAI-compatible STT; easy mapping to `transcribeAudio`                                        | Best default STT path                                                |
| Rich STT with diarization     | `POST /api/transcribe`; `POST /api/transcribe/status` | Supports async jobs, diarization, and richer metadata                                           | Good if we want premium STT features                                 |
| YouTube transcript extraction | `POST /api/youtube-transcribe`                        | Useful, but not a direct fit to current OpenClaw audio infer surface                            | Better as a separate tool/integration, not the first audio milestone |
| Music generation              | `POST /api/v1/audio/speech` with music models         | OpenClaw has a music-generation capability family, but this is lower priority                   | Treat separately from TTS                                            |

## NanoGPT TTS surface snapshot

### TTS docs used

- `https://docs.nano-gpt.com/api-reference/text-to-speech`
- `https://docs.nano-gpt.com/api-reference/endpoint/tts`
- `https://docs.nano-gpt.com/api-reference/endpoint/tts-status`
- `https://docs.nano-gpt.com/api-reference/endpoint/speech`

### TTS takeaways

- NanoGPT supports **two TTS modes**:
  - synchronous OpenAI-compatible `POST /api/v1/audio/speech`
  - job-based `POST /api/tts` with `GET /api/tts/status`
- `POST /api/v1/audio/speech` is the cleanest fit for OpenClaw TTS because it returns audio bytes directly and supports `stream: true` for supported models.
- `POST /api/tts` is still useful because some models are naturally async and return `202` plus a polling ticket.
- TTS billing is based on **input characters**, not output file size.

### TTS pricing snapshot from current NanoGPT docs

| Model                   | Pricing in docs      | Notes                                           |
| ----------------------- | -------------------- | ----------------------------------------------- |
| `gpt-4o-mini-tts`       | `$0.0006 / 1k chars` | Cheapest documented TTS option                  |
| `Kokoro-82m`            | `$0.001 / 1k chars`  | Low-cost multilingual option                    |
| `tts-1`                 | `$0.015 / 1k chars`  | OpenAI standard quality                         |
| `tts-1-hd`              | `$0.030 / 1k chars`  | Higher quality; voice instructions              |
| `Elevenlabs-Turbo-V2.5` | `$0.06 / 1k chars`   | Premium; async-friendly; voice controls         |
| `Elevenlabs-V3`         | `Varies`             | Docs do not pin one stable price in the summary |

### TTS implementation recommendation

If we add TTS to this plugin:

1. start with `registerSpeechProvider({ synthesize })`
2. use `POST /api/v1/audio/speech` as the default transport
3. support `response_format` and `instructions` where NanoGPT/OpenAI-compatible models allow them
4. optionally add async fallback for models that want `/api/tts` plus `/api/tts/status`

## NanoGPT STT surface snapshot

### STT docs used

- `https://docs.nano-gpt.com/api-reference/speech-to-text`
- `https://docs.nano-gpt.com/api-reference/endpoint/transcribe`
- `https://docs.nano-gpt.com/api-reference/endpoint/transcribe-status`
- `https://docs.nano-gpt.com/api-reference/endpoint/audio-transcriptions`

### STT takeaways

- NanoGPT supports **two STT styles**:
  - OpenAI-compatible `POST /api/v1/audio/transcriptions`
  - richer `POST /api/transcribe` plus `POST /api/transcribe/status`
- `POST /api/v1/audio/transcriptions` is the easiest OpenClaw fit for `transcribeAudio` because it returns a simple OpenAI-like response.
- `POST /api/transcribe` is better when we want:
  - URL uploads for large files
  - async processing
  - speaker diarization
  - richer metadata and polling
- Docs explicitly price STT by **audio/video duration**.

### STT pricing snapshot from current NanoGPT docs

| Model                       | Pricing in docs  | Notes                                               |
| --------------------------- | ---------------- | --------------------------------------------------- |
| `Whisper-Large-V3`          | `~$0.0005 / min` | Cheapest documented STT option                      |
| `gpt-4o-mini-transcribe`    | `$0.003 / min`   | Good OpenAI-family fit                              |
| `Wizper`                    | `$0.01 / min`    | Faster synchronous option                           |
| `Elevenlabs-STT`            | `$0.03 / min`    | Async; supports diarization and audio-event tagging |
| `openai-whisper-with-video` | `$0.06 / min`    | Video-to-text transcription                         |
| `qwen-voice-clone`          | `$0.25 / run`    | Special workflow, not plain STT                     |
| `minimax-voice-clone`       | `$1.00 / run`    | Special workflow, not plain STT                     |

### STT implementation recommendation

If we add STT to this plugin:

1. implement `registerMediaUnderstandingProvider({ transcribeAudio })`
2. start with `POST /api/v1/audio/transcriptions`
3. optionally layer in `/api/transcribe` plus `/api/transcribe/status` for richer async/diarization workflows
4. clearly document that audio costs are paygo-oriented and not reflected in the current subscription usage snapshot integration

## YouTube transcription note

NanoGPT also documents `POST /api/youtube-transcribe`.

- Price: `$0.01 USD per successful transcript`
- It returns transcript batches and a `summary.totalCost`
- It does **not** map as neatly to `openclaw infer audio transcribe` because it is URL/batch-job-oriented rather than local file transcription

This is probably better as a separate tool or future utility surface than as the first audio capability to add.

## Subscription vs pay-as-you-go reality check

The current plugin's usage support is based on NanoGPT's subscription usage endpoint:

- `runtime.ts:550-604`
- `index.ts:409-410`

That surface reports subscription quota windows. By contrast, NanoGPT's current audio docs describe explicit per-character or per-minute billing for TTS/STT.

So the safest assumption is:

- **text/chat subscription routing** can remain the default for the current plugin
- **audio should be treated as paygo-first** until NanoGPT clearly documents subscription-backed audio entitlements and OpenClaw-side reporting for them

## Recommended order if we decide to add audio

1. **STT first** via `registerMediaUnderstandingProvider({ transcribeAudio })`
2. **TTS second** via `registerSpeechProvider({ synthesize })`
3. only then consider async extras, YouTube transcription, or music generation
4. defer realtime voice / realtime transcription until NanoGPT exposes a clearly suitable live transport

## Small but useful docs finding

The `music-generation` guide says to discover audio models via `GET /api/v1/audio-models`, but the guessed public docs route `https://docs.nano-gpt.com/api-reference/endpoint/audio-models` returned `404` during this audit.

That suggests the **API surface likely exists**, but the docs route or navigation path is not as cleanly exposed as the TTS/STT pages today.
