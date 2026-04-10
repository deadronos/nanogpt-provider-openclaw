# NanoGPT Surface Expansion Research

> Status note: this research document described the pre-implementation target
> surface. The plugin now implements the Responses transport, NanoGPT-backed
> web search, NanoGPT image generation, and curated image-model aliases. The
> quota-tracking gap called out below still applies.

## Summary

This document maps the exposed NanoGPT API surfaces to the current OpenClaw
plugin/runtime surfaces and captures what we can implement entirely inside the
`nanogpt-provider-openclaw` plugin versus what would require upstream OpenClaw
core changes.

The current plugin only registers a text model provider and always routes it
through OpenClaw's `openai-completions` transport. OpenClaw already has plugin
surfaces for:

- model providers
- image generation providers
- web search providers
- provider-owned usage snapshot hooks

That means we can extend the plugin substantially without touching OpenClaw for
the first wave. The main caveat is quota reporting: NanoGPT's subscription usage
endpoint exposes generic usage units, not model-specific token counters, so we
cannot accurately derive the user-facing "60M input tokens weekly" cap from the
documented API alone.

## Current State

### Current NanoGPT plugin

The plugin currently does the following:

- registers provider `nanogpt`
- supports API-key auth via `NANOGPT_API_KEY`
- probes subscription status via `GET /api/subscription/v1/usage`
- discovers text models from NanoGPT model-list endpoints
- routes requests to NanoGPT with `api: "openai-completions"`
- injects `X-Provider` and `X-Billing-Mode` headers when configured

The plugin currently does not:

- register image generation providers
- register web search providers
- expose `api: "openai-responses"`
- implement provider-owned usage snapshots
- maintain distinct catalogs for image models or search providers

### Relevant OpenClaw surfaces

OpenClaw already supports the surfaces we would need for most of this work:

- model providers can declare `api: "openai-responses"` or
  `api: "openai-completions"`
- plugins can register image generation providers with
  `api.registerImageGenerationProvider(...)`
- plugins can register web search providers with
  `api.registerWebSearchProvider(...)`
- provider plugins can implement `resolveUsageAuth` and `fetchUsageSnapshot`

Useful references in the target OpenClaw repo:

- `src/plugins/types.ts`
- `src/plugin-sdk/provider-web-search.ts`
- `src/plugin-sdk/image-generation.ts`
- `extensions/openai/image-generation-provider.ts`
- `extensions/minimax/image-generation-provider.ts`
- `extensions/minimax/src/minimax-web-search-provider.ts`
- `extensions/minimax/index.ts`

## NanoGPT API Surfaces

### 1. Text generation

NanoGPT exposes:

- `POST /api/v1/chat/completions`
- `POST /api/v1/responses`
- `GET /api/v1/models`
- `GET /api/subscription/v1/models`
- `GET /api/paid/v1/models`
- `GET /api/personalized/v1/models`

Important documented behavior:

- `GET /api/v1/models` is text-only.
- `GET /api/subscription/v1/models` always returns only subscription-included
  text models.
- `POST /api/v1/responses` is OpenAI Responses-compatible and supports
  stateful threading, tool calling, streaming, and multimodal inputs.
- NanoGPT supports provider selection through `X-Provider`.
- NanoGPT supports paygo override through `billing_mode: "paygo"` or
  `X-Billing-Mode: paygo`.

### 2. Image generation

NanoGPT exposes an OpenAI-compatible image endpoint:

- `POST https://nano-gpt.com/v1/images/generations`

Documented request/response details:

- default model is `hidream`
- accepts `prompt`, `model`, `n`, `size`, `response_format`
- supports img2img/inpainting through `imageDataUrl`, `imageDataUrls`,
  `maskDataUrl`
- returns `b64_json` by default, or signed URLs if `response_format: "url"`
- supports multiple image inputs for some models

The docs do not currently expose a documented image-model listing endpoint.
That means the plugin will likely need:

- a curated set of supported image models, or
- plugin config for explicit image models, or
- optional live discovery from an undocumented endpoint if we later confirm one

### 3. Web search

NanoGPT exposes two separate search-related surfaces:

- direct search endpoint: `POST /api/web`
- chat/responses-integrated web search via text-generation requests

The direct search API supports:

- explicit `query`
- `provider`
- `depth`
- `outputType`
- structured schema output
- domain filters
- date filters
- image inclusion

The docs explicitly say:

- use `POST /api/web` for direct control over search requests
- use chat completions for "model answers with web context in one call"
- `openai-native` is not allowed on `/api/web`

### 4. Subscription usage

NanoGPT exposes:

- `GET /api/subscription/v1/usage`

Documented payload:

- `active`
- `limits.daily`
- `limits.monthly`
- `daily.used`, `daily.remaining`, `daily.percentUsed`, `daily.resetAt`
- `monthly.used`, `monthly.remaining`, `monthly.percentUsed`, `monthly.resetAt`
- `state`
- `graceUntil`

