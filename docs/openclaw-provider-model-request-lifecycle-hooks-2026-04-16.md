# OpenClaw provider/model request lifecycle hooks (source review)

**Date:** 2026-04-16  
**Reviewed source:** local `openclaw` checkout at `/Users/openclaw/Github/openclaw`  
**Question:** What provider/model request lifecycle hooks does OpenClaw expose, and how are they actually used in source?

**Short answer:** OpenClaw exposes a fairly rich `ProviderPlugin` hook surface, but the request lifecycle is not one flat list. In source, the hooks split into a few distinct phases:

1. provider registration and config/catalog policy
2. model resolution and normalization
3. prompt/replay/tool-schema shaping
4. runtime auth preparation
5. request/stream construction and transport metadata
6. failover/error classification
7. usage reporting
8. UI/model-selection adjuncts

The most important implementation detail is that hook dispatch is spread across three runtime helpers:

- `src/plugins/provider-runtime.ts` — the main provider hook dispatcher
- `src/plugins/provider-hook-runtime.ts` — lighter-weight dispatch for `prepareExtraParams` and `wrapStreamFn`
- `src/plugins/provider-thinking.ts` — lightweight thinking-policy lookups

---

## Context map

### Hook surface definitions

| File | Role |
| ------ | ------ |
| `src/plugins/types.ts` | Defines the full `ProviderPlugin` interface and the context/result types for provider hooks. |
| `src/plugin-sdk/plugin-entry.ts` | Re-exports provider hook types for plugin authors via the public SDK. |
| `src/plugin-sdk/provider-entry.ts` | Convenience helper for single-provider plugins using `registerProvider(...)`. |
| `src/plugin-sdk/provider-model-shared.ts` | Shared helpers for replay/model family behavior; not the hook registry itself, but closely related. |
| `src/plugin-sdk/provider-stream.ts` | Shared stream wrapper helpers and prebuilt hook families for plugin authors. |

### Runtime dispatch and lifecycle files

| File | Role |
| ------ | ------ |
| `src/plugins/provider-runtime.ts` | Main dispatcher for most provider hooks. |
| `src/plugins/provider-hook-runtime.ts` | Hook-plugin resolution cache plus `prepareExtraParams` and `wrapStreamFn`. |
| `src/plugins/provider-thinking.ts` | Fast-path provider thinking-policy resolution. |
| `src/agents/pi-embedded-runner/model.ts` | Main model resolution pipeline; dynamic model hooks and normalization live here. |
| `src/agents/pi-embedded-runner/extra-params.ts` | Prepares provider extra params and applies `wrapStreamFn`. |
| `src/agents/provider-stream.ts` | Chooses `createStreamFn` vs default transport-aware stream function. |
| `src/agents/pi-embedded-runner/run/auth-controller.ts` | Calls `prepareRuntimeAuth` for live inference and refresh paths. |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Applies prompt contribution and prompt transform hooks while building system prompt. |
| `src/agents/pi-embedded-runner/replay-history.ts` | Applies provider replay sanitization/validation hooks. |
| `src/agents/pi-embedded-runner/tool-schema-runtime.ts` | Applies tool-schema normalization/diagnostic hooks. |
| `src/agents/openai-transport-stream.ts` | Uses per-turn transport metadata hooks for HTTP streaming. |
| `src/agents/openai-ws-stream.ts` | Uses per-turn metadata and WebSocket session policy hooks. |
| `src/infra/provider-usage.auth.ts` | Uses `resolveUsageAuth`. |
| `src/infra/provider-usage.load.ts` | Uses `fetchUsageSnapshot`. |

---

## Where the hook surface is exposed

The public registration surface is still very simple: provider plugins call `registerProvider(...)` through the plugin API.

Representative source shape from `src/plugins/types.ts`:

```ts
export type OpenClawPluginApi = {
  registerProvider: (provider: ProviderPlugin) => void;
  // ...
};
```

And the hook surface itself lives on `ProviderPlugin`.

