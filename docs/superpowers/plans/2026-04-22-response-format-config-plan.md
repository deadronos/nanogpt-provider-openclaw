# Response Format Config — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `responseFormat` to `NanoGptPluginConfig` to control `response_format` injection into tool-enabled nano-gpt requests. Off by default.

**Architecture:** Add the type to `models.ts`, read it via `runtime/config.ts`, thread it through `index.ts` into `wrapNanoGptStreamFn` which guards the existing injection logic behind the config check. Support three modes: `false`, `"json_object"`, and `{ type: "json_schema", schema }`.

**Tech Stack:** TypeScript, vitest, existing `models.ts` / `runtime/config.ts` / `provider/stream-hooks.ts`

---

## File Map

| File                            | Change                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `models.ts`                     | Add `NanoGptResponseFormat` type and `responseFormat` to `NanoGptPluginConfig`              |
| `runtime/config.ts`             | Read `responseFormat` from plugin config                                                    |
| `index.ts`                      | Pass `resolvedConfig.responseFormat` to `wrapNanoGptStreamFn`                               |
| `provider/stream-hooks.ts`      | Accept `responseFormat` param; guard injection behind config check; support all three modes |
| `provider/stream-hooks.test.ts` | Add test for each config mode                                                               |
| `README.md`                     | Document new option                                                                         |

---

## Task 1: Add type to `models.ts`

**Files:**

- Modify: `models.ts` (after line 26)

- [ ] **Step 1: Add the type and update the interface**

Add after `NanoGptRepairConfig`:

```typescript
export type NanoGptResponseFormat =
  | false
  | "json_object"
  | { type: "json_schema"; schema?: Record<string, unknown> };
```

Add to `NanoGptPluginConfig` interface (line 33):

```typescript
responseFormat?: NanoGptResponseFormat;
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck 2>&1`
Expected: PASS (no new errors)

- [ ] **Step 3: Commit**

```bash
git add models.ts
git commit -m "feat: add NanoGptResponseFormat type and responseFormat config field"
```

---

## Task 2: Wire config through `runtime/config.ts`

**Files:**

- Modify: `runtime/config.ts` (after line 39)

- [ ] **Step 1: Add to the resolved config return**

In `getNanoGptConfig`, add after the `enableRepair` handling:

```typescript
responseFormat:
  candidate.responseFormat === false ||
  candidate.responseFormat === "json_object" ||
  (typeof candidate.responseFormat === "object" && candidate.responseFormat?.type === "json_schema")
    ? candidate.responseFormat
    : undefined,
```

- [ ] **Step 2: Verify typecheck**

