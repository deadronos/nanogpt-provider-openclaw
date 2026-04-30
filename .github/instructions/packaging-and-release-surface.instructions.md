---
description: "Use when editing package.json, openclaw.plugin.json, README install or auth sections, packaging scripts, or packaging/install tests. Covers staged package surface, install validation, and release-surface consistency for this OpenClaw plugin repo."
name: "Packaging and Release Surface"
applyTo:
  - "package.json"
  - "openclaw.plugin.json"
  - "scripts/**"
  - "README.md"
  - "**/stage-package-dir.test.ts"
  - "**/package-files.test.ts"
  - "**/install-preflight.test.ts"
---

# Packaging and release surface

- Treat the shipped package surface as a contract. If you change what should be installed or published, update `package.json` `files` and keep the staged output expectations in sync.
- Prefer the staged package flow over raw-checkout assumptions. This repo validates packaging through `scripts/stage-package-dir.mjs` and expects installs to work cleanly from `dist/package` or the packed tarball.
- When changing install, auth, config, provider metadata, or packaging behavior, keep these aligned together:
  - `package.json`
  - `openclaw.plugin.json`
  - `README.md`
  - packaging/install tests
- Preserve plugin metadata contracts such as `openclaw.extensions`, provider ids, auth env vars, config schema, and compatibility metadata unless the task explicitly changes them.
- Do not add accidental package bloat. The staged package should only contain the declared surface, not workspace artifacts like `node_modules`.
- After changing release or install surface, run:
  - `npm run build`
  - `npm test`
  - `npm run typecheck`
- Consult linked docs instead of copying them:
  - [`README.md`](../../README.md)