Representative shape:

```ts
export type ProviderPlugin = {
  id: string;
  auth: ProviderAuthMethod[];
  catalog?: ProviderPluginCatalog;
  resolveDynamicModel?: (...)
  prepareDynamicModel?: (...)
  normalizeResolvedModel?: (...)
  normalizeToolSchemas?: (...)
  prepareExtraParams?: (...)
  createStreamFn?: (...)
  wrapStreamFn?: (...)
  prepareRuntimeAuth?: (...)
  resolveUsageAuth?: (...)
  fetchUsageSnapshot?: (...)
  classifyFailoverReason?: (...)
  // ...many more
};
```

So the exposed surface is large, but in practice only some of those hooks sit on the hot path of a normal model request.

---

## Dispatch model: owner vs compat vs catalog hooks

One subtle but important design choice in the source is that not all hooks resolve the same way.

### Single-owner runtime hooks

Many hooks go through `resolveProviderRuntimePlugin(...)`, which means OpenClaw wants the **owning provider plugin** for that provider id.

Examples:

- `resolveDynamicModel`
- `prepareDynamicModel`
- `normalizeResolvedModel`
- `prepareRuntimeAuth`
- `resolveUsageAuth`
- `fetchUsageSnapshot`
- `resolveSystemPromptContribution`
- `transformSystemPrompt`

### Hook lookup with fallback alias matching

Some hooks go through `resolveProviderHookPlugin(...)`, which first prefers the owner plugin and then falls back to other matching hook providers/aliases.

Examples:

- `wrapStreamFn`
- `normalizeToolSchemas`
- `inspectToolSchemas`
- `resolveReasoningOutputMode`
- `resolveTransportTurnState`
- `resolveWebSocketSessionPolicy`

### Compositional compat hooks

One important hook is intentionally compositional:

```ts
for (const plugin of resolveProviderCompatHookPlugins(params)) {
  const patch = plugin.contributeResolvedModelCompat?.(...)
}
```

So `contributeResolvedModelCompat` is not single-owner only; OpenClaw can layer multiple compat contributions onto the resolved model.

### Catalog-only hook selection

Catalog-affecting hooks are filtered through `resolveProviderPluginsForCatalogHooks(...)`, which uses `resolveCatalogHookProviderPluginIds(...)`.

That affects at least:

- `suppressBuiltInModel`
- `augmentModelCatalog`

This matters because catalog mutation is treated more conservatively than transport-time request mutation.

---

## Lifecycle order from source

## 1. Registration and provider surface definition

The exposed provider hook contract is defined in `src/plugins/types.ts` and re-exported through `src/plugin-sdk/plugin-entry.ts`.

For plugin authors, the normal pattern is:

1. define a plugin entry
2. call `api.registerProvider(...)`
3. supply only the provider hooks you actually need

This report focuses on what happens **after** that registration.

---

## 2. Config and catalog policy before requests

These hooks are not per-request, but they shape what models/providers exist before request execution.

### `normalizeConfig`

Used from `src/agents/models-config.providers.policy.runtime.ts`.

```ts
normalizeProviderConfigWithPlugin({
  provider: runtimeProviderKey,
  context: { provider: providerKey, providerConfig: provider },
})
```

Purpose:

- normalize `models.providers.<id>` config
- keep provider-specific config cleanup out of core tables

### `applyNativeStreamingUsageCompat`

Also used in `src/agents/models-config.providers.policy.runtime.ts`.

Purpose:

- patch resolved provider config for native streaming usage support
- for example, opt a provider config into `supportsUsageInStreaming`

### `resolveConfigApiKey`

Also used in `src/agents/models-config.providers.policy.runtime.ts`.

Purpose:

- let a provider surface a config/env-derived auth marker or API key
- especially useful for nonstandard env-based auth

### `suppressBuiltInModel`

Used in `src/agents/model-suppression.ts`.

Purpose:

- hide stale upstream model rows
- optionally return a provider-specific direct-resolution error message

