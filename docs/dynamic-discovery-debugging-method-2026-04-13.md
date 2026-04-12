# Dynamic Discovery Debugging Method

**Date:** 2026-04-13  
**Scope:** Reusable method for debugging provider plugins when dynamic model discovery appears to work internally but models do not show up in OpenClaw's user-facing catalog or picker

---

## Why this exists

This note captures the debugging method used to fix NanoGPT dynamic discovery being dropped between:

- plugin/provider discovery
- OpenClaw implicit provider resolution
- generated `models.json`
- final `loadModelCatalog()` / model picker surfaces

The exact bug will vary by provider, but the **method** is useful any time a plugin seems to discover models correctly while OpenClaw still shows:

- fallback models only
- `configured (not in catalog)`
- zero models for the provider
- models in one internal surface but not another

---

## The core idea

Do **not** treat “model discovery is broken” as a single bug.

Split it into a pipeline and prove each boundary separately:

1. **External API truth** — does the upstream provider really return the models?
2. **Plugin catalog hook** — does the plugin build the provider config with dynamic models?
3. **Installed plugin path** — does the packaged/installed plugin expose discovery metadata correctly?
4. **Implicit provider resolution** — does OpenClaw materialize the provider during startup/catalog generation?
5. **Generated models file** — are the models written into OpenClaw’s generated `models.json`?
6. **Final catalog surface** — does `loadModelCatalog()` / `openclaw models list` actually expose those models to users?

If you skip one of these boundaries, it is easy to “fix” the wrong layer.

---

## Step-by-step method

### 1. Prove the upstream API first

Before touching plugin code, verify the provider actually returns the expected catalog and that the model IDs are real.

For NanoGPT, that meant validating:

- `GET /api/v1/models?detailed=true`
- `GET /api/subscription/v1/models?detailed=true`
- direct inference against the reported model IDs

This avoids chasing a plugin bug when the real problem is:

- wrong account tier
- hidden/paid models
- endpoint mismatch
- stale assumptions about model IDs

### 2. Compare the plugin contract to OpenClaw’s contract

Read the plugin against the local OpenClaw source, especially:

- provider discovery / catalog hooks
- plugin manifest fields
- final model catalog augmentation hooks
- model picker behavior

For this NanoGPT issue, the key OpenClaw seams were:

- `providerDiscoveryEntry` / discovery runtime
- provider `catalog.run(...)`
- generated `models.json`
- `augmentModelCatalog(...)`
- `loadModelCatalog()`

The important lesson: **a plugin can successfully build provider config while still failing to surface models in the final picker/catalog.**

### 3. Add a narrow provider-hook regression first

Before building a full smoke test, add the smallest regression that exercises the provider catalog hook through OpenClaw’s discovery path.

Goal:

- prove the plugin returns real discovered models
- prove it does not fall back unexpectedly
- keep the test cheap and diagnostic

For NanoGPT, this caught the installed/discovery boundary separately from the final catalog boundary.

### 4. Test the packaged install path, not just the workspace path

If the bug is about discovery inside OpenClaw, **test the installed plugin**.

Use an isolated temp state dir so the real setup is untouched.

Useful environment knobs:

- `OPENCLAW_STATE_DIR`
- `OPENCLAW_AGENT_DIR`
- `OPENCLAW_CONFIG_PATH`

Recommended install flow:

1. create a temp state dir
2. `npm pack`
3. `openclaw plugins install <tgz>` into the temp state dir
4. write a minimal temp OpenClaw config that explicitly trusts/enables the plugin

Why `npm pack` instead of installing the checkout directly:

- it exercises the real package contents
- it catches missing `files` entries
- it avoids false positives from workspace-only paths
- it avoids symlink/safety-scan issues from linked dev dependencies

### 5. Inspect both `models.json` and the final catalog

This is the most important “don’t stop too early” step.

You need to inspect **both**:

- the generated provider data in `models.json`
- the final user-facing catalog returned by `loadModelCatalog()` / `openclaw models list`

Why:

- models can exist in `models.json` but still be missing from the final catalog
- this means the provider-discovery stage worked, but the last surfacing step failed

That exact pattern happened here:

- NanoGPT models were present in generated `models.json`
- but `openclaw models list --provider nanogpt` still showed zero models

That immediately localizes the bug to the **final catalog augmentation / picker exposure layer**, not raw discovery.

### 6. If the CLI disagrees with internals, trust the user-facing discrepancy

