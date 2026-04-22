# Granular Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor large provider and runtime files into granular files with single responsibilities; extract duplicated logic into shared helpers.

**Architecture:** Extract three shared modules (`provider/markers.ts`, `provider/inspection.ts`, `runtime/subscription.ts`) to host duplicated constants, helpers, and types. Update all consumers to import from the new modules. Replace local `isRecord` in `nanogpt-errors.ts` with the one from `shared/guards.ts`.

**Tech Stack:** TypeScript ESM, Vitest

---

## File Map

| File | Action |
|------|--------|
| `provider/markers.ts` | **CREATE** — shared marker constants + count helper |
| `provider/inspection.ts` | **CREATE** — shared stream marker inspection helper |
| `provider/replay-hooks.ts` | **MODIFY** — import from markers.ts + inspection.ts; remove local copies |
| `provider/stream-hooks.ts` | **MODIFY** — import from markers.ts + inspection.ts; remove local copies |
| `runtime/subscription.ts` | **CREATE** — shared subscription state helpers |
| `runtime/routing.ts` | **MODIFY** — import from subscription.ts; remove local copies |
| `runtime/usage.ts` | **MODIFY** — import from subscription.ts; remove local copies |
| `nanogpt-errors.ts` | **MODIFY** — replace local `isRecord` with import from `shared/guards.ts` |

---

## Task 1: Create `provider/markers.ts`

**Files:**
- Create: `provider/markers.ts`
- Read: `provider/replay-hooks.ts:62-97` (constants to extract)
- Read: `provider/stream-hooks.ts:62-97` (identical constants)

- [ ] **Step 1: Create `provider/markers.ts` with shared constants and helper**

```ts
import {
  NANO_GPT_REASONING_TAG_PAIRS,
  NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS,
  NANO_GPT_FUNCTION_CALL_MARKERS,
  countNanoGptSubstringOccurrences,
} from "./markers.js";

export { NANO_GPT_REASONING_TAG_PAIRS, NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS, NANO_GPT_FUNCTION_CALL_MARKERS };
export { countNanoGptSubstringOccurrences };
```

Write the full file content (from replay-hooks.ts lines 62-97):

```ts
export const NANO_GPT_REASONING_TAG_PAIRS = [
  { open: "<thinking>", close: "</thinking>" },
  { open: "<reasoning>", close: "</reasoning>" },
  { open: "<analysis>", close: "</analysis>" },
] as const;

export const NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS = [
  "<tool>",
  "</tool>",
  "<tool_call>",
  "</tool_call>",
  "<tools>",
  "</tools>",
  "<invoke>",
  "</invoke>",
] as const;

export const NANO_GPT_FUNCTION_CALL_MARKERS = ["<function=", "function="] as const;

export function countNanoGptSubstringOccurrences(haystack: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  const normalizedHaystack = haystack.toLowerCase();
  const normalizedNeedle = needle.toLowerCase();
  let count = 0;
  let index = 0;

  while ((index = normalizedHaystack.indexOf(normalizedNeedle, index)) !== -1) {
    count += 1;
    index += normalizedNeedle.length;
  }

  return count;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (new file has no consumers yet)

- [ ] **Step 3: Commit**

```bash
git add provider/markers.ts
git commit -m "feat(provider): extract shared marker constants and helpers into provider/markers.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Update `provider/stream-hooks.ts`

**Files:**
- Modify: `provider/stream-hooks.ts`
- Read: `provider/stream-hooks.ts:1-97` (imports + constants)
- Read: `provider/markers.ts` (new home for constants)

- [ ] **Step 1: Add import from markers.ts at top of file**

After existing imports (after line 12: `import { isRecord } from "../shared/guards.js";`), add:

```ts
import {
  NANO_GPT_REASONING_TAG_PAIRS,
  NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS,
  NANO_GPT_FUNCTION_CALL_MARKERS,
  countNanoGptSubstringOccurrences,
} from "./markers.js";
```

- [ ] **Step 2: Remove local constant definitions (lines 62-79)**

Delete the local definitions of:
- `NANO_GPT_REASONING_TAG_PAIRS` (lines 62-66)
- `NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS` (lines 68-77)
- `NANO_GPT_FUNCTION_CALL_MARKERS` (line 79)

- [ ] **Step 3: Remove `countNanoGptSubstringOccurrences` function (lines 81-97)**

Delete the local `countNanoGptSubstringOccurrences` function.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add provider/stream-hooks.ts
git commit -m "refactor(provider/stream-hooks): import marker constants from provider/markers.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Update `provider/replay-hooks.ts`

