# CLAUDE Instructions

This repository uses `AGENTS.md` as the primary workspace guidance file for AI coding agents.

## Primary guidance

- Read `AGENTS.md` first for the repo's build/test commands, file ownership, packaging and install conventions, test patterns, and key docs links.
- Treat `AGENTS.md` as the authoritative source for how to work safely in this repository.

## Quick pointers

- Validate changes with `npm test` and `npm run typecheck`.
- If packaging or install surface changes, also run `npm run build`.
- Keep `README.md`, `package.json`, and `openclaw.plugin.json` aligned when changing provider metadata or config.
- Use `.github/instructions/*.instructions.md` for focused guidance on packaging, provider runtime, and tests.

## References

- [`AGENTS.md`](./AGENTS.md)
- `.github/instructions/packaging-and-release-surface.instructions.md`
- `.github/instructions/provider-runtime-conventions.instructions.md`
- `.github/instructions/test-patterns.instructions.md`
- `.github/prompts/repo-check-before-pr.prompt.md`
