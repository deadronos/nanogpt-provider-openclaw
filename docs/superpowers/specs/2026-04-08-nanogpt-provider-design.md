# NanoGPT Provider Plugin Design

## Summary

Build an external native OpenClaw provider plugin that adds NanoGPT as a model
provider with API-key auth, dynamic model discovery, and routing that can use
subscription-backed or pay-as-you-go NanoGPT endpoints.

The plugin should feel like a first-class OpenClaw provider, following the
patterns used by existing providers such as OpenRouter, Together, Chutes, and
MiniMax.

## Goals

- Register a `nanogpt` model provider for OpenClaw.
- Support NanoGPT API-key authentication via `NANOGPT_API_KEY`.
- Use NanoGPT's OpenAI-compatible chat completions API.
- Discover models dynamically from NanoGPT endpoints.
- Support both subscription-backed routing and pay-as-you-go routing.
- Allow OpenClaw users to leave routing on smart `auto`.
- Support optional NanoGPT upstream provider selection for eligible paid models.
- Fail closed gracefully when discovery or subscription probing fails.

## Non-Goals

- No OAuth, browser login, or session auth in v1.
- No mutation of NanoGPT user preferences or account settings.
- No extra NanoGPT capabilities beyond text-model provider support in v1.
- No attempt to bundle this into the main OpenClaw repo in v1.

## User-Facing Configuration

The plugin will expose a compact config surface under
`plugins.entries.nanogpt.config`.

```json5
{
  plugins: {
    entries: {
      nanogpt: {
        enabled: true,
        config: {
          routingMode: "auto",
          catalogSource: "auto",
          provider: undefined,
        },
      },
    },
  },
}
```

### Config fields

- `routingMode`
  - `"auto"`: probe subscription status and route accordingly
  - `"subscription"`: always use subscription routing
  - `"paygo"`: always use pay-as-you-go routing
- `catalogSource`
  - `"auto"`: choose catalog endpoint from the resolved routing mode
  - `"canonical"`: use the canonical models endpoint
  - `"subscription"`: use the subscription models endpoint
  - `"paid"`: use the paid models endpoint
  - `"personalized"`: use the personalized models endpoint
- `provider`
  - Optional NanoGPT upstream provider id for per-request provider selection

## Provider Contract

- OpenClaw provider id: `nanogpt`
- OpenClaw plugin id: `nanogpt`
- Auth: API key only
- Env var: `NANOGPT_API_KEY`
- Transport API: `openai-completions`
- Default model ref: `nanogpt/gpt-5.4-mini`

The plugin will register one provider and use OpenClaw's provider auth helper
for standard API-key onboarding.

## NanoGPT Endpoint Strategy

### Request routing

- Pay-as-you-go requests use NanoGPT's standard OpenAI-compatible chat
  completions endpoint.
- Subscription requests use NanoGPT's subscription chat completions endpoint.
- `routingMode: "auto"` will probe NanoGPT subscription status once per short
  TTL window and route to the subscription endpoint when the account is
  subscribed. Otherwise it will route to the standard endpoint.

### Model discovery

- `catalogSource: "auto"`
  - If resolved routing is subscription, use the subscription models endpoint.
  - If resolved routing is paygo, use the canonical models endpoint.
  - If the subscription probe fails, fall back to canonical discovery.
- `catalogSource: "canonical"` uses the canonical models endpoint.
- `catalogSource: "subscription"` uses the subscription models endpoint.
- `catalogSource: "paid"` uses the paid models endpoint.
- `catalogSource: "personalized"` uses the personalized models endpoint.

### Subscription probing

- The plugin will probe NanoGPT's subscription usage endpoint when
  `routingMode: "auto"`.
- Probe results will be cached in-process for a short TTL so repeated catalog
  and runtime calls do not hammer the endpoint.
- Probe failures will not break provider loading. They degrade to paygo-style
  behavior.

## Provider Selection Behavior

If `config.provider` is set:

- The plugin injects NanoGPT's provider-selection header on requests.
- If the resolved routing mode is subscription, the plugin also forces paygo
  billing on that request because NanoGPT documents provider selection as a
  pay-as-you-go feature unless billing override is used.

If `config.provider` is unset:

- The plugin sends no provider-selection override.
- NanoGPT chooses the default routing/provider behavior for the chosen model.

## Failure Handling

- Missing API key: provider catalog resolves to `null` and OpenClaw behaves like
  any other unconfigured provider.
- Subscription probe failure: fall back to canonical/paygo behavior.
- Dynamic model discovery failure: fall back to a small static catalog.
- Malformed model entries: skip bad entries and continue loading valid models.

## Static Fallback Catalog

The plugin should ship a tiny fallback model catalog so the provider remains
usable even when NanoGPT discovery is unavailable.

Initial fallback set:

- `gpt-5.4-mini`
- `gpt-5.4`
- `claude-sonnet-4.6`

These should be treated as provisional defaults and can be refined during
implementation if NanoGPT's discovery payload gives enough metadata to avoid a
manual list in most cases.

## Package Layout

The external plugin package will use the standard OpenClaw native plugin shape.

```text
nanogpt-provider-openclaw/
  package.json
  tsconfig.json
  openclaw.plugin.json
  index.ts
  api.ts
  onboard.ts
  provider-catalog.ts
  models.ts
  runtime.ts
  index.test.ts
  provider-catalog.test.ts
  runtime.test.ts
  README.md
```

### File responsibilities

- `package.json`
  - Declares plugin metadata, package name, compatibility, and entrypoint
- `openclaw.plugin.json`
  - Declares plugin id, provider id, auth env vars, auth choices, and config
    schema
- `index.ts`
  - Registers the NanoGPT provider with OpenClaw
- `api.ts`
  - Curated local exports for tests or consumers
- `onboard.ts`
  - Default model aliasing and auth-apply helpers
- `provider-catalog.ts`
  - Builds NanoGPT provider config and resolves dynamic discovery
- `models.ts`
  - NanoGPT endpoint constants, fallback models, response parsing helpers
- `runtime.ts`
  - Subscription probe, TTL cache, request decoration helpers
- `*.test.ts`
  - Contract, discovery, routing, and fallback coverage
- `README.md`
  - Install and config instructions for OpenClaw users

## Testing Strategy

Tests should cover:

- Provider registration shape
- Manifest metadata and config schema
- API-key auth setup
- `routingMode` behavior for `auto`, `subscription`, and `paygo`
- `catalogSource` behavior for each supported mode
- Subscription probe success and failure paths
- Fallback to static catalog on network failure
- Provider-selection header injection
- Billing override injection when provider selection is used with subscription
- Parsing and normalization of NanoGPT model payloads

## Open Questions

- Exact fallback model list can be revised if NanoGPT's live model metadata makes
  a better minimal static set obvious.
- The provider-selection config stays plugin-global in v1. Per-model provider
  overrides can be added later if users need them.

## Implementation Recommendation

Proceed with an external native OpenClaw plugin using:

- `routingMode: "auto"` by default
- `catalogSource: "auto"` by default
- in-process subscription probe caching
- dynamic NanoGPT model discovery with static fallback
- per-request provider selection via NanoGPT headers

This gives subscription users a zero-config happy path while still supporting
pay-as-you-go and more advanced routing when needed.