**Files:**
- Modify: `provider/replay-hooks.ts`
- Read: `provider/replay-hooks.ts:79-119` (constants to extract)

- [ ] **Step 1: Add import from markers.ts**

Add after the existing `import { isRecord } from "../shared/guards.js";` line:

```ts
import {
  NANO_GPT_REASONING_TAG_PAIRS,
  NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS,
  NANO_GPT_FUNCTION_CALL_MARKERS,
  countNanoGptSubstringOccurrences,
} from "./markers.js";
```

- [ ] **Step 2: Remove local constant definitions (lines 79-96)**

Delete:
- `NANO_GPT_REASONING_TAG_PAIRS` (lines 79-83)
- `NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS` (lines 85-93)
- `NANO_GPT_FUNCTION_CALL_MARKERS` (line 96)

- [ ] **Step 3: Remove `countNanoGptReplaySubstringOccurrences` function (lines 103-119)**

Delete the local `countNanoGptReplaySubstringOccurrences` function. Note: this function is identical to the one in stream-hooks.ts (now `countNanoGptSubstringOccurrences`), just rename on import.

- [ ] **Step 4: Update reference to `countNanoGptReplaySubstringOccurrences`**

Find any call sites of `countNanoGptReplaySubstringOccurrences` and rename to `countNanoGptSubstringOccurrences`.

Search for: `countNanoGptReplaySubstringOccurrences`

- [ ] **Step 5: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add provider/replay-hooks.ts
git commit -m "refactor(provider/replay-hooks): import marker constants from provider/markers.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Create `provider/inspection.ts`

**Files:**
- Create: `provider/inspection.ts`
- Read: `provider/stream-hooks.ts:169-202` (`collectNanoGptStreamMarkerInspection` to extract)
- Read: `provider/replay-hooks.ts:169-258` (`collectNanoGptReplayAssistantInspection` — replay-specific, not extracted)

- [ ] **Step 1: Create `provider/inspection.ts`**

Extract the `NanoGptStreamMarkerInspection` type and `collectNanoGptStreamMarkerInspection` function from `provider/stream-hooks.ts` (lines 34-40 for type, 169-202 for function). Also re-export `NanoGptStreamMarkerInspection` type from `anomaly-types.ts` for convenience, or define it fresh here (it matches exactly).

```ts
import {
  NANO_GPT_REASONING_TAG_PAIRS,
  NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS,
  NANO_GPT_FUNCTION_CALL_MARKERS,
  countNanoGptSubstringOccurrences,
} from "./markers.js";

export type NanoGptStreamMarkerInspection = Readonly<{
  reasoningMarkerNames: readonly string[];
  reasoningIsUnbalanced: boolean;
  xmlLikeToolWrapperMarkers: readonly string[];
  functionCallMarkers: readonly string[];
  toolLikeMarkers: readonly string[];
}>;

export function collectNanoGptStreamMarkerInspection(visibleText: string): NanoGptStreamMarkerInspection {
  const normalizedVisibleText = visibleText.toLowerCase();
  const reasoningMarkerNames = new Set<string>();
  let reasoningIsUnbalanced = false;

  for (const tagPair of NANO_GPT_REASONING_TAG_PAIRS) {
    const openTagCount = countNanoGptSubstringOccurrences(normalizedVisibleText, tagPair.open);
    const closeTagCount = countNanoGptSubstringOccurrences(normalizedVisibleText, tagPair.close);
    if (openTagCount === 0 && closeTagCount === 0) {
      continue;
    }

    reasoningMarkerNames.add(tagPair.open);
    reasoningMarkerNames.add(tagPair.close);
    if (openTagCount !== closeTagCount) {
      reasoningIsUnbalanced = true;
    }
  }

  const xmlLikeToolWrapperMarkers = NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS.filter((marker) =>
    normalizedVisibleText.includes(marker),
  );
  const functionCallMarkers = NANO_GPT_FUNCTION_CALL_MARKERS.filter((marker) =>
    normalizedVisibleText.includes(marker),
  );

  return {
    reasoningMarkerNames: [...reasoningMarkerNames],
    reasoningIsUnbalanced,
    xmlLikeToolWrapperMarkers,
    functionCallMarkers,
    toolLikeMarkers: [...new Set([...xmlLikeToolWrapperMarkers, ...functionCallMarkers])],
  };
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add provider/inspection.ts
git commit -m "feat(provider): extract shared marker inspection into provider/inspection.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Update `provider/stream-hooks.ts` to use `provider/inspection.ts`

**Files:**
- Modify: `provider/stream-hooks.ts`

- [ ] **Step 1: Add import from inspection.ts**

Add after the markers import:

```ts
import {
  collectNanoGptStreamMarkerInspection,
  type NanoGptStreamMarkerInspection,
} from "./inspection.js";
```

Also remove the local `NanoGptStreamMarkerInspection` type definition (lines 34-40).

- [ ] **Step 2: Remove `collectNanoGptStreamMarkerInspection` function (lines 169-202)**

Delete the local `collectNanoGptStreamMarkerInspection` function.

- [ ] **Step 3: Verify all call sites still reference `collectNanoGptStreamMarkerInspection`**

Search for `collectNanoGptStreamMarkerInspection` in the file — should now only be called, not defined.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Run tests**

Run: `npm test -- --run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add provider/stream-hooks.ts
git commit -m "refactor(provider/stream-hooks): import marker inspection from provider/inspection.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 6: Update `provider/replay-hooks.ts` to use `provider/inspection.ts`