A provider hook passing is good.
A generated `models.json` being populated is also good.

But if the actual CLI or picker still shows no models, the bug is **not fixed yet**.

The debugging mindset should be:

- internal success is evidence
- user-facing success is the acceptance test

### 7. Fix the last missing boundary, then re-run the packaged smoke test

In this case, the final missing step was to re-surface NanoGPT’s discovered models back into the final catalog via plugin-owned augmentation.

The fix was not “change upstream OpenClaw”.
It was to make the plugin participate correctly in the catalog pipeline.

After that, re-run the full packaged smoke test and verify:

- installed plugin path
- CLI listing
- `loadModelCatalog()` output
- model count
- sample IDs
- whether the result is fallback-only or truly dynamic

---

## Practical command pattern

### Safe sandbox pattern

Use a fresh sandbox so debugging does not touch the real OpenClaw install:

```bash
export OPENCLAW_STATE_DIR="$(mktemp -d /tmp/openclaw-provider-debug.XXXXXX)"
export OPENCLAW_AGENT_DIR="$OPENCLAW_STATE_DIR/agents/default/agent"
export OPENCLAW_CONFIG_PATH="$OPENCLAW_STATE_DIR/openclaw.json"
```

### Real install path pattern

```bash
npm pack --pack-destination "$OPENCLAW_STATE_DIR"
openclaw plugins install "$OPENCLAW_STATE_DIR/<package>.tgz" --force
```

### Minimal plugin-enable config pattern

```json
{
  "plugins": {
    "allow": ["nanogpt"],
    "entries": {
      "nanogpt": {
        "enabled": true,
        "config": {
          "routingMode": "auto",
          "catalogSource": "auto"
        }
      }
    }
  }
}
```

### Full catalog probe pattern

If CLI output is noisy or mixed with logs, probe the model catalog directly:

- load config from the temp config path
- call `loadModelCatalog({ config, useCache: false })`
- filter `provider === "nanogpt"`
- inspect counts and sample IDs
- compare against known fallback IDs

---

## Heuristics that helped in this case

### Heuristic 1: If the provider hook returns zero models, suspect auth first

NanoGPT’s `provider-discovery.ts` returns `null` when `ctx.resolveProviderApiKey("nanogpt").apiKey` is missing.

So:

- zero provider result often means auth/config/env resolution failed
- not necessarily that upstream discovery or response parsing failed

### Heuristic 2: If `models.json` has models but the CLI does not, suspect final catalog augmentation

That pattern usually means:

- discovery succeeded
- persistence succeeded
- user-facing surfacing failed

### Heuristic 3: A clean provider-hook test is necessary but not sufficient

A provider hook can be correct while the actual user experience is still broken.

### Heuristic 4: Always inspect the installed package contents

Check that the installed package actually contains:

- manifest metadata
- discovery entry files
- any newly added files listed in `package.json` `files`

Otherwise a workspace-only fix may never reach users.

---

## What this method found for NanoGPT

Using the method above, the real sequence was:

1. NanoGPT upstream APIs returned the expected models.
2. The plugin’s provider discovery hook could return dynamic models.
3. The installed package needed correct discovery metadata/file exposure.
4. OpenClaw generated `models.json` with NanoGPT models.
5. The final user-facing catalog still dropped them.
6. The plugin needed a final catalog augmentation step to re-surface those models as `nanogpt/...` entries.

That distinction was the key. Without checking both `models.json` and `loadModelCatalog()`, it would have been easy to stop too early and think the problem was solved.

---

## Future checklist

When dynamic discovery looks broken, follow this order:

- [ ] Verify the upstream API returns the expected models.
- [ ] Verify the plugin’s provider/catalog hook returns dynamic models.
- [ ] Verify the installed package contains the new discovery files/manifest fields.
- [ ] Verify OpenClaw implicit provider resolution includes the plugin.
- [ ] Inspect generated `models.json` for the provider.
- [ ] Inspect `loadModelCatalog()` / CLI model listing.
- [ ] Compare the final result against the fallback model set.
- [ ] Add one narrow regression and one installed-path smoke test.

---

## Recommendation

For future provider-plugin work, treat discovery bugs as **pipeline bugs** until proven otherwise.

Debugging gets much faster once you explicitly ask:

> At which exact boundary do the models disappear?

That question turned this from a vague “autodiscovery broken” issue into a concrete, fixable sequence.
