# Model Metadata Debugging Method

**Date:** 2026-04-13  
**Scope:** Reusable method for debugging cases where provider model discovery succeeds, but `openclaw models list --json` shows flattened metadata such as identical context windows, text-only input, or missing token limits

---

## Why this exists

This note captures the debugging method used after NanoGPT dynamic discovery was already fixed, but the user-facing command:

- `openclaw models list --all --json --provider nanogpt`

still appeared wrong.

The specific symptoms were:

- all models appeared to have the same `contextWindow`
- all models looked text-only
- `maxTokens` was missing from the JSON rows

At first glance this looked like a broken model-catalog mapping. It turned out to be a more specific pipeline bug in the **dynamic-model fallback path** used by the list command.

---

## The core idea

When a list or picker surface looks flattened, do **not** assume the provider catalog itself is bad.

Instead, ask:

> Is the metadata wrong at the source, or only wrong in the final presentation path?

For model metadata bugs, split the system into these layers:

1. **Provider API payload**
2. **Plugin model-definition mapping**
3. **Generated `models.json` provider config**
4. **Raw discovered model registry**
5. **Dynamic-model fallback path**
6. **List/picker row formatting**

The fix depends entirely on which layer first loses fidelity.

---

## The debugging method

### 1. Reproduce the exact user-facing command

Start with the exact command the user runs, not a nearby approximation.

Example:

```bash
openclaw models list --all --json --provider nanogpt
```

Important details:

- capture both stdout and stderr
- strip ANSI color codes before parsing
- many OpenClaw CLI commands prepend log lines before the JSON payload
- do not assume stdout is pure JSON from byte 0

A useful parsing approach is:

- remove ANSI escapes
- skip non-JSON prefix lines
- parse the first actual JSON object/array

This matters because a command may appear “broken” when the parser is simply choking on a log prefix like:

- `[agents] synced openai-codex credentials from external cli`

### 2. Verify whether the JSON is truly flattened

Once parsed, measure the shape instead of relying on a few eyeballed rows.

Useful checks:

- total item count
- number of distinct `contextWindow` values
- number of models whose `input` includes image (or `text+image` in summary form)
- sample entries for likely multimodal or high-context families

For NanoGPT, the bad state looked like:

- 607 models
- exactly 1 distinct `contextWindow`
- 0 multimodal models
- text-only rows

That confirmed the flattening was systematic, not cosmetic.

### 3. Inspect the generated `models.json`

The next step is to inspect the provider data OpenClaw generated for runtime use:

- `<agentDir>/models.json`

This is critical because `models.json` is often richer than the final CLI/list rows.

For NanoGPT, `models.json` showed:

- many distinct context windows
- many multimodal models
- realistic `maxTokens`
- correct reasoning/tool metadata

That immediately ruled out:

- upstream API failure
- provider payload parsing failure
- plugin model-definition mapping failure
- provider catalog generation failure

So the bug had to be **after** `models.json` generation.

### 4. Inspect the raw discovered registry

Next, inspect the raw discovered model registry used by OpenClaw before final row formatting.

Ask:

- does the raw registry contain provider models at all?
- if it does, is the metadata rich or already flattened?

In this NanoGPT investigation, the raw registry path was illuminating:

- the raw registry did **not** expose NanoGPT entries directly in the list-command path

That meant the list command was not reading rich NanoGPT models directly from the discovered registry.

This is the key pivot point.

### 5. Check whether the list command is falling back to dynamic-model resolution

If the raw registry does not directly expose the provider’s models, OpenClaw may still build list rows by taking catalog entries and re-resolving them through:

- `resolveModelWithRegistry(...)`
- plugin `resolveDynamicModel(...)`
- plugin `normalizeResolvedModel(...)`

This is where a provider can accidentally lose metadata fidelity.

For NanoGPT, that is exactly what happened.

OpenClaw’s list path was resolving NanoGPT rows through a dynamic-model fallback path where:

- `providerConfig.models` was empty
- `agentDir` was sometimes not passed into the hook context

Without those, the plugin’s dynamic resolver only had generic defaults available, so it produced rows like:

- `input: ["text"]`
- `contextWindow: 200000`
- `maxTokens: 32768`

which then surfaced as flattened list output.

### 6. Distinguish row-summary JSON from raw provider metadata

Another subtlety: `openclaw models list --json` does **not** emit the raw provider model-definition objects.

