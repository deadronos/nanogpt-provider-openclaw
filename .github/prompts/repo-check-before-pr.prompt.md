---
description: "Review current repository changes before opening a PR. Use when you want a repo-aware pre-PR check for validation, packaging/install drift, docs drift, and follow-up risks in nanogpt-provider-openclaw."
name: "Repo Check Before PR"
argument-hint: "Optional focus area or changed files"
agent: "agent"
---

Review the current repository state before opening a pull request.

Use the repo guidance in [`AGENTS.md`](../../AGENTS.md) and inspect the current uncommitted and committed changes in this branch.

Focus on:

1. what changed and which module owns each change
2. which validation commands are required for the touched files
3. whether packaging/install surface changed and therefore needs `npm run build`
4. whether user-facing docs need updates (`README.md`, plugin metadata, or linked docs under [`docs/`](../../docs/))
5. likely PR risks, missing tests, or follow-up items

When you run validations, prefer this repo's defaults:

- `npm test`
- `npm run typecheck`
- `npm run build` when package surface, install flow, metadata, or published files changed

Output:

- concise change summary
- validations run or still needed
- docs/config drift check
- blockers or follow-ups before PR

If the optional argument is provided, prioritize that area while still checking overall release-surface risk.
