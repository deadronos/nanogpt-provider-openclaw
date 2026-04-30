---
description: "Use when editing the NanoGPT provider runtime, provider catalog/discovery, request routing, usage hooks, model resolution, web search, image generation, or tool-call repair. Covers module ownership and OpenClaw provider-hook conventions for this repo."
name: "Provider Runtime Conventions"
applyTo:
  - "index.ts"
  - "runtime.ts"
  - "models.ts"
  - "provider-catalog.ts"
  - "provider-discovery.ts"
  - "repair.ts"
  - "web-search.ts"
  - "image-generation-provider.ts"
  - "onboard.ts"
---

# Provider runtime conventions

- Keep module boundaries clear:
  - `index.ts` wires plugin registration and hook selection.
  - `provider-catalog.ts` builds the runtime `ModelProviderConfig`.
  - `provider-discovery.ts` stays lightweight and discovery-focused.
  - `runtime.ts` owns NanoGPT HTTP behavior, routing, pricing, usage, headers, and dynamic model helpers.
  - `repair.ts` owns malformed tool-call repair behavior.
- Prefer OpenClaw plugin SDK helpers and existing provider hooks over ad hoc request plumbing.
- Preserve the current public/provider surface unless the task explicitly changes it: provider id `nanogpt`, auth env var `NANOGPT_API_KEY`, registered web search provider, image generation provider, and provider-usage hooks.
- For tool-call reliability issues, start from `repair.ts`, `repair.test.ts`, and the hook wiring in `index.ts` before changing broader discovery or runtime logic.
- Keep transport/routing behavior internally consistent across:
  - `runtime.ts`
  - `provider-catalog.ts`
  - `models.ts`
  - `README.md`
- Prefer small, composable changes and add or update targeted tests next to the owning module.
- Useful docs to link, not duplicate:
  - [`AGENTS.md`](../../AGENTS.md)
  - [`docs/openclaw-provider-model-request-lifecycle-hooks-2026-04-16.md`](../../docs/openclaw-provider-model-request-lifecycle-hooks-2026-04-16.md)
  - [`docs/nanoproxy-openclaw-tool-reliability-report-2026-04-16.md`](../../docs/nanoproxy-openclaw-tool-reliability-report-2026-04-16.md)
