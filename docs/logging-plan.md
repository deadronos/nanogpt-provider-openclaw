# Logging Plan — nanogpt-provider-openclaw

## Overview

Add a **dedicated log file** for the NanoGPT provider plugin, separate from OpenClaw's own logs.

**Log file:** `~/.openclaw/logs/nanogpt/nanogpt.log`

This enables targeted observability: filter nanogpt noise out of OpenClaw logs, tail nanogpt-specific issues independently.

---

## Log Level Conventions

| Condition | Level |
|-----------|-------|
| Normal flows, state transitions, successful operations | `info` |
| Anomaly detected (unexpected but handled) | `warn` |
| Hard / unrecoverable errors | `error` |

---

## Log File Setup

### Path Derivation

The log directory is derived from OpenClaw's state directory:

```
~/.openclaw/logs/nanogpt/nanogpt.log
```

In code, resolve via `os.homedir()` + `/.openclaw/logs/nanogpt/`. Create the directory with `{ recursive: true }` on init.

### File Rotation

- Append mode (no rotation by default — let the system's logrotate handle it, or a size limit can be added later).
- File is created automatically on first write.

### Log Line Format

```
{ISO timestamp} [{level}] [{module}] {message} {optional JSON meta}
```

Example:
```
2026-04-23T08:30:00.000Z [info] [stream-hooks] stream result received modelId=kimi-max-longtext family=kimi
2026-04-23T08:30:01.000Z [warn] [anomaly] tool_enabled_turn_without_tool_call model=kimi-max-longtext stage=stream_result
2026-04-23T08:30:02.000Z [error] [routing] subscription probe failed HTTP 429
```

---

## Module Inventory

Each module below gets a logger instance. Log calls replace or augment existing anomaly/warn uses of the OpenClaw plugin logger.

| Module | File | What's logged |
|--------|------|--------------|
| **Logger setup** | `provider/nanogpt-logger.ts` | Logger factory (new) |
| **Plugin entry** | `index.ts` | Provider registered, config resolved |
| **Stream hooks** | `provider/stream-hooks.ts` | Stream result received, anomaly detections |
| **Error hooks** | `provider/error-hooks.ts` | Error surface detections, failover reason classification |
| **Replay hooks** | `provider/replay-hooks.ts` | Replay policy built, sanitize/validate results |
| **Tool schema hooks** | `provider/tool-schema-hooks.ts` | Schema normalization decisions |
| **Catalog hooks** | `provider/catalog-hooks.ts` | Catalog augmentation |
| **Routing** | `runtime/routing.ts` | Routing mode, subscription probe result |
| **Discovery** | `runtime/discovery.ts` | Model discovery results |
| **Usage** | `runtime/usage.ts` | Usage snapshot fetch |
| **Auth** | `provider/auth.ts` | Auth method setup |
| **Web search** | `web-search.ts` | Web search request/response |
| **Image gen** | `image-generation-provider.ts` | Image generation request/response |
| **Bridge** | `provider/bridge/*.ts` | Bridge system message injection, retry attempts |
| **Errors** | `nanogpt-errors.ts` | Error surface inspection results |

---

## Implementation Steps

### Step 1 — Logger utility (`provider/nanogpt-logger.ts`)

Create a module that:
1. Derives `~/.openclaw/logs/nanogpt/` using `os.homedir()`
2. Creates the directory with `fs.mkdirSync(..., { recursive: true })`
3. Opens a file handle in append mode
4. Exports `createNanoGptLogger(moduleName)` → object with `{ info, warn, error }`
5. Each log call writes a formatted line to the file and optionally forwards to the OpenClaw plugin logger (so anomalies still show in the OpenClaw log too)

```typescript
type NanoGptLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};
```

Singleton file handle — create once, close on process exit or via `once` event.

### Step 2 — Wire into `index.ts`

At plugin registration time, initialize the logger and expose it for use by other modules. Either pass it through context or use a shared module-level getter pattern.

### Step 3 — Add logging calls to each module

Go module by module, adding `info`/`warn`/`error` calls per the conventions above. Existing anomaly `warn` calls that use the OpenClaw plugin logger should also emit to the nanogpt log file.

### Step 4 — Verify

Run the plugin or its tests. Confirm `~/.openclaw/logs/nanogpt/nanogpt.log` is created and lines appear within seconds of module activity.

---

## What Not to Log

- API keys / raw Bearer tokens (sanitize before logging)
- Full request/response bodies (summarize counts, shapes, not contents)
- Personal data

---

## Open Questions / Deferred

- Log rotation: let system logrotate handle it; size cap can be added later if needed
- Output to stdout in addition to file: not needed for now (OpenClaw already handles plugin stdout)
- Console transport: not needed
