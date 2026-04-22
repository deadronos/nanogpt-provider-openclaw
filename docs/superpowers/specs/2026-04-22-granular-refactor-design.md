# Granular Refactor Design — 2026-04-22

## Goal

Refactor the NanoGPT provider plugin into smaller, single-responsibility files and extract duplicated logic into shared helpers/utils. No behavioral changes — only structural reorganization.

---

## Scope

### Files in scope (high-priority candidates)

| File | Lines | Concern |
|------|-------|---------|
| `provider/replay-hooks.ts` | 812 | Replay policy, sanitation, validation |
| `provider/stream-hooks.ts` | 644 | Stream response hooks, anomaly detection |
| `runtime/routing.ts` | 202 | Routing logic, subscription probing |
| `runtime/usage.ts` | 226 | Usage snapshot fetching and parsing |
| `nanogpt-errors.ts` | 458 | Error shaping and parsing |

### Out of scope for this pass

- `provider-catalog.ts`, `provider-discovery.ts`, `index.ts`, `models.ts`, `onboard.ts`, `api.ts`, `image-generation-provider.ts`
- Test files (`.test.ts`) will be updated to reflect the new file structure but are not primary targets.

---

## Duplication to eliminate

### Duplication 1 — Marker constants and helpers (provider/)

**Duplicated across:** `provider/replay-hooks.ts` and `provider/stream-hooks.ts`

Constants:
- `NANO_GPT_REASONING_TAG_PAIRS`
- `NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS`
- `NANO_GPT_FUNCTION_CALL_MARKERS`

Helpers:
- `countNanoGptSubstringOccurrences` (identical in both files)

**Resolution:** Extract into `provider/markers.ts`

```ts
// provider/markers.ts
export const NANO_GPT_REASONING_TAG_PAIRS = [...]
export const NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS = [...]
export const NANO_GPT_FUNCTION_CALL_MARKERS = [...]

export function countNanoGptSubstringOccurrences(haystack: string, needle: string): number { ... }
```

Both `provider/replay-hooks.ts` and `provider/stream-hooks.ts` import from `provider/markers.ts` instead of defining their own copies.

---

### Duplication 2 — Marker inspection helpers (provider/)

**Duplicated across:** `provider/replay-hooks.ts` and `provider/stream-hooks.ts`

Both files have near-identical `collect*MarkerInspection` functions that:
- scan visible text for reasoning tag pairs and check balance
- filter for XML-like tool wrapper markers
- filter for function-call markers
- combine into `toolLikeMarkers`

**Resolution:** Extract into `provider/inspection.ts`

```ts
// provider/inspection.ts

export type NanoGptStreamMarkerInspection = Readonly<{
  reasoningMarkerNames: readonly string[];
  reasoningIsUnbalanced: boolean;
  xmlLikeToolWrapperMarkers: readonly string[];
  functionCallMarkers: readonly string[];
  toolLikeMarkers: readonly string[];
}>;

export function collectNanoGptStreamMarkerInspection(visibleText: string): NanoGptStreamMarkerInspection { ... }
```

Note: The replay file has additional inspection types (`NanoGptReplayAssistantInspection`, `NanoGptReplayToolResultInspection`) that are replay-specific and stay in `provider/replay-hooks.ts`.

---

### Duplication 3 — Subscription state helpers (runtime/)

**Duplicated across:** `runtime/routing.ts` and `runtime/usage.ts`

- `resolveNanoGptSubscriptionState`
- `hasNanoGptFutureGracePeriod`
- `resolveNanoGptSubscriptionActive`

**Resolution:** Extract into `runtime/subscription.ts`

```ts
// runtime/subscription.ts
export function resolveNanoGptSubscriptionState(value: unknown): boolean | undefined { ... }
export function hasNanoGptFutureGracePeriod(value: unknown): boolean { ... }
export function resolveNanoGptSubscriptionActive(payload: NanoGptSubscriptionPayload): boolean { ... }
```

Both `runtime/routing.ts` and `runtime/usage.ts` import from `runtime/subscription.ts`.

---

### Duplication 4 — `isRecord` in nanogpt-errors.ts

**Duplicated across:** `nanogpt-errors.ts` defines a local `isRecord` that is identical to `shared/guards.ts`'s exported `isRecord`.

**Resolution:** Replace the local definition with `import { isRecord } from "./shared/guards.js";`

---

## New file structure

```
src/
  provider/
    markers.ts          # NEW — shared marker constants and count helper
    inspection.ts       # NEW — shared stream marker inspection helper
    replay-hooks.ts     # UPDATED — uses markers.ts + inspection.ts
    stream-hooks.ts     # UPDATED — uses markers.ts + inspection.ts
  runtime/
    subscription.ts     # NEW — shared subscription state helpers
    routing.ts          # UPDATED — uses subscription.ts
    usage.ts            # UPDATED — uses subscription.ts
  shared/
    guards.ts           # UNCHANGED
    http.ts             # UNCHANGED
    parse.ts            # UNCHANGED
  nanogpt-errors.ts     # UPDATED — imports isRecord from shared/guards
```

---

## Constraints

1. **No behavioral changes.** All refactors are purely structural.
2. **Export compatibility.** Public APIs remain unchanged — only internal imports shift.
3. **Test compatibility.** All existing tests continue to work without modification.
4. **Follow existing patterns.** Use the same import style (`.js` specifiers), naming conventions, and type annotation patterns already in the codebase.
5. **Run validation.** After each file change: `npm run typecheck` must pass. After all changes: `npm test` must pass.

---

## Implementation order

1. Create `provider/markers.ts` with constants + `countSubstringOccurrences`
2. Update `provider/replay-hooks.ts` to import from `markers.ts`; remove local copies
3. Update `provider/stream-hooks.ts` to import from `markers.ts`; remove local copies
4. Create `provider/inspection.ts` with `collectNanoGptStreamMarkerInspection`
5. Update `provider/replay-hooks.ts` to import `collectNanoGptStreamMarkerInspection` from `inspection.ts`
6. Update `provider/stream-hooks.ts` to import `collectNanoGptStreamMarkerInspection` from `inspection.ts`
7. Create `runtime/subscription.ts` with subscription state helpers
8. Update `runtime/routing.ts` to import from `subscription.ts`; remove local copies
9. Update `runtime/usage.ts` to import from `subscription.ts`; remove local copies
10. Fix `nanogpt-errors.ts` to import `isRecord` from `shared/guards`
11. Run `npm test` and `npm run typecheck`
