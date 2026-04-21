# NanoGPT Module Refactor Implementation Checklist

> Status note: planning only. This checklist is intended to be filled out during implementation on the refactor branch.

> Goal: split the current NanoGPT plugin into smaller, more cohesive modules while preserving the public behavior, package entrypoints, and install surface.

## Objectives

- [ ] Reduce mixed responsibilities in `index.ts`, `runtime.ts`, and `provider-catalog.ts`.
- [ ] Extract duplicated parsing, guarding, and HTTP/auth helpers into shared modules.
- [ ] Keep existing public entrypoints stable unless there is a strong reason to change them.
- [ ] Preserve the published package surface and plugin manifest behavior.
- [ ] Keep tests aligned with the new module boundaries.

## Current Findings To Address

- [ ] `index.ts` currently combines auth wiring, provider registration, catalog augmentation, model normalization, tool-schema hooks, streaming-usage compat, and error-hook logging.
- [ ] `runtime.ts` currently combines config parsing, routing, dynamic-model logic, model discovery HTTP, provider-pricing caching, header construction, and usage parsing.
- [ ] `provider-catalog.ts` currently combines `models.json` snapshot parsing/caching with provider-config assembly.
- [ ] `provider-discovery.ts` and `index.ts` duplicate catalog-runner behavior.
- [ ] Shared helpers such as `isRecord`, number parsing, and sanitized auth header construction are duplicated or conceptually scattered.
- [ ] Repo docs still refer to `repair.ts` even though `wrapStreamFn` is currently a pass-through.

## Proposed Target Layout

- [ ] `shared/guards.ts`
- [ ] `shared/parse.ts`
- [ ] `shared/http.ts`
- [ ] `runtime/config.ts`
- [ ] `runtime/routing.ts`
- [ ] `runtime/dynamic-models.ts`
- [ ] `runtime/discovery.ts`
- [ ] `runtime/provider-pricing.ts`
- [ ] `runtime/usage.ts`
- [ ] `catalog/models-json-snapshot.ts`
- [ ] `catalog/build-provider.ts`
- [ ] `provider/auth.ts`
- [ ] `provider/catalog-hooks.ts`
- [ ] `provider/tool-schema-hooks.ts`
- [ ] `provider/error-hooks.ts`
- [ ] `provider/stream-hooks.ts`
- [ ] Optional later split: `web-search/credentials.ts`, `web-search/results.ts`
- [ ] Optional later split: `image/request.ts`, `image/response.ts`

## Phase 0: Guardrails And Cleanup

- [ ] Confirm the intended compatibility goal for this refactor: no user-visible behavior changes except structural cleanup.
- [ ] Decide whether `enableRepair` remains in `NanoGptPluginConfig` for backward compatibility or should be formally deprecated.
- [ ] Remove or update stale references to `repair.ts` in `AGENTS.md`.
- [ ] Review `README.md` for outdated repair-path language and either update it now or mark the exact sections for follow-up.
- [ ] Remove the unused `jsonrepair` dependency if the repair layer is truly gone, or explicitly keep it with a comment explaining why.
- [ ] Capture a pre-refactor verification baseline by running `npm test` and `npm run typecheck`.
- [ ] If packaging-affecting moves are expected, run `npm run build` once before structural edits so there is a known-good baseline.

## Phase 1: Extract Shared Helpers

- [ ] Create `shared/guards.ts` and move a single canonical `isRecord` helper there.
- [ ] Replace local `isRecord` implementations in `index.ts`, `runtime.ts`, `provider-catalog.ts`, and `onboard.ts`.
- [ ] Create `shared/parse.ts` for generic parsing helpers such as finite-number, positive-number, non-negative-number, and epoch-millis parsing.
- [ ] Move `parseFiniteNumber` and `parseEpochMillis` out of `runtime.ts`.
- [ ] Move `parseFinitePositiveNumber` out of `provider-catalog.ts` or normalize it onto the shared helpers.
- [ ] Keep NanoGPT-specific parsing logic separate from generic helpers if the semantics differ.
- [ ] Create `shared/http.ts` for `sanitizeHeaderValue`, `sanitizeApiKey`, and any reusable NanoGPT auth-header builder.
- [ ] Update `runtime.ts`, `web-search.ts`, and `image-generation-provider.ts` to use the shared HTTP helpers.
- [ ] Add or update unit tests for the extracted helpers if existing tests do not already cover them directly.

## Phase 2: Split Runtime Responsibilities

- [ ] Create `runtime/config.ts` for `getNanoGptConfig` and `resolveNanoGptRequestApi`.
- [ ] Create `runtime/dynamic-models.ts` for dynamic-model template lookup and `resolveNanoGptDynamicModel`.
- [ ] Create `runtime/routing.ts` for subscription probing, routing-mode resolution, catalog-source resolution, request base URL resolution, and provider override selection.
- [ ] Move the subscription cache and probe TTL constants into `runtime/routing.ts`.
- [ ] Create `runtime/discovery.ts` for `discoverNanoGptModels`.
- [ ] Create `runtime/provider-pricing.ts` for pricing fetch/cache/batching.
- [ ] Move provider-pricing cache state and in-flight dedupe logic out of `runtime.ts`.
- [ ] Create `runtime/usage.ts` for usage auth resolution, usage payload parsing, and usage snapshot formatting.
- [ ] Keep `runtime.ts` as a thin compatibility facade that re-exports the same public functions during the transition.
- [ ] Verify that `api.ts` still exports the intended runtime helpers from the facade.

## Phase 3: Split Catalog Responsibilities

