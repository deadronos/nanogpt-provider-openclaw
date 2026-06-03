# OpenClaw Plugin API Audit — NanoGPT Provider

**Date:** 2026-05-26
**Plugin version:** `@deadronos/nanogpt-provider-openclaw@0.1.2`
**Audited against:** OpenClaw `2026.5.26` (latest)

## Verdict: ✅ Compatible — no breaking changes

All provider hooks, SDK imports, and registration surfaces used by the NanoGPT plugin
are present and unchanged in the latest OpenClaw. The plugin's declared compat range
(`pluginApi >=2026.4.22`) is satisfied.

| Check | Result |
|---|---|
| Typecheck (`tsc --noEmit`) | Clean |
| Tests (`vitest run`) | 33 files / 244 tests pass |
| Lint (`oxlint`) | 0 warnings, 0 errors |
| SDK import paths | All present |
| Provider hooks | All present, no signature changes |

---

## 1. Plugin Entry (`definePluginEntry`)

```ts
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
```

- Signature unchanged: `{ id, name, description, register(api) }`.
- `kind` is deprecated (move to manifest `kind`), but the plugin does not use it.

## 2. Provider Registration (`api.registerProvider`)

All 20 hooks the plugin registers exist in the current `ProviderPlugin` type:

| Hook | Status |
|---|---|
| `id`, `label`, `docsPath`, `envVars` | ✅ Unchanged |
| `auth` (via `createNanoGptApiKeyAuthMethod`) | ✅ Unchanged |
| `catalog` (via `nanoGptProviderCatalog`) | ✅ Unchanged |
| `augmentModelCatalog` | ⚠️ Deprecated — migrate to `api.registerModelCatalogProvider()` for supplemental rows. Still functional. |
| `normalizeResolvedModel` | ✅ Unchanged |
| `resolveDynamicModel` | ✅ Unchanged |
| `applyNativeStreamingUsageCompat` | ✅ Unchanged (`{ providerConfig }` → `ProviderNormalizeConfigContext`) |
| `normalizeToolSchemas` | ✅ Unchanged |
| `inspectToolSchemas` | ✅ Unchanged |
| `resolveUsageAuth` | ✅ Unchanged |
| `fetchUsageSnapshot` | ✅ Unchanged |
| `buildReplayPolicy` | ✅ Unchanged |
| `sanitizeReplayHistory` | ✅ Unchanged |
| `validateReplayTurns` | ✅ Unchanged |
| `resolveReasoningOutputMode` | ✅ Unchanged |
| `wrapStreamFn` | ✅ Unchanged |
| `matchesContextOverflowError` | ✅ Unchanged |
| `classifyFailoverReason` | ✅ Unchanged |

No new required fields were added to `ProviderPlugin`. All hooks are optional.

## 3. Image Generation (`api.registerImageGenerationProvider`)

```ts
import type { ImageGenerationProvider } from "openclaw/plugin-sdk/image-generation";
```

- `ImageGenerationProvider` type unchanged.
- Plugin implements `id`, `label`, `defaultModel`, `models`, `capabilities`, `isConfigured`, `generateImage`.
- All fields match the current type.

## 4. Web Search (`api.registerWebSearchProvider`)

```ts
import type { WebSearchProviderPlugin } from "openclaw/plugin-sdk/provider-web-search";
```

- `WebSearchProviderPlugin` type unchanged.
- `createWebSearchProviderContractFields` signature unchanged.
- All required fields (`id`, `label`, `hint`, `envVars`, `createTool`, credentials) present.

## 5. SDK Import Paths

All paths used by the plugin exist in the latest `openclaw` package exports:

| Import | Exists |
|---|---|
| `openclaw/plugin-sdk/plugin-entry` | ✅ |
| `openclaw/plugin-sdk/provider-http` | ✅ |
| `openclaw/plugin-sdk/provider-auth` | ✅ |
| `openclaw/plugin-sdk/provider-auth-runtime` | ✅ |
| `openclaw/plugin-sdk/provider-web-search` | ✅ |
| `openclaw/plugin-sdk/provider-web-search-contract` | ✅ |
| `openclaw/plugin-sdk/image-generation` | ✅ |

## 6. Runtime Helpers

| Helper | Module | Status |
|---|---|---|
| `resolveApiKeyForProvider` | `provider-auth-runtime` | ✅ Still exported |
| `isProviderApiKeyConfigured` | `provider-auth` | ✅ Still exported |
| `resolveProviderHttpRequestConfig` | `provider-http` | ✅ Still exported |
| `postJsonRequest` | `provider-http` | ✅ Still exported |
| `assertOkOrThrowHttpError` | `provider-http` | ✅ Still exported |
| `postTrustedWebToolsJson` | `provider-web-search` | ✅ Still exported |
| `readStringParam`, `readNumberParam`, `readStringArrayParam` | `provider-web-search` | ✅ Still exported |
| `resolveSearchCount`, `resolveSearchTimeoutSeconds` | `provider-web-search` | ✅ Still exported |
| `createWebSearchProviderContractFields` | `provider-web-search-contract` | ✅ Still exported |

## 7. Future-Proofing Notes

1. **`augmentModelCatalog`** — deprecation notice exists in the type. Migrate supplemental catalog rows to `api.registerModelCatalogProvider()` when convenient. The old hook continues to work.

2. **Deprecated hooks not used by the plugin** (no action needed):
   - `capabilities`, `suppressBuiltInModel`, `isBinaryThinking`, `supportsXHighThinking`, `resolveDefaultThinkingLevel`, `discovery`

3. **New hooks available but optional** (no action needed):
   - `normalizeModelId`, `contributeResolvedModelCompat`, `prepareExtraParams`, `extraParamsForTransport`, `createStreamFn`, `resolveTransportTurnState`, `resolveWebSocketSessionPolicy`, `prepareRuntimeAuth`, `resolveSystemPromptContribution`, `resolvePromptOverlay`, `resolveAuthProfileId`, `transformSystemPrompt`, `textTransforms`, `applyConfigDefaults`, `isModernModelRef`, `resolveThinkingProfile`, `formatApiKey`, `buildAuthDoctorHint`, `resolveSyntheticAuth`, `resolveExternalAuthProfiles`, `onModelSelected`

4. **`peerDependencies`** — `"openclaw": ">=2026.4.22"` is satisfied by `2026.5.26`. Consider bumping the dev dependency to match the latest version.
