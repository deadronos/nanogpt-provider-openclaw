# NanoGPT Context Window Status Display Fix — Design

> **Status:** Approved (Approach A: plugin self-writes `models.json` at registration, always overwrite, background/fire-and-forget, plugin-only, **opt-in via `persistDiscoveredCatalog` flag**).

## Problem

`session_status` (and `/status`) shows 200 000 tokens of context window for every NanoGPT provider model, even though the live `nano-gpt.com/api/v1/models?detailed=true` response includes the correct `context_length` (e.g. `1 048 576` for `deepseek/deepseek-v4-flash`). The actual agent runtime uses the correct value, but the status display reads from `MODEL_CONTEXT_TOKEN_CACHE` in OpenClaw core, which falls back to a bundled 200 000 default because the agent's `~/.openclaw/agents/main/agent/models.json` is `{"providers": {}}` and `openclaw.json` has no `models.providers[].contextWindow` override for the affected models.

## Approach (locked in)

The plugin already has the discovered catalog (`nanoGptProviderCatalog.run()` → `buildNanoGptProvider()` → live `/models?detailed=true`). The status code reads from `<agentDir>/models.json`. The plugin will close the gap by writing the live-discovered `providers.nanogpt` block into that file at registration time.

- **Opt-in via `persistDiscoveredCatalog: true`** in plugin config. The flag defaults to `false` so the plugin never mutates agent state without explicit user consent. When the flag is `false` (default), the plugin does not touch `models.json` and the status code continues to fall back to the bundled 200 000 default until the user enables the flag or sets `openclaw.json.models.providers.nanogpt.models[].contextWindow` explicitly.
- **Always overwrite** the `providers.nanogpt` block (never fill-if-empty) so stale entries (models removed from the live catalog) are pruned on every successful discovery.
- **Background, fire-and-forget**: discovery + write happen after `register(api)` returns. The plugin load is never blocked.
- **Best-effort, never throws**: read errors, write errors, discovery errors, and missing API key are all logged as warnings and swallowed. The next plugin load retries.
- **Atomic write**: temp file + rename, with a unique temp path per process to avoid cross-process stomping.
- **Preserves other providers**: only the `providers.nanogpt` key is touched; the rest of `models.json` is left as-is.
- **Plugin-only**: zero changes to OpenClaw core or the SDK.

## Design

### New module: `provider/discovery-persistence.ts`

Four pure / semi-pure functions plus a fire-and-forget scheduler:

| Function | Type | Purpose |
|---|---|---|
| `buildNanogptProvidersBlock(config)` | pure | Convert a `ModelProviderConfig` into a `providers.nanogpt` JSON block. Returns `null` if config is empty. |
| `mergeModelsJsonProvidersNanogpt({ existing, block })` | pure | Replace the `providers.nanogpt` key in an existing parsed `models.json` value with the new block. Preserves every other provider. Returns `{ providers, changed }`. |
| `writeNanogptProviderCatalogToModelsJson({ agentDir, block })` | side-effect | Atomic temp+rename write. Returns `{ ok, changed, path, reason? }`. |
| `scheduleNanogptProviderCatalogPersistence(params)` | side-effect | Fire-and-forget wrapper: resolves API key, calls `buildNanoGptProvider`, builds the block, writes to disk, logs warnings on failure, never throws. |

### Wiring in `index.ts`

After `api.registerProvider(...)` and `api.registerModelCatalogProvider(...)`, call `scheduleNanogptProviderCatalogPersistence({ resolveApiKey, pluginConfig, env, logger })`. The `resolveApiKey` callback reads `process.env.NANOGPT_API_KEY` (matches the existing `NANOGPT_API_KEY_ENV_VAR` constant in `provider/auth.ts`).

### File surface

- New file: `provider/discovery-persistence.ts` — added to `package.json` `files` list.
- New test: `provider/discovery-persistence.test.ts` — covers all four functions plus the integration with `index.ts`.
- Modified: `index.ts` — schedule persistence after provider registration.
- Modified: `package.json` `files` — add the new source file.
- Modified: `package-files.test.ts` — add the new file to the expected list.
- Modified: `README.md` — short note in the install / authentication section explaining that the plugin now writes the discovered catalog to `<agentDir>/models.json` for status display.

## Out of scope

- Changes to OpenClaw core (`src/agents/context.ts`, `MODEL_CONTEXT_TOKEN_CACHE`).
- Changes to the OpenClaw plugin SDK surface.
- A doctor `--fix` upgrade to scan the new path. The user's symptom is purely the status display, and the doctor fix path already exists via `openclaw.json`. This design fixes the data flow that the status code reads from, which is sufficient.

## Validation

- `npm test` — all unit tests pass, including the new `discovery-persistence.test.ts`.
- `npm run typecheck` — clean.
- `npm run lint` — clean.
- `npm run build` — staged `dist/package` surface is unchanged except for the new `provider/discovery-persistence.ts` entry.
- New integration test in `index.test.ts`: write a `models.json` with a stale `providers.nanogpt` block, run the plugin's persistence, verify the block is replaced and other providers are preserved.

## Risks

- **Concurrent plugin loads.** Each process uses a unique temp file path (PID + timestamp), so two simultaneous plugin loads will not corrupt the file. Last-write-wins is acceptable because every load produces the same canonical block from the same API.
- **OpenClaw core races.** If OpenClaw core's own `ensureOpenClawModelsJson()` runs after the plugin's write, it may still empty the file. That's a pre-existing bug independent of this fix. This design makes the file correct as often as possible; if core's pass also runs, the next plugin load will re-populate it.
- **Missing API key.** When the key is absent, persistence is silently skipped. Status will continue to show 200 000 until the key is set. This is the desired behavior — no fabricated data, no crashes.