- [ ] Create `catalog/models-json-snapshot.ts` for `readNanoGptModelsJsonSnapshot`, the snapshot cache, and related types.
- [ ] Move `NanoGptModelsJsonSnapshot` and snapshot-only parsing helpers out of `provider-catalog.ts`.
- [ ] Create `catalog/build-provider.ts` for `buildNanoGptProvider`.
- [ ] Keep `provider-catalog.ts` as a thin public wrapper or re-export layer if preserving import stability is important.
- [ ] Extract a shared helper for reading plugin config from a provider-catalog context so `index.ts` and `provider-discovery.ts` stop duplicating the same behavior.
- [ ] Consider extracting a `runNanoGptCatalog` helper so provider discovery and provider registration share one catalog-building path.
- [ ] Add or move tests so snapshot parsing and provider-building logic are tested independently.

## Phase 4: Split Provider Hook Responsibilities

- [ ] Create `provider/auth.ts` for NanoGPT API-key auth constants and `createNanoGptApiKeyAuthMethod`.
- [ ] Move NanoGPT auth CLI/env constant definitions out of `index.ts`.
- [ ] Create `provider/catalog-hooks.ts` for `readNanoGptAugmentedCatalogEntries`, `normalizeNanoGptResolvedModel`, and snapshot-backed dynamic-model fallback wiring.
- [ ] Create `provider/tool-schema-hooks.ts` for model-family detection plus GLM/Qwen schema normalization and diagnostics.
- [ ] Keep all tool-schema hint strings and family-specific heuristics together in one module.
- [ ] Create `provider/error-hooks.ts` for warn-once logic, error classification logging, `matchesContextOverflowError`, and `classifyFailoverReason`.
- [ ] Create `provider/stream-hooks.ts` for the current `wrapStreamFn` pass-through so a future repair layer has a dedicated home.
- [ ] Extract `applyNanoGptNativeStreamingUsageCompat` into either `provider/catalog-hooks.ts` or a dedicated compat module.
- [ ] Shrink `index.ts` down to plugin registration and composition of prebuilt hook helpers.

## Phase 5: Rationalize Surface-Specific Modules

- [ ] Review `web-search.ts` and decide whether it benefits from a light internal split into credentials/config vs result normalization.
- [ ] If split, create `web-search/credentials.ts` for config merging and API-key resolution.
- [ ] If split, create `web-search/results.ts` for response normalization and result validation.
- [ ] Review `image-generation-provider.ts` and decide whether request-body construction and response parsing should move to dedicated helpers.
- [ ] If split, create `image/request.ts` for model normalization, size validation, and image-data URL generation.
- [ ] If split, create `image/response.ts` for response parsing and unsupported-model error shaping.
- [ ] Review `onboard.ts` and decide whether credential normalization and config mutation should live in separate helper modules or remain together.
- [ ] Defer these splits if the earlier phases already deliver most of the maintainability gain.

## Phase 6: Update Tests To Match New Boundaries

- [ ] Split tests so extracted modules gain focused test files instead of growing `index.test.ts` and `runtime.test.ts`.
- [ ] Add a dedicated test file for shared helpers if extraction introduces new edge cases.
- [ ] Add a dedicated test file for routing/probe logic if it is separated from general runtime helpers.
- [ ] Add a dedicated test file for provider-pricing cache behavior if that logic moves to its own module.
- [ ] Add a dedicated test file for usage parsing if that logic moves to `runtime/usage.ts`.
- [ ] Add a dedicated test file for catalog snapshot parsing if that logic moves to `catalog/models-json-snapshot.ts`.
- [ ] Add a dedicated test file for provider hook modules if `index.test.ts` becomes mostly registration coverage.
- [ ] Update any imports in tests to keep using `.js` specifiers after file moves.

## Phase 7: Packaging And Public Surface Review

- [ ] Decide which new internal files must be shipped vs which can stay behind existing top-level facades.
- [ ] Update `package.json` `files` if newly referenced runtime modules must ship directly.
- [ ] Verify that `openclaw.plugin.json` still points at the correct entry files after refactor.
- [ ] Verify that `api.ts` still exports the intended curated surface and does not accidentally expose unstable internals.
- [ ] Check that the refactor does not break local-install assumptions described in `README.md`.
- [ ] If package surface changes, run and review the packaging-related tests:
- [ ] `stage-package-dir.test.ts`
- [ ] `package-files.test.ts`
- [ ] `install-preflight.test.ts`

## Phase 8: Documentation Follow-Through

- [ ] Update `AGENTS.md` file-ownership notes to reflect the new module layout.
- [ ] Update `AGENTS.md` workflow notes so they no longer direct contributors to nonexistent repair files.
- [ ] Update `README.md` only where behavior, package structure, or config expectations materially changed.
- [ ] If the final structure is meaningfully different, add a short architecture note summarizing where auth, runtime, catalog, and provider hooks now live.
- [ ] Link this checklist from any follow-up design or implementation notes if it becomes the main execution tracker.

## Verification Checklist

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run build` if package surface, shipped files, or install flow changed
- [ ] Manual spot-check of `index.ts` size and readability after the split
- [ ] Manual spot-check that `runtime.ts` and `provider-catalog.ts` are now facades or narrowly scoped modules rather than grab-bags
- [ ] Manual review that import paths remain ESM-correct with `.js` specifiers

## Done Criteria

- [ ] `index.ts` is primarily a composition/registration file.
- [ ] `runtime.ts` no longer owns unrelated responsibilities in one file.
- [ ] `provider-catalog.ts` no longer mixes snapshot parsing with provider assembly unless intentionally kept as a thin facade.
- [ ] Shared helpers are centralized instead of copy-pasted.
- [ ] Tests are reorganized to follow the new module boundaries.
- [ ] Stale repair references are resolved or intentionally documented.
- [ ] The repo passes the required validation commands for the scope of changes.
