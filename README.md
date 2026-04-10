# NanoGPT Provider for OpenClaw

Unofficial NanoGPT provider plugin for OpenClaw with API-key auth, dynamic model discovery, automatic subscription or pay-as-you-go routing, opt-in Responses API support, NanoGPT-backed web search, and native image generation.

NanoGPT provider plugin for OpenClaw with API-key auth, dynamic model discovery,
and automatic subscription or pay-as-you-go routing.

## Screenshot

![image](image.png)

## Install from npm

```bash
openclaw plugins install @deadronos/openclaw-nanogpt-provider
```

## Install locally without publishing

Install directly from the repo checkout:

```bash
openclaw plugins install /Users/openclaw/Github/nanogpt-provider-openclaw
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

## Config

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

## Options

- `routingMode`: `auto`, `subscription`, `paygo`
- `catalogSource`: `auto`, `canonical`, `subscription`, `paid`, `personalized`
- `requestApi`: `auto`, `completions`, `responses`
- `provider`: optional NanoGPT upstream provider id

## Web Search

The plugin now also registers a NanoGPT-backed `web_search` provider using
NanoGPT's direct `POST /api/web` endpoint.

You can provide the search credential either through:

- `NANOGPT_API_KEY`
- `plugins.entries.nanogpt.config.webSearch.apiKey`

## Image Generation

The plugin now also registers a NanoGPT image generation provider backed by:

- `POST https://nano-gpt.com/v1/images/generations`

Current curated image model list:

- `hidream`
- `chroma`
- `z-image-turbo`
- `qwen-image-2512`

The default image model is `hidream`.

The provider also normalizes friendly subscription labels to the curated NanoGPT
ids above. For example:

- `HIDREAM` -> `hidream`
- `CHROMA` -> `chroma`
- `Z IMAGE TURBO` -> `z-image-turbo`
- `QWEN IMAGE` -> `qwen-image-2512`

If NanoGPT rejects an image model id, the provider now returns an error that
points back to the curated model list and these accepted aliases.

## Publish to npm

```bash
npm test
npm run typecheck
npm pack --dry-run
npm publish --access public
```
