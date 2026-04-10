# NanoGPT Provider-Selection Pricing Alignment

## Summary

The NanoGPT plugin already maps default model pricing from
`GET /api/v1/models?detailed=true` into OpenClaw's supported
`ModelDefinitionConfig.cost` surface. That is correct for default NanoGPT
routing, but it becomes inaccurate when the plugin is configured with a fixed
upstream provider override via `X-Provider`.

NanoGPT documents a second pricing surface for provider-selectable models:

- `GET /api/models/:canonicalId/providers`

That endpoint returns the default price plus provider-specific prices, including
the markup that applies when a provider is explicitly selected.

This spec aligns the plugin's exposed model pricing with the actual billing mode
used by the plugin when `plugins.entries.nanogpt.config.provider` is set.

## Current State

- `runtime.ts` discovers text models from NanoGPT model list endpoints with
  `?detailed=true`.
- `models.ts` maps `pricing.prompt` and `pricing.completion` into
  `ModelDefinitionConfig.cost.input` and `.output`.
- `provider-catalog.ts` returns those model definitions through OpenClaw's
  supported provider catalog surface.
- When `pluginConfig.provider` is set, the plugin sends `X-Provider` for text
  requests and sends `X-Billing-Mode: paygo` for subscription routing.

This means the plugin may expose one price in the model catalog while NanoGPT
bills a different provider-selected price at request time.

## Goal

When a NanoGPT upstream provider override is configured, update the catalog's
`models[].cost` values to match NanoGPT's documented provider-specific pricing
for the selected upstream provider whenever NanoGPT exposes that information.

## Non-Goals

- No OpenClaw core changes.
- No new pricing fields beyond the existing `cost` surface.
- No attempt to surface all provider options inside OpenClaw model pickers.
- No change to request routing behavior.

## Target Behavior

### Default routing

If no NanoGPT upstream provider override is configured:

- continue using `GET /models?detailed=true`
- continue exposing default NanoGPT pricing from the model list payload

### Provider-selected routing

If `pluginConfig.provider` is configured:

1. Discover the normal model catalog from NanoGPT as today.
2. For each discovered model, query NanoGPT's provider-selection endpoint:
   - `GET /api/models/:canonicalId/providers`
3. If NanoGPT reports pricing for the configured provider and the provider is
   available for that model, replace the model's exposed `cost.input` and
   `cost.output` with the provider-specific pricing.
4. If the endpoint fails, the model does not support provider selection, or the
   configured provider is not present for that model, keep the default model
   price from `/models?detailed=true`.

## API Contracts

### Existing catalog source

`GET /api/v1/models?detailed=true`

Relevant fields already consumed:

- `id`
- `canonicalId` when present
- `name` / `displayName`
- `context_length`
- `max_output_tokens`
- `capabilities`
- `pricing.prompt`
- `pricing.completion`
- `pricing.unit`

### New provider-pricing source

`GET /api/models/:canonicalId/providers`

Expected relevant fields based on NanoGPT docs:

- `supportsProviderSelection`
- `defaultPrice`
- `providers[].provider`
- `providers[].available`
- `providers[].pricing.inputPer1kTokens`
- `providers[].pricing.outputPer1kTokens`

The docs describe provider-selection pricing in per-1k-token units, so the
plugin must convert those values to OpenClaw's existing per-million-token
`cost` contract.

## Implementation Plan

### Types

Add provider-selection payload types next to the existing model/pricing types.

### Runtime

Add a provider-pricing enrichment pass in `runtime.ts` that:

- runs only when `config.provider` is set
- fetches NanoGPT provider pricing for each discovered model id
- applies provider-specific pricing only when NanoGPT returns a usable match
- falls back cleanly to the default catalog price on any error or unsupported
  model

To avoid a slow catalog build from purely serial fetches, apply the enrichment
in bounded concurrent batches.

### Model mapping

Add a helper in `models.ts` that merges provider-specific pricing into an
existing `ModelDefinitionConfig` without changing unrelated metadata.

### Provider catalog

Pass the configured provider id from `provider-catalog.ts` into model discovery
so the runtime can enrich pricing before returning the model list.

### Tests

Add coverage for:

- merging provider pricing into an existing model definition
- converting provider-pricing per-1k values into per-million `cost`
- keeping default prices when provider selection is unsupported or unavailable
- propagating provider-specific prices through `buildNanoGptProvider(...)`

## Failure Handling

If the provider-pricing endpoint fails for one or more models:

- do not fail the whole provider catalog build
- keep the default model prices from `/models?detailed=true`

This preserves current plugin behavior and avoids turning a pricing-enrichment
feature into a catalog-availability regression.

## Risks

- NanoGPT's provider-pricing endpoint is a second network fan-out and may add
  latency when a provider override is configured.
- Some models may omit provider-selection data or use evolving field shapes.
- A configured provider can be valid globally but unavailable for a specific
  model.

## Mitigations

- only enable the enrichment path when `pluginConfig.provider` is present
- keep conservative fallbacks to the existing default model pricing
- batch requests with bounded concurrency instead of unbounded parallel fan-out
- match provider ids case-insensitively

## Verification

### Automated

- targeted Vitest coverage for model pricing enrichment and provider catalog
  construction
- full `npm test`
- `npm run typecheck`

### Live

With a valid NanoGPT API key:

1. fetch one detailed models payload
2. fetch one provider-pricing payload for a provider-selectable model
3. confirm the plugin's mapped `cost` reflects provider pricing when
   `pluginConfig.provider` matches the returned provider id

## Expected Outcome

After this change, the plugin will continue to expose pricing to OpenClaw
through the existing supported `models[].cost` surface, but those values will
more accurately reflect actual NanoGPT billing whenever the plugin forces a
specific upstream provider.
