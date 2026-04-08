# NanoGPT Provider for OpenClaw

Unofficial NanoGPT provider plugin for OpenClaw with API-key auth, dynamic model discovery, and automatic subscription or pay-as-you-go routing.

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
- `provider`: optional NanoGPT upstream provider id

## Publish to npm

```bash
npm test
npm run typecheck
npm pack --dry-run
npm publish --access public
```
