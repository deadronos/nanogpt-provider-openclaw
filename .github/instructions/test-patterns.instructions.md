---
description: "Use when creating or editing Vitest tests in this repository. Covers env handling, live NanoGPT test gating, packaging/install validation, and how tests map to the owning source modules."
name: "Test Patterns"
applyTo: "**/*.test.ts"
---

# Test patterns

- Follow the existing Vitest style: focused `describe`/`it` coverage with tests placed beside the owning source module.
- Add tests in the file that matches the changed behavior when possible (`runtime.test.ts`, `repair.test.ts`, `provider-catalog.test.ts`, etc.).
- Use `test-env.ts` helpers for environment mutation instead of leaving `process.env` changes behind.
- Keep live API tests explicitly gated. `nanogpt.integration.test.ts` should only run when `NANOGPT_API_KEY` is set.
- If you change packaging or install behavior, update the packaging/install coverage as needed:
  - `stage-package-dir.test.ts`
  - `package-files.test.ts`
  - `install-preflight.test.ts`
- Prefer targeted assertions over broad snapshots, especially for provider config, request headers, model discovery, and repaired tool-call payloads.
- After behavior changes, run the smallest useful validation set first, then the repo defaults:
  - `npm test`
  - `npm run typecheck`