**Files:**
- Modify: `provider/replay-hooks.ts`
- Read: `provider/replay-hooks.ts:217-258` (the reasoning marker counting portion)

- [ ] **Step 1: Add import from inspection.ts**

Add:

```ts
import { collectNanoGptStreamMarkerInspection } from "./inspection.js";
```

- [ ] **Step 2: Find the local reasoning marker inspection block (lines ~217-258)**

The `collectNanoGptReplayAssistantInspection` function contains its own inline implementation of reasoning marker inspection. This block computes `reasoningMarkerNames`, `reasoningIsUnbalanced`, `xmlLikeToolWrapperMarkers`, `functionCallMarkers`, and `toolLikeMarkers` — which is now in `collectNanoGptStreamMarkerInspection`.

The call site in `collectNanoGptReplayAssistantInspection` looks like:
```ts
const normalizedVisibleText = visibleText.toLowerCase();
const reasoningMarkerNames = new Set<string>();
let reasoningIsUnbalanced = false;

for (const tagPair of NANO_GPT_REASONING_TAG_PAIRS) {
  const openTagCount = countNanoGptReplaySubstringOccurrences(normalizedVisibleText, tagPair.open);
  const closeTagCount = countNanoGptReplaySubstringOccurrences(normalizedVisibleText, tagPair.close);
  if (openTagCount === 0 && closeTagCount === 0) {
    continue;
  }

  reasoningMarkerNames.add(tagPair.open);
  reasoningMarkerNames.add(tagPair.close);
  if (openTagCount !== closeTagCount) {
    reasoningIsUnbalanced = true;
  }
}

const xmlLikeToolWrapperMarkers = NANO_GPT_XML_LIKE_TOOL_WRAPPER_MARKERS.filter((marker) =>
  normalizedVisibleText.includes(marker),
);
const functionCallMarkers = NANO_GPT_FUNCTION_CALL_MARKERS.filter((marker) =>
  normalizedVisibleText.includes(marker),
);
```

Replace this block with:
```ts
const markerInspection = collectNanoGptStreamMarkerInspection(visibleText);
const reasoningMarkerNames = markerInspection.reasoningMarkerNames;
const reasoningIsUnbalanced = markerInspection.reasoningIsUnbalanced;
const xmlLikeToolWrapperMarkers = markerInspection.xmlLikeToolWrapperMarkers;
const functionCallMarkers = markerInspection.functionCallMarkers;
```