The critical documented constraint is:

- usage units represent successful subscription-covered operations
- usage units are not tokens or dollar cost

This is the biggest blocker for "accurate" subscription-cap reporting.

## Feasibility Matrix

### A. Better text-model coverage

Status: feasible in-plugin

What we can do:

- keep the existing `openai-completions` path for broad compatibility
- add config to choose `requestApi: "chat-completions" | "responses" | "auto"`
- build provider catalogs that return `api: "openai-responses"` when requested
- preserve existing routing controls:
  - `routingMode`
  - `catalogSource`
  - `provider`

Recommended default:

- stay on `openai-completions` initially for maximum compatibility
- add an opt-in `requestApi: "responses"` mode

Reason:

- the current plugin is already working against completions
- NanoGPT documents a strong Responses surface
- OpenClaw supports `openai-responses`
- moving everyone at once would increase compatibility risk without clear user
  benefit

### B. Responses API support

Status: feasible in-plugin

What is needed:

- extend plugin config to optionally return `api: "openai-responses"`
- ensure request base URL still points at NanoGPT's `/api/v1`
- keep request headers and routing logic compatible with NanoGPT's headers
- verify streaming semantics against OpenClaw's Responses transport

Likely implementation shape:

- add `requestApi?: "completions" | "responses" | "auto"` to plugin config
- when `responses`, return:
  - `api: "openai-responses"`
  - same `baseUrl`
  - same `apiKey`
  - same NanoGPT routing headers

Potential nuance:

- some legacy NanoGPT integrations still point people at `/api/v1` for
  completions, and some third-party tools use alternate NanoGPT compatibility
  paths like `v1legacy` or `v1thinking`
- for OpenClaw specifically, the standard `/api/v1/responses` path appears to be
  the right target

### C. Image generation support

Status: feasible in-plugin

This is the cleanest major expansion after text.

Why it fits well:

- OpenClaw already has a first-class image generation provider interface
- NanoGPT exposes an OpenAI-compatible images endpoint
- the request shape is close to OpenClaw's existing OpenAI image provider

What we would build:

- one or more `ImageGenerationProvider`s registered from this plugin
- provider id likely `nanogpt`
- optional second provider id only if we decide subscription-only and paygo-only
  image surfaces should appear separately

Likely config additions:

- `image.enabled?: boolean`
- `image.defaultModel?: string`
- `image.models?: string[]`
- `image.routingMode?: "auto" | "subscription" | "paygo"`
- `image.provider?: string`

Practical implementation notes:

- NanoGPT image endpoint lives at `https://nano-gpt.com/v1/images/generations`,
  not under `/api/v1`
- requests may need to use `response_format: "b64_json"` so OpenClaw receives
  image bytes directly
- image edits can be mapped from OpenClaw input images to `imageDataUrl` or
  `imageDataUrls`
- mask support can map to `maskDataUrl`

Known unknown:

- there is no documented image-model listing endpoint, so dynamic discovery for
  image models is currently not proven

Recommendation:

- ship a curated image-model list first
- optionally make the list user-configurable
- later add discovery if NanoGPT documents a stable endpoint

### D. "4 subscription included image models"

Status: probably feasible, but needs one of two strategies

If the goal is to expose the subscription-included image models specifically, we
have two implementation options:

1. Curated list in the plugin
2. Live discovery from a NanoGPT endpoint if we confirm one exists and is stable

Right now the documentation supports the endpoint itself, but not a stable image
catalog API. Because of that, a curated list is the lowest-risk option.

What we can safely say today:

- NanoGPT publicly documents a free daily image cap in the subscription
- the docs publicly document the image-generation endpoint
- we do not yet have a documented source of truth for the exact included image
  model list via API

Recommendation:

- start with a curated allowlist for the four included models
- make it easy to override in plugin config
- label the curated list as subscription defaults, not as authoritative dynamic
  discovery

### E. Direct web search API support

Status: feasible in-plugin

This maps well to OpenClaw's `WebSearchProviderPlugin` surface.

What we can support:

- OpenClaw `web_search` tool backed by NanoGPT `POST /api/web`
- query
- count/result truncation at the OpenClaw tool layer
- include/exclude domains
- date filters
- optional image inclusion

What needs design choice:

- provider id: likely `nanogpt`
- whether to surface only normalized search results or also NanoGPT's structured
  modes (`sourcedAnswer`, `structured`)

Recommended first pass:

- implement OpenClaw `web_search` against `outputType: "searchResults"`
- keep the provider conservative and return normalized result objects like the
  existing Brave/MiniMax providers

Possible later expansion:

- add plugin config for `outputType`
- expose a NanoGPT-specific advanced web-search provider mode if we want
  `sourcedAnswer` or structured output

### F. Search through Responses/chat request bodies

Status: partially feasible in-plugin

NanoGPT supports integrated search inside text-generation requests, but that is
not the same thing as OpenClaw's standalone `web_search` provider surface.

