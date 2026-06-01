# OpenClaw Provider SDK Surface Audit — NanoGPT Provider

**Date:** 2026-06-01
**Plugin version:** `@deadronos/nanogpt-provider-openclaw@0.1.2`
**Audited against:** current source checkout at `~/Github/openclaw` (`openclaw@2026.5.31`)

## Verdict

The NanoGPT plugin still adheres to the current OpenClaw provider SDK well enough to remain operational, but it is no longer fully on the preferred provider-control-plane surfaces.

The main provider, web-search provider, and image-generation provider all still register through supported SDK entrypoints. The drift is concentrated in the text model catalog path: the plugin still relies on legacy-but-supported `catalog` and deprecated `augmentModelCatalog` hooks instead of fully migrating supplemental catalog ownership to `api.registerModelCatalogProvider(...)`.

## Summary

| Area | Status | Notes |
| --- | --- | --- |
| `definePluginEntry(...)` | Good | Current supported plugin entry surface |
| `api.registerProvider(...)` | Good | Hook set still matches current `ProviderPlugin` |
| Text provider `catalog` hook | Legacy | Still supported, but marked as legacy in current OpenClaw |
| `augmentModelCatalog` | Deprecated | Current source points plugins to `registerModelCatalogProvider(...)` |
| Discovery entry | Good | Uses `catalog`, not deprecated `discovery` |
| `api.registerWebSearchProvider(...)` | Good | Current supported surface |
| `api.registerImageGenerationProvider(...)` | Good | Current supported surface |
| SDK import paths in use | Good | All imported subpaths still exported by current OpenClaw |
| Declared compat floor | Stale | Package range is older than current head, though still compatible |

## Findings

### 1. Text catalog registration is still on the legacy provider surface

The plugin registers NanoGPT text inference through `api.registerProvider(...)` with a `catalog` hook:

- `index.ts` registers `catalog: nanoGptProviderCatalog`
- `provider-catalog.ts` implements the `run(ctx)` catalog loader

In current OpenClaw, `ProviderPlugin.catalog` is still supported for text runtime wiring, but the type now labels it as a legacy text-provider catalog hook and points new catalog/control-plane work toward `api.registerModelCatalogProvider(...)`.

**Assessment:** compatible, but no longer on the preferred SDK path.

## 2. Supplemental catalog rows still use a deprecated hook

The plugin also registers:

- `augmentModelCatalog: (...) => readNanoGptAugmentedCatalogEntries(...)`

Current OpenClaw marks `augmentModelCatalog` as deprecated and explicitly recommends `api.registerModelCatalogProvider(...)` for supplemental rows.

This is the clearest concrete SDK-surface drift in the plugin.

**Assessment:** still functional today, but the strongest near-term migration candidate.

## 3. Discovery entry is still aligned

The lightweight discovery module exports:

- `id`
- `label`
- `docsPath`
- `auth: []`
- `catalog: nanoGptProviderCatalog`

That means the plugin is already using the non-deprecated `catalog` shape in discovery, not the older `discovery` alias. Current OpenClaw warns when providers use `discovery` without `catalog`; this plugin does not do that.

**Assessment:** aligned with the current discovery expectation.

## 4. Runtime/provider hook coverage is still current

The main provider registration still lines up with current optional `ProviderPlugin` hooks, including:

- `normalizeResolvedModel`
- `normalizeToolSchemas`
- `inspectToolSchemas`
- `resolveDynamicModel`
- `applyNativeStreamingUsageCompat`
- `resolveUsageAuth`
- `fetchUsageSnapshot`
- `buildReplayPolicy`
- `sanitizeReplayHistory`
- `validateReplayTurns`
- `resolveReasoningOutputMode`
- `wrapStreamFn`
- `matchesContextOverflowError`
- `classifyFailoverReason`

I did not find any local diagnostics on the plugin files that use these surfaces.

**Assessment:** strong alignment on the runtime hook layer.

## 5. Web search and image generation surfaces remain current

The plugin’s extra capabilities still use the supported SDK seams:

- `api.registerWebSearchProvider(createNanoGptWebSearchProvider())`
- `api.registerImageGenerationProvider(buildNanoGptImageGenerationProvider())`

The plugin also still imports valid current SDK subpaths such as:

- `openclaw/plugin-sdk/plugin-entry`
- `openclaw/plugin-sdk/provider-auth`
- `openclaw/plugin-sdk/provider-auth-api-key`
- `openclaw/plugin-sdk/provider-auth-runtime`
- `openclaw/plugin-sdk/provider-catalog-shared`
- `openclaw/plugin-sdk/provider-http`
- `openclaw/plugin-sdk/provider-model-shared`
- `openclaw/plugin-sdk/provider-onboard`
- `openclaw/plugin-sdk/provider-usage`
- `openclaw/plugin-sdk/provider-web-search`
- `openclaw/plugin-sdk/provider-web-search-contract`
- `openclaw/plugin-sdk/image-generation`

I verified these subpaths are still exported by the current OpenClaw package surface.

**Assessment:** aligned.

## 6. Versioning and assurance lag behind current OpenClaw head

The package still declares:

- peer dependency: `openclaw >=2026.4.22`
- dev dependency: `openclaw 2026.4.23`

while the current local OpenClaw source checkout is `2026.5.31`.

That does not create an immediate incompatibility by itself, but it does mean the plugin is not explicitly pinned or continuously validated against the current SDK head.

**Assessment:** compatible, but the stated compatibility story is lagging behind the source actually being compared.

## Overall Assessment

If the question is whether the plugin still fits OpenClaw’s provider SDK surfaces, the answer is yes.

If the question is whether it is fully up to date with OpenClaw’s current preferred provider-control-plane design, the answer is no.

The plugin is in a good operational state, with the main outstanding drift limited to catalog migration:

1. `catalog` is still being used for text provider registration.
2. `augmentModelCatalog` is still being used for supplemental catalog rows.
3. `registerModelCatalogProvider(...)` exists in current OpenClaw and is the migration target for newer catalog ownership.

## Recommended Next Steps

1. Migrate supplemental NanoGPT catalog augmentation from `augmentModelCatalog` to `api.registerModelCatalogProvider(...)`.
2. Decide whether the main NanoGPT text catalog should remain on the legacy `catalog` runtime hook for now or also be moved toward the newer unified model catalog flow.
3. Bump local validation against a newer OpenClaw version or the local `~/Github/openclaw` checkout so the compatibility claim is tested against current source rather than only the older packaged dependency.

## Evidence Reviewed

Primary NanoGPT plugin surfaces reviewed:

- `index.ts`
- `provider-catalog.ts`
- `provider-discovery.ts`
- `web-search.ts`
- `image-generation-provider.ts`
- `package.json`

Primary current OpenClaw surfaces reviewed:

- `src/plugins/types.ts`
- `src/plugins/provider-validation.ts`
- `src/plugins/compat/registry.ts`
- `src/plugin-sdk/plugin-entry.ts`
- `package.json`