Note: This change requires `visibleText` to be the non-normalized text (it's used directly in stream-hooks). The original code normalized inside the function; now we pass the raw `visibleText` and let `collectNanoGptStreamMarkerInspection` do the normalization internally.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `npm test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add provider/replay-hooks.ts
git commit -m "refactor(provider/replay-hooks): import marker inspection from provider/inspection.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Create `runtime/subscription.ts`

**Files:**
- Create: `runtime/subscription.ts`
- Read: `runtime/routing.ts:25-91` (subscription helpers to extract)
- Read: `runtime/usage.ts:99-159` (identical helpers)

- [ ] **Step 1: Create `runtime/subscription.ts`**

Extract `NanoGptSubscriptionPayload` type and the three subscription helpers from `runtime/routing.ts` (lines 17-91). Both `runtime/routing.ts` and `runtime/usage.ts` have identical copies — consolidate into this new file.

```ts
export type NanoGptSubscriptionPayload = {
  subscribed?: unknown;
  active?: unknown;
  state?: unknown;
  plan?: unknown;
  graceUntil?: unknown;
};

export function resolveNanoGptSubscriptionState(value: unknown): boolean | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }

  if (
    normalized === "active" ||
    normalized === "subscribed" ||
    normalized === "grace" ||
    normalized === "grace_period" ||
    normalized === "grace-period" ||
    normalized === "trial" ||
    normalized === "trialing"
  ) {
    return true;
  }

  if (
    normalized === "inactive" ||
    normalized === "expired" ||
    normalized === "unsubscribed" ||
    normalized === "cancelled" ||
    normalized === "canceled" ||
    normalized === "none"
  ) {
    return false;
  }

  return undefined;
}

export function hasNanoGptFutureGracePeriod(value: unknown): boolean {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > Date.now();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value.trim());
    return Number.isFinite(parsed) && parsed > Date.now();
  }
  return false;
}

export function resolveNanoGptSubscriptionActive(payload: NanoGptSubscriptionPayload): boolean {
  const subscribed = typeof payload.subscribed === "boolean" ? payload.subscribed : undefined;
  const active = typeof payload.active === "boolean" ? payload.active : undefined;
  const state = resolveNanoGptSubscriptionState(payload.state);
  const plan = resolveNanoGptSubscriptionState(payload.plan);

  if (subscribed === true || active === true || state === true || plan === true) {
    return true;
  }

  if (hasNanoGptFutureGracePeriod(payload.graceUntil)) {
    return true;
  }

  if (subscribed === false || active === false || state === false || plan === false) {
    return false;
  }

  return false;
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add runtime/subscription.ts
git commit -m "feat(runtime): extract shared subscription state helpers into runtime/subscription.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 8: Update `runtime/routing.ts`

**Files:**
- Modify: `runtime/routing.ts`

- [ ] **Step 1: Add import from subscription.ts**

Add after the existing imports:

```ts
import {
  resolveNanoGptSubscriptionState,
  hasNanoGptFutureGracePeriod,
  resolveNanoGptSubscriptionActive,
  type NanoGptSubscriptionPayload,
} from "./subscription.js";
```

- [ ] **Step 2: Remove local definitions**

Delete from `runtime/routing.ts`:
- `NanoGptSubscriptionPayload` type (lines 17-23)
- `resolveNanoGptSubscriptionState` function (lines 25-58)
- `hasNanoGptFutureGracePeriod` function (lines 61-70)
- `resolveNanoGptSubscriptionActive` function (lines 72-91)

- [ ] **Step 3: Update `probeNanoGptSubscription` function**

The `probeNanoGptSubscription` function references `NanoGptSubscriptionPayload` — now imported from `./subscription.js`.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/routing.ts
git commit -m "refactor(runtime/routing): import subscription helpers from runtime/subscription.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 9: Update `runtime/usage.ts`

**Files:**
- Modify: `runtime/usage.ts`

- [ ] **Step 1: Add import from subscription.ts**

Add after the existing imports:

```ts
import {
  resolveNanoGptSubscriptionState,
  hasNanoGptFutureGracePeriod,
  resolveNanoGptSubscriptionActive,
} from "./subscription.js";
```

Also import `NanoGptSubscriptionPayload` if needed — it's already defined in `runtime/usage.ts` locally, but since we're importing from `runtime/subscription.ts`, we should use the exported type. Remove the local `NanoGptUsagePayload` definition and rename it in usage to match `NanoGptSubscriptionPayload` — or keep it local if it's a superset. Check: the `NanoGptUsagePayload` in `runtime/usage.ts` has `daily`, `monthly`, `limits`, `period` fields that `NanoGptSubscriptionPayload` doesn't have. So `NanoGptUsagePayload` stays local; just remove the three function duplicates.

- [ ] **Step 2: Remove local function definitions**

Delete from `runtime/usage.ts`:
- `resolveNanoGptSubscriptionState` function (lines 99-133)
- `hasNanoGptFutureGracePeriod` function (lines 135-138)
- `resolveNanoGptSubscriptionActive` function (lines 140-159)

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `npm test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add runtime/usage.ts
git commit -m "refactor(runtime/usage): import subscription helpers from runtime/subscription.ts

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 10: Fix `nanogpt-errors.ts` isRecord import

**Files:**
- Modify: `nanogpt-errors.ts`

- [ ] **Step 1: Add import from shared/guards**

Add after the existing imports (or in the imports section at top):

```ts
import { isRecord } from "./shared/guards.js";
```

- [ ] **Step 2: Remove local `isRecord` function definition (line 113)**

Delete the local `function isRecord(value: unknown): value is Record<string, unknown>` definition from `nanogpt-errors.ts`.

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 4: Run tests**

Run: `npm test -- --run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add nanogpt-errors.ts
git commit -m "refactor(nanogpt-errors): import isRecord from shared/guards.js

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 11: Final validation

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit final state**

```bash
git add -A
git commit -m "refactor: complete granular file split — extract markers, inspection, subscription helpers

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