We can likely support two separate search modes:

- standalone search tool via `POST /api/web`
- model-native search via NanoGPT chat/responses body fields

The second mode is useful, but it overlaps with OpenClaw's own web tools and is
more transport-specific.

Recommendation:

- implement standalone `web_search` provider first
- consider model-native search injection later as an advanced text-provider
  option, not as part of the first plugin expansion

### G. Accurate usage-limit tracking

Status: only partially feasible today

This splits into three separate questions.

#### 1. Can we report whether subscription usage is active?

Yes.

The plugin already probes `/api/subscription/v1/usage` and can keep doing that.

#### 2. Can we report daily/monthly subscription operation usage?

Yes.

The docs explicitly define:

- daily used / remaining / percent used / resetAt
- monthly used / remaining / percent used / resetAt

This can be mapped into OpenClaw `ProviderUsageSnapshot.windows`.

#### 3. Can we accurately report "60M weekly input tokens remaining"?

Not from the documented API alone.

Reasons:

- the documented usage endpoint exposes daily/monthly generic usage units
- the docs explicitly say those units are not tokens
- the public blog post describes a weekly 60M input-token cap, but that field
  does not appear in the documented usage endpoint

Conclusion:

- we cannot honestly claim exact tracking of the weekly token cap unless NanoGPT
  exposes an additional documented field or endpoint
- we can only report:
  - subscription active/inactive
  - daily and monthly subscription operation usage
  - maybe a best-effort local estimate of prompt input tokens from requests we
    send through OpenClaw, but that would be incomplete and not authoritative

## OpenClaw Core Gaps

### 1. Usage provider id typing

OpenClaw's `UsageProviderId` type is currently a closed union:

- `anthropic`
- `github-copilot`
- `google-gemini-cli`
- `minimax`
- `openai-codex`
- `xiaomi`
- `zai`

That means NanoGPT usage support likely requires one upstream change:

- add `"nanogpt"` to `UsageProviderId`

This does not look like a major architectural blocker, but it is upstream work.

### 2. If we want first-class weekly-token tracking

This is not an OpenClaw gap by itself. It is primarily a NanoGPT API visibility
gap.

OpenClaw can already show windows with percentages and reset timestamps. The
problem is that NanoGPT's documented endpoint does not expose the weekly token
budget directly.

## Proposed Implementation Phases

### Phase 1: Text-provider expansion

- add `requestApi` config
- support `openai-responses`
- keep existing completions mode
- preserve routing/provider-selection behavior

### Phase 2: Image generation

- register `nanogpt` image generation provider
- ship curated image model list
- support text-to-image and image-to-image
- use direct base64 response mode

### Phase 3: Web search provider

- register `nanogpt` web search provider
- back it with `POST /api/web`
- normalize `searchResults` output into OpenClaw's expected result shape

### Phase 4: Usage reporting

- implement `resolveUsageAuth`
- implement `fetchUsageSnapshot`
- surface daily/monthly subscription usage units
- do not label them as token usage

### Phase 5: Optional follow-ups

- investigate image-model discovery
- investigate model-native search injection for chat/responses calls
- investigate whether NanoGPT exposes weekly token-cap telemetry anywhere not
  currently documented

## Recommendation

The best path is:

1. extend the plugin to support both `openai-completions` and
   `openai-responses`
2. add image generation as a first-class provider
3. add a separate NanoGPT web search provider backed by `POST /api/web`
4. add subscription usage reporting, but only for the documented daily/monthly
   generic usage units

What we should not over-promise:

- exact weekly token-cap tracking
- fully dynamic image-model discovery
- authoritative identification of the four included image models via API, until
  NanoGPT documents a stable source of truth for that list

## Sources

NanoGPT documentation and public pages:

- https://docs.nano-gpt.com/api-reference/endpoint/responses
- https://docs.nano-gpt.com/api-reference/endpoint/models
- https://docs.nano-gpt.com/api-reference/endpoint/web-search
- https://docs.nano-gpt.com/api-reference/endpoint/image-generation-openai
- https://docs.nano-gpt.com/api-reference/endpoint/subscription-usage
- https://docs.nano-gpt.com/integrations/openclaw
- https://nano-gpt.com/blog/subscription-update-february-2026

OpenClaw local references:

- `/Users/openclaw/Github/openclaw/src/plugins/types.ts`
- `/Users/openclaw/Github/openclaw/src/plugin-sdk/provider-web-search.ts`
- `/Users/openclaw/Github/openclaw/src/plugin-sdk/provider-usage.ts`
- `/Users/openclaw/Github/openclaw/extensions/minimax/index.ts`
- `/Users/openclaw/Github/openclaw/extensions/minimax/src/minimax-web-search-provider.ts`
- `/Users/openclaw/Github/openclaw/extensions/openai/image-generation-provider.ts`
- `/Users/openclaw/Github/openclaw/extensions/minimax/image-generation-provider.ts`
