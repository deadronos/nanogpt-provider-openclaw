# NanoGPT Provider for OpenClaw

NanoGPT provider plugin for OpenClaw with API-key auth, dynamic model discovery,
and automatic subscription or pay-as-you-go routing.

## Install

```bash
openclaw plugins install @deadronos/openclaw-nanogpt-provider
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