It emits row-oriented summary objects.

That means:

- `input` may be summarized as a display string like `text` or `text+image`
- `maxTokens` may be absent even when the underlying model has it
- some provider metadata is intentionally condensed for the listing surface

So always distinguish between:

- **raw provider config / models.json fidelity**, and
- **row-summary JSON fidelity**

The command can be correct as a summary surface while still omitting raw fields by design.

The real bug is when it collapses values that should remain distinguishable.

### 7. Rehydrate the fallback path from the rich snapshot

Once the failure was localized, the fix was not to change the provider API mapping.

The fix was to teach the fallback runtime path to reuse the rich `models.json` snapshot when:

- OpenClaw resolves a NanoGPT model dynamically
- `providerConfig.models` is unavailable or empty
- `agentDir` is missing from the hook context

The practical strategy was:

- parse `models.json`
- cache a provider-specific snapshot
- use it to rehydrate:
  - `input`
  - `contextWindow`
  - `maxTokens`
  - `reasoning`
  - `cost`
  - `compat`
- fall back to environment/default agent-dir resolution if `agentDir` is not passed

That turns a generic fallback model into the real provider-specific model again.

---

## Useful heuristics

### Heuristic 1: If `models.json` is rich, the provider catalog is probably fine

Do not keep debugging the upstream provider payload if `models.json` already contains the correct metadata.

### Heuristic 2: If the raw registry is empty for the provider, inspect dynamic fallback immediately

That usually means the list surface is being reconstructed indirectly.

### Heuristic 3: Missing `agentDir` is a silent metadata killer

Provider hooks that depend on generated files like `models.json` may silently degrade if the caller omits `agentDir`.

If the metadata looks suspiciously default-shaped, inspect whether the hook has enough context to find the generated files.

### Heuristic 4: Identical large-scale values are usually a fallback signature

If hundreds of models all show the same values, such as:

- `contextWindow = 200000`
- `input = text`

that is a strong sign you are seeing a fallback/default path, not real provider metadata.

### Heuristic 5: A passing provider hook test is still not enough

A provider can be correct in:

- discovery
- catalog generation
- `models.json`

and still be wrong in:

- row-building
- runtime re-resolution
- summary formatting

Always test the actual user-facing command.

---

## Practical sandbox pattern

For safe debugging, use an isolated state dir:

```bash
export OPENCLAW_STATE_DIR="$(mktemp -d /tmp/openclaw-provider-debug.XXXXXX)"
export OPENCLAW_AGENT_DIR="$OPENCLAW_STATE_DIR/agents/default/agent"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
```

Then:

1. source your provider API key from a local `.env`
2. `npm pack`
3. `openclaw plugins install <tgz>`
4. write a minimal config enabling/trusting the plugin
5. run the exact `models list` command
6. inspect both:
   - the parsed CLI JSON
   - `models.json`

This isolates the command behavior from the user’s live config and installed plugins.

---

## What this method found for NanoGPT

Using this method, the sequence was:

1. `openclaw models list --json` looked flattened.
2. The generated NanoGPT `models.json` was rich and correct.
3. The raw discovered registry did not surface NanoGPT models directly in the relevant path.
4. OpenClaw re-resolved the rows through NanoGPT’s dynamic-model fallback path.
5. That fallback path lacked `providerConfig.models` and sometimes `agentDir`.
6. The plugin therefore used generic defaults instead of rich provider metadata.
7. The fix was to rehydrate that fallback path from the generated `models.json` snapshot.

---

## Future checklist

When a provider list/picker surface looks flattened, follow this order:

- [ ] Reproduce the exact user-facing command.
- [ ] Parse the real JSON payload after stripping logs/ANSI.
- [ ] Measure distinct metadata values instead of eyeballing.
- [ ] Inspect the provider section inside generated `models.json`.
- [ ] Inspect the raw discovered model registry.
- [ ] Check whether OpenClaw is falling back to `resolveDynamicModel()`.
- [ ] Verify whether the hook has `providerConfig.models` and `agentDir`.
- [ ] Rehydrate the fallback path from generated provider metadata if needed.
- [ ] Add a regression for the missing-context path.

---

## Recommendation

For metadata bugs, ask this before changing any API mapping code:

> Are we looking at the real provider metadata, or at a default-shaped fallback object built later in the runtime pipeline?

That question saved a lot of time here.
