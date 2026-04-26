# OpenClaw provider capability surface audit (2026-04-26)

This report compares the current OpenClaw checkout at `/Users/openclaw/Github/openclaw` version `2026.4.26` against the `nanogpt-provider-openclaw` plugin.

It is a follow-up to the earlier April audit and focuses on whether the newer OpenClaw provider hooks introduce any breaking compatibility issues for this plugin.

## Scope notes

- Included: the current `ProviderPlugin` surface, top-level provider registration APIs, and the NanoGPT plugin’s `registerProvider(...)` implementation.
- Included: the new optional provider hooks that appeared in the current OpenClaw source.
- Excluded: unrelated UI, command, and gateway behavior.

## High-level summary

- No breaking compatibility changes were found for the hooks NanoGPT already implements.
- OpenClaw 2026.4.26 adds a cluster of new optional provider hooks around dynamic model preparation, transport normalization, caching policy, thinking/profile selection, prompt transforms, auth/profile resolution, and error messaging.
- NanoGPT already satisfies the required `label` field on `ProviderPlugin` and keeps using the stable core provider hooks.
- The current OpenClaw SDK still exposes the broader non-text provider registration APIs, and NanoGPT’s web search and image generation registrations remain aligned with them.

## Current compatibility matrix

| Surface | OpenClaw 2026.4.26 contract | NanoGPT status | Verdict |
| --- | --- | --- | --- |
| Provider identity and core text provider surface | `label`, `catalog`, `resolveDynamicModel`, `normalizeResolvedModel`, `normalizeToolSchemas`, `inspectToolSchemas`, `resolveReasoningOutputMode`, `wrapStreamFn`, `matchesContextOverflowError`, `classifyFailoverReason`, `applyNativeStreamingUsageCompat`, `resolveUsageAuth`, `fetchUsageSnapshot`, `augmentModelCatalog` | Implemented in `index.ts` and the provider hook modules | Compatible |
| Replay / tool-shape hooks | `buildReplayPolicy`, `sanitizeReplayHistory`, `validateReplayTurns` | Implemented via `provider/replay-hooks.ts` | Compatible |
| New optional model / policy hooks | `prepareDynamicModel`, `preferRuntimeResolvedModel`, `normalizeTransport`, `isCacheTtlEligible`, `buildMissingAuthMessage`, `buildUnknownModelHint`, `suppressBuiltInModel` | Not implemented | Non-breaking; optional follow-up only |
| New thinking / prompt / auth hooks | `resolveThinkingProfile`, `resolveSystemPromptContribution`, `resolvePromptOverlay`, `followupFallbackRoute`, `resolveAuthProfileId`, `transformSystemPrompt`, `textTransforms`, `applyConfigDefaults`, `isModernModelRef`, `formatApiKey`, `resolveSyntheticAuth`, `resolveExternalAuthProfiles`, `shouldDeferSyntheticProfileAuth`, `onModelSelected` | Not implemented | Non-breaking; optional follow-up only |
| Web search and image generation registration | `registerWebSearchProvider`, `registerImageGenerationProvider` | Both are registered in `index.ts` | Compatible |
| Other provider families still available in OpenClaw | `registerSpeechProvider`, `registerMediaUnderstandingProvider`, `registerRealtimeTranscriptionProvider`, `registerRealtimeVoiceProvider`, `registerVideoGenerationProvider`, `registerMusicGenerationProvider` | Not implemented by NanoGPT | Not a compatibility issue; just unimplemented surfaces |

## New OpenClaw hooks worth noting

OpenClaw 2026.4.26 now exposes the following additional optional seams in `src/plugins/types.ts`:

- `prepareDynamicModel` and `preferRuntimeResolvedModel` for async model warm-up and runtime model preference.
- `normalizeTransport` for transport-family normalization.
- `isCacheTtlEligible` for cache TTL policy decisions.
- `resolveThinkingProfile` as the preferred replacement for the older thinking hooks.
- `resolveSystemPromptContribution`, `resolvePromptOverlay`, `followupFallbackRoute`, `transformSystemPrompt`, and `textTransforms` for prompt shaping.
- `resolveAuthProfileId`, `resolveSyntheticAuth`, `resolveExternalAuthProfiles`, `shouldDeferSyntheticProfileAuth`, and `formatApiKey` for richer auth/profile resolution.
- `applyConfigDefaults`, `isModernModelRef`, `onModelSelected`, `suppressBuiltInModel`, `buildMissingAuthMessage`, and `buildUnknownModelHint` for selection, defaults, and operator-facing messaging.

These are all optional. None of them are required for the NanoGPT plugin to keep working with the current OpenClaw provider surface.

## Thinking-profile note

The new `resolveThinkingProfile` seam is the most visible behavior change from a compatibility perspective, but NanoGPT already persists reasoning metadata through its current normalization path:

- `runtime/dynamic-models.ts` derives `reasoning` from `:(thinking|reasoning)` model ids.
- `provider/catalog-hooks.ts` preserves `definition.reasoning` when it normalizes models.

So the plugin does not rely on the deprecated thinking hooks, and the new OpenClaw hook is an optional future enhancement rather than a compatibility fix.

## Practical takeaway

The current OpenClaw 2026.4.26 source still treats NanoGPT as a compatible provider plugin. The new upstream hooks expand the available customization surface, but they do not invalidate the plugin’s existing registration or runtime behavior.

If you want to extend NanoGPT to take advantage of the new seams, the best follow-up candidates are `resolveThinkingProfile`, the auth/profile hooks, and the prompt-transform hooks. None of them are required to keep the plugin compatible today.

## Reference anchors

- Current OpenClaw provider type surface: `/Users/openclaw/Github/openclaw/src/plugins/types.ts:1184`, `/Users/openclaw/Github/openclaw/src/plugins/types.ts:1242`, `/Users/openclaw/Github/openclaw/src/plugins/types.ts:1281`, `/Users/openclaw/Github/openclaw/src/plugins/types.ts:1415`, `/Users/openclaw/Github/openclaw/src/plugins/types.ts:1453`, `/Users/openclaw/Github/openclaw/src/plugins/types.ts:1541`, `/Users/openclaw/Github/openclaw/src/plugins/types.ts:1567`, `/Users/openclaw/Github/openclaw/src/plugins/types.ts:1673`, `/Users/openclaw/Github/openclaw/src/plugins/types.ts:1712`, `/Users/openclaw/Github/openclaw/src/plugins/types.ts:2135`
- NanoGPT provider registration: `/Users/openclaw/Github/nanogpt-provider-openclaw/index.ts:65`, `/Users/openclaw/Github/nanogpt-provider-openclaw/index.ts:67`, `/Users/openclaw/Github/nanogpt-provider-openclaw/index.ts:87`, `/Users/openclaw/Github/nanogpt-provider-openclaw/index.ts:93`, `/Users/openclaw/Github/nanogpt-provider-openclaw/index.ts:98`, `/Users/openclaw/Github/nanogpt-provider-openclaw/index.ts:103`, `/Users/openclaw/Github/nanogpt-provider-openclaw/index.ts:114`
