# NanoGPT Responses And Web Search Implementation Plan

> Status note: this plan has been executed in the current branch. The codebase
> now includes Responses transport support and a NanoGPT web-search provider.
> The remaining implementation gap is subscription quota accounting, which was
> intentionally out of scope for the first pass.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add opt-in NanoGPT Responses API support and a NanoGPT-backed OpenClaw web search provider without regressing the current chat-completions provider behavior.

**Architecture:** Keep the existing NanoGPT provider registration and routing logic, but extend plugin config so the model provider can return either `openai-completions` or `openai-responses`. Add a separate plugin-owned web search provider that maps OpenClaw's `web_search` tool contract onto NanoGPT's direct `POST /api/web` endpoint and normalizes the result payload.

**Tech Stack:** TypeScript, Vitest, OpenClaw plugin SDK, NanoGPT HTTP APIs

---

### Task 1: Add Responses-transport coverage

**Files:**
- Modify: `provider-catalog.test.ts`
- Modify: `runtime.test.ts`
- Modify: `models.ts`
- Modify: `runtime.ts`
- Modify: `provider-catalog.ts`

- [ ] **Step 1: Write the failing provider-catalog test for Responses transport**

Add a test in `provider-catalog.test.ts` that expects a NanoGPT provider built with plugin config `{ requestApi: "responses" }` to return `api: "openai-responses"` while keeping the same base URL and model list.

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npm test -- provider-catalog.test.ts`
Expected: FAIL because `requestApi` is not recognized and the provider still returns `openai-completions`.

- [ ] **Step 3: Add config parsing for `requestApi`**

Extend `NanoGptPluginConfig` and `getNanoGptConfig(...)` to support:

```ts
requestApi?: "completions" | "responses" | "auto";
```

For now, resolve `"auto"` to `"completions"` so the current behavior stays the default.

- [ ] **Step 4: Add runtime helper for request transport selection**

Add a helper in `runtime.ts` like:

```ts
export function resolveNanoGptRequestApi(
  config: NanoGptPluginConfig,
): "openai-completions" | "openai-responses" {
  return config.requestApi === "responses" ? "openai-responses" : "openai-completions";
}
```

- [ ] **Step 5: Update provider catalog construction**

Use the new helper in `provider-catalog.ts` so the returned provider config sets:

```ts
api: resolveNanoGptRequestApi(config)
```

- [ ] **Step 6: Add unit coverage for config parsing**

Extend `runtime.test.ts` with a config-normalization test that proves `requestApi` is parsed and preserved.

- [ ] **Step 7: Re-run the targeted tests**

Run: `npm test -- runtime.test.ts provider-catalog.test.ts`
Expected: PASS

### Task 2: Register a NanoGPT web search provider

**Files:**
- Create: `web-search.ts`
- Create: `web-search.test.ts`
- Modify: `index.ts`
- Modify: `api.ts`
- Modify: `openclaw.plugin.json`
- Modify: `package.json`

- [ ] **Step 1: Write the failing web-search provider tests**

Create `web-search.test.ts` with tests for:

- provider metadata shape
- missing API key behavior
- successful result normalization from NanoGPT `/api/web`
- mapping of `includeDomains` and `excludeDomains`

- [ ] **Step 2: Run the targeted test to verify it fails**

Run: `npm test -- web-search.test.ts`
Expected: FAIL because `web-search.ts` does not exist yet.

- [ ] **Step 3: Implement `web-search.ts`**

Create a NanoGPT web search provider using `openclaw/plugin-sdk/provider-web-search`.

Core behavior:

- provider id: `nanogpt`
- credential path: `plugins.entries.nanogpt.config.webSearch.apiKey`
- env var fallback: `NANOGPT_API_KEY`
- endpoint: `POST https://nano-gpt.com/api/web`
- request body:

```ts
{
  query,
  provider: "linkup",
  depth: "standard",
  outputType: "searchResults",
  ...(includeDomains?.length ? { includeDomains } : {}),
  ...(excludeDomains?.length ? { excludeDomains } : {}),
}
```

Normalize returned `data[]` into OpenClaw-style results:

```ts
{
  title,
  url,
  description,
  siteName,
}
```

- [ ] **Step 4: Register the provider in `index.ts`**

Add:

```ts
api.registerWebSearchProvider(createNanoGptWebSearchProvider());
```

- [ ] **Step 5: Expose the provider through manifest and API exports**

Update:

- `openclaw.plugin.json` to include `"webSearchProviders": ["nanogpt"]`
- `api.ts` to export `createNanoGptWebSearchProvider`

- [ ] **Step 6: Update package publish surface**

Add `web-search.ts` to the published `files` array in `package.json`.

- [ ] **Step 7: Re-run the targeted tests**

Run: `npm test -- web-search.test.ts index.test.ts`
Expected: PASS

### Task 3: Add registration coverage

**Files:**
- Modify: `index.test.ts`

- [ ] **Step 1: Write a registration test for the web search provider**

Extend `index.test.ts` to capture plugin registration calls and assert that the NanoGPT plugin now registers:

- one model provider
- one web search provider

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- index.test.ts`
Expected: FAIL until the test harness and registration assertions are updated.

- [ ] **Step 3: Implement the minimal test harness updates**

Update `index.test.ts` to call `plugin.register(...)` with a fake API object that records `registerProvider` and `registerWebSearchProvider`.

- [ ] **Step 4: Re-run the test**

Run: `npm test -- index.test.ts`
Expected: PASS

### Task 4: Verify the branch end-to-end

**Files:**
- Modify: `README.md` if needed

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 2: Run typechecking**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Update docs only if the implemented config surface changed**

If `requestApi` or `webSearch` config needs documentation, update `README.md` with exact config examples.

- [ ] **Step 4: Re-run verification after docs-affecting code changes**

Run: `npm test && npm run typecheck`
Expected: PASS