### `augmentModelCatalog`

Used in `src/agents/model-catalog.ts`.

```ts
const supplemental = await augmentModelCatalogWithProviderPlugins({
  context: { ...entries }
})
```

Purpose:

- add provider-owned supplemental catalog rows after registry loading
- useful for synthetic or forward-compat models

### `isModernModelRef`

Used in `src/agents/live-model-filter.ts`.

Purpose:

- influence live smoke/profile selection and preferred model filters

### `normalizeModelId`

This is request-adjacent rather than request-core in the current source pass. It is used through runtime normalization wrappers such as `src/agents/provider-model-normalization.runtime.ts` and consumers like `src/gateway/model-pricing-cache.ts`.

Purpose:

- canonicalize provider-owned preview/legacy ids
- keep that normalization in plugin code rather than core string tables

---

## 3. Model resolution and runtime model shaping

This is the first truly important request-path phase.

The main source file is `src/agents/pi-embedded-runner/model.ts`.

### `normalizeTransport`

Used early while resolving provider transport information.

Representative use:

```ts
const normalized = runtimeHooks.normalizeProviderTransportWithPlugin({
  provider,
  config: cfg,
  context: { provider, api, baseUrl },
})
```

Purpose:

- normalize `api` and `baseUrl`
- let plugin-owned transport families affect custom or inline providers

### `normalizeResolvedModel`

Used when OpenClaw has a concrete runtime model and wants a provider-owned final rewrite.

Representative use:

```ts
const pluginNormalized = runtimeHooks.normalizeProviderResolvedModelWithPlugin({
  context: { provider, modelId, model }
})
```

Purpose:

- final resolved-model rewrite
- patch name, compat, input, api, baseUrl, or provider-specific metadata

### `contributeResolvedModelCompat`

Applied compositionally in `applyProviderResolvedModelCompatWithPlugins(...)` and consumed from both `src/agents/pi-embedded-runner/model.ts` and `src/agents/pi-model-discovery.ts`.

Purpose:

- add compat flags without taking over model ownership
- good fit for transport-family patches

### `resolveDynamicModel`

Used from `src/agents/pi-embedded-runner/model.ts`.

Representative use:

```ts
const pluginDynamicModel = runtimeHooks.runProviderDynamicModel({
  context: { provider, modelId, modelRegistry, providerConfig }
})
```

Purpose:

- synchronous dynamic model resolution when the model is not in the local catalog

### `prepareDynamicModel`

Used by async model resolution in `resolveModelAsync(...)`.

Representative use:

```ts
await runtimeHooks.prepareProviderDynamicModel({
  context: { provider, modelId, modelRegistry, providerConfig }
})
```

Purpose:

- network/cache warm-up before retrying `resolveDynamicModel`

### `preferRuntimeResolvedModel`

Used in `src/agents/pi-embedded-runner/model.ts`.

Purpose:

- ask whether a plugin runtime-resolved model should be compared against an explicit/catalog model and possibly preferred

### `buildUnknownModelHint`

Used when model resolution fails.

Representative use:

```ts
const hint = runtimeHooks.buildProviderUnknownModelHintWithPlugin({
  context: { provider, modelId, ... }
})
```

Purpose:

- append provider-specific recovery guidance to the generic `Unknown model` error

### Request-path conclusion for this phase

By the time the embedded runner has a model object, OpenClaw may already have applied:

1. transport normalization
2. plugin-owned model rewrite
3. compat contributions from multiple plugins
4. transport normalization again as a fallback
5. async dynamic-model preparation/retry if needed

That is the first major hook seam future NanoGPT/OpenClaw work should keep in mind.

---

## 4. Replay, tool schema, reasoning mode, and prompt shaping

These hooks run after model resolution but before or during request assembly.

### `buildReplayPolicy`

This hook is used **directly** by `src/agents/transcript-policy.ts`.

Representative source behavior:

