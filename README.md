# NanoGPT Provider for OpenClaw

Unofficial NanoGPT provider plugin for OpenClaw with API-key auth, dynamic model
discovery, automatic subscription or pay-as-you-go routing, opt-in Responses API
support, NanoGPT-backed web search, and native image generation.

## Current Surface

Implemented today:

- Text model catalog + inference transport via NanoGPT
- Automatic subscription vs pay-as-you-go request routing for text models
- Opt-in OpenAI Responses transport for text models
- NanoGPT-backed `web_search`
- NanoGPT-backed image generation and image editing

Not implemented today:

- Subscription quota tracking inside the plugin
- Exhaustive NanoGPT image-model discovery from an official image-model catalog
- Full NanoGPT usage accounting for the included daily and weekly limits

## Screenshot

![image](image.png)


## Install from npm (not implemented yet, see "Future improvements" below)

```bash
openclaw plugins install @deadronos/nanogpt-provider-openclaw
```

## Install locally without publishing (preferred for now)

Install directly from the repo checkout:

```bash
cd ~/Github
git clone @deadronos/nanogpt-provider-openclaw


openclaw plugins install ~/Github/nanogpt-provider-openclaw
```

Or build a tarball and install that exact package artifact:

```bash
npm pack
openclaw plugins install ./deadronos-openclaw-nanogpt-provider-0.1.0.tgz
```

Restart the gateway after install:

```bash
openclaw gateway restart
```

## Auth

Set:

```bash
export NANOGPT_API_KEY=your_key_here
```

Or onboard with:

```bash
openclaw onboard --nanogpt-api-key your_key_here
```

This one key is used for:

- text model access
- NanoGPT web search
- NanoGPT image generation

The plugin reads `NANOGPT_API_KEY` by default. Web search can also store its
credential in a dedicated config path described below.

## Provider Config

The provider plugin config controls NanoGPT text-model discovery and transport:

```json5
{
  plugins: {
    entries: {
      nanogpt: {
        enabled: true,
        config: {
          routingMode: "auto",
          catalogSource: "auto",
          requestApi: "completions",
          provider: "openrouter"
        }
      }
    }
  }
}
```

## Provider Options

- `routingMode`: `auto`, `subscription`, `paygo`
- `catalogSource`: `auto`, `canonical`, `subscription`, `paid`, `personalized`
- `requestApi`: `auto`, `completions`, `responses`
- `provider`: optional NanoGPT upstream provider id

Behavior notes:

- `routingMode: "auto"` probes NanoGPT subscription status and falls back to
  `paygo` if the probe fails.
- `catalogSource: "auto"` resolves to `subscription` when text requests are
  routed through subscription mode, otherwise `canonical`.
- `requestApi: "responses"` switches text inference to OpenAI Responses
  transport. `auto` currently behaves the same as `completions`.
- `provider` adds NanoGPT's `X-Provider` override header for text requests. If
  you force an upstream provider while text routing is in subscription mode, the
  plugin also sets `X-Billing-Mode: paygo`.

## Web Search

The plugin now also registers a NanoGPT-backed `web_search` provider using
NanoGPT's direct `POST /api/web` endpoint.

Web search details:

- endpoint: `POST https://nano-gpt.com/api/web`
- fixed upstream settings: `provider: "linkup"`, `depth: "standard"`,
  `outputType: "searchResults"`
- supported tool parameters:
  - `query` required
  - `count` optional, clamped to `1-10`
  - `includeDomains` optional
  - `excludeDomains` optional

Credential sources, in resolution order:

- `plugins.entries.nanogpt.config.webSearch.apiKey`
- `NANOGPT_API_KEY`

Note:

- `plugins.entries.nanogpt.config.webSearch.apiKey` is the web-search provider's
  credential storage path, not part of the top-level NanoGPT text-provider
  config schema shown above.

## Image Generation

The plugin now also registers a NanoGPT image generation provider backed by:

- `POST https://nano-gpt.com/v1/images/generations`

Current curated image model list:

- `hidream`
- `chroma`
- `z-image-turbo`
- `qwen-image-2512`

The default image model is `hidream`.

Current image capabilities:

- generation and edit flows are both enabled
- `count` up to `4`
- up to `4` input images for edit flows
- supported sizes: `256x256`, `512x512`, `1024x1024`
- response handling expects `b64_json`

The provider also normalizes friendly subscription labels to the curated NanoGPT
ids above. For example:

- `HIDREAM` -> `hidream`
- `CHROMA` -> `chroma`
- `Z IMAGE TURBO` -> `z-image-turbo`
- `QWEN IMAGE` -> `qwen-image-2512`

If NanoGPT rejects an image model id, the provider now returns an error that
points back to the curated model list and these accepted aliases.

Model-id note:

- `hidream` and `chroma` are straightforward mappings.
- `z-image-turbo` and `qwen-image-2512` are the best current API-id mappings for
  the subscription-included labels "Z IMAGE TURBO" and "QWEN IMAGE" based on
  NanoGPT's public surfaces.

## Limitations

The plugin currently does not maintain a local, authoritative counter for:

- weekly subscription text-token allowances
- daily included image generations

For text routing, the plugin only probes whether subscription mode appears
active. It does not currently reconcile or enforce NanoGPT usage quotas.


## Future improvements in this area could include:

## Publish to npm

```bash
npm test
npm run typecheck
npm pack --dry-run
npm publish --access public
```