Run: `npm run typecheck 2>&1`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add runtime/config.ts
git commit -m "feat: read responseFormat from plugin config"
```

---

## Task 3: Thread config through `index.ts` into `wrapNanoGptStreamFn`

**Files:**

- Modify: `index.ts` (around line 89)

- [ ] **Step 1: Pass `responseFormat` to `wrapNanoGptStreamFn`**

In the `wrapStreamFn` call (line 89), add `responseFormat`:

```typescript
wrapStreamFn: (ctx) => wrapNanoGptStreamFn(ctx, logger, resolvedNanoGptConfig.responseFormat),
```

- [ ] **Step 2: Update `wrapNanoGptStreamFn` signature to accept it**

In `provider/stream-hooks.ts`, update the function signature (around line 517):

```typescript
export function wrapNanoGptStreamFn(
  ctx: ProviderWrapStreamFnContext,
  logger?: NanoGptLogger,
  responseFormat?: NanoGptResponseFormat,
): NanoGptWrappedStreamFn {
```

- [ ] **Step 3: Verify typecheck**

Run: `npm run typecheck 2>&1`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add index.ts provider/stream-hooks.ts
git commit -m "feat: thread responseFormat config through to wrapStreamFn"
```

---

## Task 4: Guard injection behind config check in `wrapNanoGptStreamFn`

**Files:**

- Modify: `provider/stream-hooks.ts` (around lines 553-562)
- Modify: `provider/stream-hooks.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `provider/stream-hooks.test.ts`:

```typescript
it("injects json_object response_format when configured", async () => {
  const observedPayloads: unknown[] = [];
  const message = buildAssistantMessage({
    content: [{ type: "text", text: "ok" }],
    usageEmpty: false,
    stopReason: "stop",
  });
  const { wrapped } = createWrappedStream({
    message,
    onPayload: (payload) => observedPayloads.push(payload),
  });

  const wrappedWithConfig = wrapNanoGptStreamFn(
    {
      provider: "nanogpt",
      modelId: MODEL_ID,
      extraParams: {},
      model: { id: MODEL_ID, api: "openai-completions" },
      streamFn: createBareStreamFn(message, observedPayloads),
    } as any,
    { warn: vi.fn() },
    "json_object",
  );

  await wrappedWithConfig?.({} as any, { tools: [{ name: "read", parameters: {} }] } as any, {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(observedPayloads[0]).toMatchObject({
    response_format: { type: "json_object" },
  });
});

it("injects json_schema response_format with provided schema", async () => {
  const observedPayloads: unknown[] = [];
  const message = buildAssistantMessage({
    content: [{ type: "text", text: "ok" }],
    usageEmpty: false,
    stopReason: "stop",
  });
  const schema = { type: "object", properties: { path: { type: "string" } } };
  const wrappedWithConfig = wrapNanoGptStreamFn(
    {
      provider: "nanogpt",
      modelId: MODEL_ID,
      extraParams: {},
      model: { id: MODEL_ID, api: "openai-completions" },
      streamFn: createBareStreamFn(message, observedPayloads),
    } as any,
    { warn: vi.fn() },
    { type: "json_schema", schema },
  );

  await wrappedWithConfig?.({} as any, { tools: [{ name: "read", parameters: {} }] } as any, {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(observedPayloads[0]).toMatchObject({
    response_format: { type: "json_schema", json_schema: { schema } },
  });
});

it("does not inject response_format when configured as false", async () => {
  const observedPayloads: unknown[] = [];
  const message = buildAssistantMessage({
    content: [{ type: "text", text: "ok" }],
    usageEmpty: false,
    stopReason: "stop",
  });
  const wrappedWithConfig = wrapNanoGptStreamFn(
    {
      provider: "nanogpt",
      modelId: MODEL_ID,
      extraParams: {},
      model: { id: MODEL_ID, api: "openai-completions" },
      streamFn: createBareStreamFn(message, observedPayloads),
    } as any,
    { warn: vi.fn() },
    false,
  );

  await wrappedWithConfig?.({} as any, { tools: [{ name: "read", parameters: {} }] } as any, {});
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(observedPayloads[0]).not.toHaveProperty("response_format");
});
```

Note: `createBareStreamFn` should be a helper that creates a minimal stream fn (no `onPayload` capture). Extract this pattern from the existing `createWrappedStream` in the test file — or pass `observedPayloads` via closure similar to the existing tests.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- --run provider/stream-hooks.test.ts 2>&1 | grep -E "(PASS|FAIL|json_object|json_schema)"`
Expected: FAIL — config not yet wired in

- [ ] **Step 3: Implement the config guard**

In `provider/stream-hooks.ts`, update the injection block (around lines 553-562) from:

```typescript
// Inject response_format for tool-enabled requests to request structured JSON output.
const hasTools = requestToolMetadata.toolEnabled;
const basePayload = ensured.payload ?? upstreamPayload;
if (hasTools && !(basePayload as Record<string, unknown>).response_format) {
  return { ...(basePayload as Record<string, unknown>), response_format: { type: "json_object" } };
}
return basePayload;
```

To:

```typescript
if (responseFormat && hasTools) {
  const basePayload = ensured.payload ?? upstreamPayload;
  const existing = (basePayload as Record<string, unknown>).response_format;
  if (!existing) {
    if (responseFormat === "json_object") {
      return {
        ...(basePayload as Record<string, unknown>),
        response_format: { type: "json_object" },
      };
    }
    if (typeof responseFormat === "object" && responseFormat.type === "json_schema") {
      const schema = responseFormat.schema;
      return {
        ...(basePayload as Record<string, unknown>),
        response_format: schema
          ? { type: "json_schema", json_schema: { schema } }
          : { type: "json_schema" },
      };
    }
  }
}
return ensured.payload ?? upstreamPayload;
```

Also update the `ensureIncludeUsageInStreamingPayload` call — it must use `upstreamPayload` directly since we may not always be returning `basePayload`:

```typescript
const ensured = ensureIncludeUsageInStreamingPayload(upstreamPayload, shouldForceIncludeUsage);
if (ensured.requested) {
  requestedIncludeUsage = true;
}
```

Move the `const basePayload = ensured.payload ?? upstreamPayload;` inside the `if (responseFormat && hasTools)` block.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- --run provider/stream-hooks.test.ts 2>&1 | grep -E "(PASS|FAIL)"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add provider/stream-hooks.ts provider/stream-hooks.test.ts
git commit -m "feat: guard response_format injection behind config"
```

---

## Task 5: Update README

**Files:**

- Modify: `README.md` (around line 186, after the Options list)

- [ ] **Step 1: Add to the Options list**

In `README.md`, find the `### Options` section (around line 185) and add after the `provider` entry:

```typescript
responseFormat: false | "json_object" | { type: "json_schema"; schema?: Record<string, unknown> }
```

- `false` (default): no injection — nano-gpt receives native tool definitions as-is
- `"json_object"`: injects `response_format: { type: "json_object" }` for tool-enabled requests
- `{ type: "json_schema", schema }`: injects `response_format: { type: "json_schema", json_schema: { schema } }` — `schema` is optional and defaults to omitted

Also add a "Behavior notes" entry:

```
- `responseFormat` only applies to tool-enabled requests; non-tool requests are unaffected
- `responseFormat` is only injected when not already present in the payload
- Experimental: whether this improves tool-call reliability is unverified
```

- [ ] **Step 2: Verify markdown renders correctly**

Check the README renders the new option correctly.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document responseFormat config option"
```

---

## Self-Review Checklist

1. **Spec coverage:**
   - `NanoGptResponseFormat` type added to `models.ts` ✅
   - `responseFormat` read in `getNanoGptConfig` ✅
   - `responseFormat` threaded through `index.ts` to `wrapNanoGptStreamFn` ✅
   - All three modes (`false`, `"json_object"`, `{ type: "json_schema" }`) implemented ✅
   - README updated ✅
   - No placeholder gaps ✅

2. **Placeholder scan:** No `TODO`, `TBD`, or vague language found ✅

3. **Type consistency:**
   - `NanoGptResponseFormat` defined in `models.ts` ✅
   - Used in `runtime/config.ts` return type ✅
   - Used in `wrapNanoGptStreamFn` signature ✅
   - All match ✅

---

## Execution Options

**Plan complete and saved to `docs/superpowers/plans/2026-04-22-response-format-config-plan.md`.**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