```ts
const buildReplayPolicy = runtimePlugin?.buildReplayPolicy;
if (buildReplayPolicy) {
  const pluginPolicy = buildReplayPolicy(context);
  return mergeTranscriptPolicy(pluginPolicy ?? undefined);
}
```

Purpose:

- provider-owned transcript replay policy
- compaction, turn validation, tool-call id treatment, reasoning block handling, etc.

**Important source note:** the helper `resolveProviderReplayPolicyWithPlugin(...)` exists in `src/plugins/provider-runtime.ts`, but the normal non-test source path seems to use `buildReplayPolicy` directly from `resolveTranscriptPolicy(...)` instead.

### `sanitizeReplayHistory`

Used in `src/agents/pi-embedded-runner/replay-history.ts`.

Purpose:

- provider-owned transcript sanitation after generic cleanup

### `validateReplayTurns`

Also used in `src/agents/pi-embedded-runner/replay-history.ts`.

Purpose:

- provider-owned final replay validation before falling back to generic Gemini/Anthropic validators

### `normalizeToolSchemas`

Used in `src/agents/pi-embedded-runner/tool-schema-runtime.ts`.

Purpose:

- rewrite tool schemas before registering them with the embedded runner
- useful for unsupported keywords or transport-specific schema profiles

### `inspectToolSchemas`

Also used in `tool-schema-runtime.ts`.

Purpose:

- emit diagnostics/warnings without requiring core to know provider-specific schema rules

### `resolveReasoningOutputMode`

Used in `src/utils/provider-utils.ts`.

Purpose:

- decide whether provider reasoning should be treated as `native` or `tagged`

### `resolveSystemPromptContribution`

Used in both:

- `src/agents/pi-embedded-runner/run/attempt.ts`
- `src/agents/pi-embedded-runner/compact.ts`

Purpose:

- append provider-owned prompt contribution while OpenClaw still owns overall prompt assembly

### `transformSystemPrompt`

Used immediately after the prompt is assembled.

Representative flow in `run/attempt.ts`:

1. build OpenClaw system prompt
2. call `resolveProviderSystemPromptContribution(...)`
3. build full prompt
4. call `transformProviderSystemPrompt(...)`

Purpose:

- provider-owned final compatibility rewrite of the full system prompt

### Request-shaping takeaway

If you want provider-specific request-shaping without replacing transport, this is where OpenClaw expects you to work:

- replay policy/sanitization
- tool schema cleanup
- reasoning output mode
- prompt contribution and transform

---

## 5. Runtime auth preparation and auth-related request entry points

### `buildMissingAuthMessage`

Used in `src/agents/model-auth.ts`.

Purpose:

- replace the generic missing-auth message after OpenClaw exhausts env/profile/config fallback

### `prepareRuntimeAuth`

This is one of the most important request-path hooks.

It is used in several places:

- `src/agents/pi-embedded-runner/run/auth-controller.ts`
- `src/agents/pi-embedded-runner/compact.ts`
- `src/agents/btw.ts`
- `src/plugins/runtime/runtime-model-auth.runtime.ts`

Representative source shape:

```ts
const preparedAuth = await prepareProviderRuntimeAuth({
  provider: runtimeModel.provider,
  context: {
    provider: runtimeModel.provider,
    modelId: params.getModelId(),
    model: runtimeModel,
    apiKey: apiKeyInfo.apiKey,
    authMode: apiKeyInfo.mode,
    profileId: apiKeyInfo.profileId,
  },
})
```

Purpose:

- exchange a source credential into a runtime credential
- optionally override base URL and request headers/metadata
- support refreshable runtime auth with expiry

### Important lifecycle observation

`prepareRuntimeAuth` is not just a one-time setup hook. In source it can run:

1. during initial auth setup for a run
2. during auth refresh scheduling
3. again on auth-error recovery
4. during compaction-related paths

So this hook should be written as a runtime credential exchange hook, not as a once-per-session initializer.

---

## 6. Stream creation, extra params, request wrappers, and per-turn transport metadata

This is the most direct request-execution phase.

### `createStreamFn`

