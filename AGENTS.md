# AGENTS.md

## Quick start

- This repository is a TypeScript ESM OpenClaw provider plugin for NanoGPT.
- Validate most code changes with:
  - `npm test`
  - `npm run typecheck`
- If you changed packaging, install flow, or shipped files, also run:
  - `npm run build`

## File ownership

- `index.ts` — main plugin entrypoint; registers the NanoGPT provider plus web search and image generation surfaces.
- `provider-catalog.ts` — builds the `ModelProviderConfig` from NanoGPT discovery, routing, and request API selection.
- `provider-discovery.ts` — lightweight provider discovery entry referenced by plugin metadata.
- `runtime.ts` — NanoGPT HTTP/runtime logic: routing mode, base URLs, provider pricing, usage snapshots, request headers, and dynamic model resolution helpers.
- `index.ts` — provider registration plus tool-schema hooks, error classification, and the current pass-through `wrapStreamFn`.
- `web-search.ts` — NanoGPT-backed `web_search` provider; follow its existing credential-resolution pattern.
- `image-generation-provider.ts` — NanoGPT image generation and image edit provider.
- `onboard.ts` — config onboarding/apply helpers.
- `models.ts` — provider constants, model metadata, routing defaults, curated mappings, and compat decisions.
- `openclaw.plugin.json` and `package.json` — plugin metadata, auth/config schema, compatibility metadata, and shipped package surface.

## Repo-specific conventions

- The package uses Node ESM (`"type": "module"`). Keep local TypeScript imports using `.js` specifiers.
- Prefer OpenClaw SDK helpers for config and credential resolution instead of ad hoc env parsing in provider surfaces.
- When changing user-visible config, auth, install, or capability behavior, keep `README.md` and `openclaw.plugin.json` aligned with the code.
- When changing what ships, update `package.json`'s `files` list. Packaging tests expect `dist/package` to contain only the declared package surface.
- For tool-call or stream-response bugs, inspect `index.ts` and `index.test.ts` around `wrapStreamFn`, `normalizeToolSchemas`, and `inspectToolSchemas` before changing unrelated provider registration code.

## Testing and packaging

- Tests are Vitest `*.test.ts` files and generally mirror the source module they cover.
- Use `test-env.ts` helpers to snapshot and restore environment variables in tests.
- `nanogpt.integration.test.ts` is a live API smoke test and is skipped unless `NANOGPT_API_KEY` is set.
- `npm run build` stages a clean install surface in `dist/package` via `scripts/stage-package-dir.mjs`.
- Prefer validating OpenClaw installs from `dist/package` or the tarball output instead of the raw working tree unless you are explicitly testing checkout-install behavior.
- If you change packaging behavior, review the package-surface/install tests: `stage-package-dir.test.ts`, `package-files.test.ts`, and `install-preflight.test.ts`.

## Docs to consult

Link to these docs instead of duplicating them in future instructions or reports:

- Install, auth, config, and current capabilities: [`README.md`](./README.md)
- Plugin design context: [`docs/superpowers/specs/2026-04-08-nanogpt-provider-design.md`](./docs/superpowers/specs/2026-04-08-nanogpt-provider-design.md)
- OpenClaw provider/model hook lifecycle: [`docs/openclaw-provider-model-request-lifecycle-hooks-2026-04-16.md`](./docs/openclaw-provider-model-request-lifecycle-hooks-2026-04-16.md)
- NanoProxy/tool-reliability comparison: [`docs/nanoproxy-openclaw-tool-reliability-report-2026-04-16.md`](./docs/nanoproxy-openclaw-tool-reliability-report-2026-04-16.md)
- NanoGPT API coverage notes: [`docs/nanogpt-api-surface-coverage-audit-2026-04-14.md`](./docs/nanogpt-api-surface-coverage-audit-2026-04-14.md)

## Good default workflow for agents

1. Identify the owning module before editing.
2. Make the smallest change that preserves the current public surface.
3. Run `npm test` and `npm run typecheck` after behavior changes.
4. If the package surface or install path changed, run `npm run build` and review the staged output expectations.
5. Update linked user-facing docs when config, auth, install, or capability behavior changes.