Used from `src/agents/provider-stream.ts`.

Representative flow:

```ts
const streamFn =
  resolveProviderStreamFn({ ... }) ?? createTransportAwareStreamFnForModel(params.model)
```

Purpose:

- replace the normal generic transport path with a provider-owned `StreamFn`

This is the earliest heavy-weight request override.

### `prepareExtraParams`

Used in `src/agents/pi-embedded-runner/extra-params.ts`.

Purpose:

- normalize/merge provider-owned extra params before generic wrappers run
- good for transport defaults and provider-specific params aliases

### `wrapStreamFn`

Also used in `extra-params.ts`, after extra params are prepared.

Representative source shape:

```ts
const pluginWrappedStreamFn = providerRuntimeDeps.wrapProviderStreamFn({
  provider,
  context: {
    provider,
    modelId,
    extraParams: effectiveExtraParams,
    model,
    streamFn: providerStreamBase,
  },
})
```

Purpose:

- provider-owned wrapper around the chosen stream function
- request/body/header mutation without replacing transport entirely

### Ordering that matters

From source, the order is roughly:

1. choose/create base stream fn (`createStreamFn` or default transport)
2. prepare merged extra params (`prepareExtraParams`)
3. apply provider stream wrapper (`wrapStreamFn`)
4. apply OpenClaw generic pre/post wrappers around that result

That means `wrapStreamFn` is a very strong seam for provider-specific request mutation, but it is **later** than `createStreamFn` and **after** extra-param preparation.

### `resolveTransportTurnState`

Used in:

- `src/agents/openai-transport-stream.ts`
- `src/agents/openai-ws-stream.ts`

Purpose:

- attach provider-native per-turn headers/metadata
- carries turn id, attempt number, session id, transport family

### `resolveWebSocketSessionPolicy`

Used in `src/agents/openai-ws-stream.ts`.

Purpose:

- provide session-scoped WebSocket headers
- control WebSocket degrade cooldown timing

### `isCacheTtlEligible`

Used in `src/agents/pi-embedded-runner/cache-ttl.ts`.

Purpose:

- provider-owned prompt-cache TTL eligibility override

### Practical source takeaway

For work like NanoProxy-style request mutation, the most relevant existing hooks are:

- `createStreamFn`
- `prepareExtraParams`
- `wrapStreamFn`
- `resolveTransportTurnState`
- `resolveWebSocketSessionPolicy`

Those are the closest things OpenClaw exposes to a request/transport lifecycle seam today.

---

## 7. Failover and error classification

### `matchesContextOverflowError`

This hook is implemented by several provider extensions and is consumed through provider error-pattern logic.

Relevant runtime path:

- `src/plugins/provider-runtime.ts` iterates plugins and calls `plugin.matchesContextOverflowError?.(...)`
- `src/agents/pi-embedded-helpers/provider-error-patterns.ts` consumes `matchesProviderContextOverflowWithPlugin(...)`

Purpose:

- let providers classify context-window overflow shapes that generic heuristics would miss

### `classifyFailoverReason`

Used in `src/agents/pi-embedded-helpers/provider-error-patterns.ts`.

Purpose:

- provider-specific failover reason classification when generic string matching is insufficient

This matters because request retry/fallback policy often depends on getting the failover reason right.

---

## 8. Usage and billing hooks

### `resolveUsageAuth`

Used in `src/infra/provider-usage.auth.ts`.

Purpose:

- derive provider-specific auth for usage/quota APIs
- intentionally separate from live inference runtime auth

### `fetchUsageSnapshot`

Used in `src/infra/provider-usage.load.ts`.

Purpose:

- fetch and normalize provider-specific usage/quota data

This separation is important: OpenClaw treats usage auth as a different lifecycle from inference auth.

---

## 9. Thinking-policy and model-selection adjunct hooks

These are not request transport hooks, but they do affect the model request surface users see.

- `isBinaryThinking`
- `supportsXHighThinking`
- `resolveDefaultThinkingLevel`

Used in `src/auto-reply/thinking.ts` via `src/plugins/provider-thinking.ts`.

Purpose:

- shape `/think` UI and reasoning defaults for a provider/model

### `onModelSelected`

Used in `src/plugins/provider-wizard.ts`.

Purpose:

- provider-owned callback when a model is selected in onboarding/configure flows

This is not part of the live request execution path, but it is part of the larger provider/model lifecycle around request configuration.

---

## Hook inventory by lifecycle phase

## Model and catalog phase

| Hook | Primary runtime dispatch | Main consumer(s) | What it does |
| ------ | ------ | ------ | ------ |
| `normalizeConfig` | `src/plugins/provider-runtime.ts` | `src/agents/models-config.providers.policy.runtime.ts` | Normalize `models.providers.<id>` config. |
| `applyNativeStreamingUsageCompat` | `src/plugins/provider-runtime.ts` | `src/agents/models-config.providers.policy.runtime.ts` | Patch provider config for native streaming usage compat. |
| `resolveConfigApiKey` | `src/plugins/provider-runtime.ts` | `src/agents/models-config.providers.policy.runtime.ts` | Resolve config/env-backed auth markers or keys. |
| `suppressBuiltInModel` | `src/plugins/provider-runtime.ts` | `src/agents/model-suppression.ts` | Hide stale built-in models and optionally return a custom error. |
| `augmentModelCatalog` | `src/plugins/provider-runtime.runtime.ts` -> `provider-runtime.ts` | `src/agents/model-catalog.ts` | Add plugin-owned model catalog rows. |
| `isModernModelRef` | `src/plugins/provider-runtime.ts` | `src/agents/live-model-filter.ts` | Mark models as preferred/modern for live filters. |
| `normalizeModelId` | `src/plugins/provider-runtime.ts` | `src/gateway/model-pricing-cache.ts` and runtime normalization wrappers | Canonicalize provider-owned model ids. |

## Model resolution phase

| Hook | Primary runtime dispatch | Main consumer(s) | What it does |
| ------ | ------ | ------ | ------ |
| `normalizeTransport` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/model.ts`, `src/agents/tools/pdf-native-providers.ts` | Normalize `api` / `baseUrl`. |
| `normalizeResolvedModel` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/model.ts`, `src/agents/pi-model-discovery.ts` | Final provider-owned resolved-model rewrite. |
| `contributeResolvedModelCompat` | compositional in `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/model.ts`, `src/agents/pi-model-discovery.ts` | Layer compat flags from one or more plugins. |
| `resolveDynamicModel` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/model.ts` | Synchronous dynamic model resolution. |
| `prepareDynamicModel` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/model.ts` | Async warm-up before retrying dynamic resolution. |
| `preferRuntimeResolvedModel` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/model.ts` | Allow runtime model to beat explicit/catalog model. |
| `buildUnknownModelHint` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/model.ts` | Append provider-specific unknown-model help. |

## Prompt, replay, and tool schema phase

| Hook | Primary runtime dispatch | Main consumer(s) | What it does |
| ------ | ------ | ------ | ------ |
| `buildReplayPolicy` | direct in `src/agents/transcript-policy.ts` | transcript policy resolution | Provider-owned replay/compaction rules. |
| `sanitizeReplayHistory` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/replay-history.ts` | Provider-specific replay sanitation. |
| `validateReplayTurns` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/replay-history.ts` | Provider-specific replay validation. |
| `normalizeToolSchemas` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/tool-schema-runtime.ts` | Rewrite tool schemas for transport compatibility. |
| `inspectToolSchemas` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/tool-schema-runtime.ts` | Emit provider-specific tool schema diagnostics. |
| `resolveReasoningOutputMode` | `src/plugins/provider-runtime.ts` | `src/utils/provider-utils.ts` | Choose `native` vs `tagged` reasoning mode. |
| `resolveSystemPromptContribution` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/run/attempt.ts`, `compact.ts` | Add provider prompt contribution. |
| `transformSystemPrompt` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/run/attempt.ts`, `compact.ts` | Final provider-owned prompt rewrite. |

## Request/auth/transport phase

| Hook | Primary runtime dispatch | Main consumer(s) | What it does |
| ------ | ------ | ------ | ------ |
| `buildMissingAuthMessage` | `src/plugins/provider-runtime.runtime.ts` -> `provider-runtime.ts` | `src/agents/model-auth.ts` | Replace generic missing-auth message. |
| `prepareRuntimeAuth` | `src/plugins/provider-runtime.runtime.ts` -> `provider-runtime.ts` | `run/auth-controller.ts`, `compact.ts`, `btw.ts`, `runtime-model-auth.runtime.ts` | Exchange source credential into runtime credential and optional request/baseUrl overrides. |
| `createStreamFn` | `src/plugins/provider-runtime.ts` | `src/agents/provider-stream.ts` | Provide a custom transport/stream implementation. |
| `prepareExtraParams` | `src/plugins/provider-hook-runtime.ts` | `src/agents/pi-embedded-runner/extra-params.ts` | Merge/normalize provider extra params before wrapper application. |
| `wrapStreamFn` | `src/plugins/provider-hook-runtime.ts` | `src/agents/pi-embedded-runner/extra-params.ts` | Wrap request stream function for provider-specific mutation. |
| `resolveTransportTurnState` | `src/plugins/provider-runtime.ts` | `src/agents/openai-transport-stream.ts`, `openai-ws-stream.ts` | Per-turn headers/metadata. |
| `resolveWebSocketSessionPolicy` | `src/plugins/provider-runtime.ts` | `src/agents/openai-ws-stream.ts` | WebSocket session headers and cooldown policy. |
| `isCacheTtlEligible` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-runner/cache-ttl.ts` | Prompt-cache TTL eligibility override. |

## Error and usage phase

| Hook | Primary runtime dispatch | Main consumer(s) | What it does |
| ------ | ------ | ------ | ------ |
| `matchesContextOverflowError` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-helpers/provider-error-patterns.ts` | Provider-specific context-overflow detection. |
| `classifyFailoverReason` | `src/plugins/provider-runtime.ts` | `src/agents/pi-embedded-helpers/provider-error-patterns.ts` | Provider-specific failover reason classification. |
| `resolveUsageAuth` | `src/plugins/provider-runtime.ts` | `src/infra/provider-usage.auth.ts` | Resolve auth for usage/quota APIs. |
| `fetchUsageSnapshot` | `src/plugins/provider-runtime.ts` | `src/infra/provider-usage.load.ts` | Fetch provider-specific usage/quota snapshot. |

## Thinking/UI adjunct phase

| Hook | Primary runtime dispatch | Main consumer(s) | What it does |
| ------ | ------ | ------ | ------ |
| `isBinaryThinking` | `src/plugins/provider-thinking.ts` | `src/auto-reply/thinking.ts` | Shape binary thinking UI. |
| `supportsXHighThinking` | `src/plugins/provider-thinking.ts` | `src/auto-reply/thinking.ts` | Expose `xhigh` thinking level. |
| `resolveDefaultThinkingLevel` | `src/plugins/provider-thinking.ts` | `src/auto-reply/thinking.ts` | Choose default thinking level for a model. |
| `onModelSelected` | direct provider lookup in `src/plugins/provider-wizard.ts` | onboarding/configure flows | Provider-owned post-selection callback. |

---

## Hooks that seem exposed but not clearly wired in normal non-test paths

### `applyConfigDefaults`

This hook is typed on `ProviderPlugin` and dispatched in `src/plugins/provider-runtime.ts`, but I did not find a clear non-test consumer in the normal source paths I reviewed.

### `resolveProviderReplayPolicyWithPlugin(...)`

This helper exists in `src/plugins/provider-runtime.ts`, but normal replay policy resolution appears to bypass it and call `runtimePlugin?.buildReplayPolicy` directly in `src/agents/transcript-policy.ts`.

That does **not** mean the `buildReplayPolicy` hook is unused. It means the helper wrapper is not the path currently used by mainline replay policy resolution.

---

## What this means for `nanogpt-provider-openclaw`

The current NanoGPT plugin already uses a meaningful subset of this surface in `index.ts`:

- `augmentModelCatalog`
- `normalizeResolvedModel`
- `normalizeToolSchemas`
- `resolveDynamicModel`
- `applyNativeStreamingUsageCompat`
- `resolveUsageAuth`
- `fetchUsageSnapshot`
- `wrapStreamFn`
- `classifyFailoverReason`

For future NanoGPT reliability work, especially anything NanoProxy-inspired, the most relevant OpenClaw hooks are probably:

1. `createStreamFn`
2. `prepareExtraParams`
3. `wrapStreamFn`
4. `resolveTransportTurnState`
5. `resolveWebSocketSessionPolicy`
6. `prepareRuntimeAuth`
7. `normalizeToolSchemas`
8. `sanitizeReplayHistory`
9. `validateReplayTurns`
10. `resolveSystemPromptContribution`
11. `transformSystemPrompt`
12. `resolveDynamicModel` / `prepareDynamicModel`

Those are the seams closest to an actual provider request lifecycle rather than setup/UI/catalog metadata.

---

## Bottom line

From source, OpenClaw's provider hook model is best understood as **layered** rather than monolithic.

- **Before request execution:** config, catalog, model suppression, dynamic model resolution
- **While preparing the run:** tool schemas, replay policy, reasoning mode, prompt contribution/transform
- **While building transport:** custom stream function, extra params, stream wrapper, transport turn metadata, runtime auth
- **After / around execution:** failover classification and usage reporting

For this repo specifically, the current `wrapStreamFn` integration is only one slice of the available lifecycle surface. If you want deeper request-level NanoGPT handling later, OpenClaw's source shows there are stronger seams available than just stream wrapping.

---

## Source files reviewed

### Hook definitions and SDK surface

- `openclaw/src/plugins/types.ts`
- `openclaw/src/plugin-sdk/plugin-entry.ts`
- `openclaw/src/plugin-sdk/provider-entry.ts`
- `openclaw/src/plugin-sdk/provider-model-shared.ts`
- `openclaw/src/plugin-sdk/provider-stream.ts`

### Runtime dispatch and main lifecycle consumers

- `openclaw/src/plugins/provider-runtime.ts`
- `openclaw/src/plugins/provider-hook-runtime.ts`
- `openclaw/src/plugins/provider-thinking.ts`
- `openclaw/src/plugins/provider-runtime.runtime.ts`
- `openclaw/src/agents/pi-embedded-runner/model.ts`
- `openclaw/src/agents/pi-model-discovery.ts`
- `openclaw/src/agents/pi-embedded-runner/extra-params.ts`
- `openclaw/src/agents/provider-stream.ts`
- `openclaw/src/agents/pi-embedded-runner/run/auth-controller.ts`
- `openclaw/src/agents/pi-embedded-runner/run/attempt.ts`
- `openclaw/src/agents/pi-embedded-runner/tool-schema-runtime.ts`
- `openclaw/src/agents/pi-embedded-runner/replay-history.ts`
- `openclaw/src/agents/transcript-policy.ts`
- `openclaw/src/agents/models-config.providers.policy.runtime.ts`
- `openclaw/src/agents/model-catalog.ts`
- `openclaw/src/agents/model-auth.ts`
- `openclaw/src/agents/model-suppression.ts`
- `openclaw/src/agents/live-model-filter.ts`
- `openclaw/src/agents/openai-transport-stream.ts`
- `openclaw/src/agents/openai-ws-stream.ts`
- `openclaw/src/infra/provider-usage.auth.ts`
- `openclaw/src/infra/provider-usage.load.ts`
- `openclaw/src/utils/provider-utils.ts`
- `openclaw/src/auto-reply/thinking.ts`
