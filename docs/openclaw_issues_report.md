# OpenClaw GitHub Issues Report

## Related to NanoGPT, Billing Errors, Cron Issues, and Error States

**Report Date:** 2026-04-21  
**Compiled by:** Nova (Researcher Agent)  
**Sources:** OpenClaw GitHub Repository Issues

---

## Executive Summary

This report compiles open GitHub issues in the OpenClaw repository that relate to:

1. **Billing Error False Positives** — Misleading "API provider billing error" messages
2. **Cron Job Issues** — Multiple regressions and state inconsistencies
3. **Error State Handling** — Gateway hangs, stuck processes, timeout issues
4. **Qwen Tool Calling** — XML format parsing and display issues

---

## 1. Billing Error Issues (False Positives)

### Issue #13935 — Intermittent "API provider billing error" shown to user

**Status:** Open  
**Opened:** Feb 10, 2026  
**Affected Versions:** 2026.2.9+

**Problem:**

- Error message surfaces intermittently: "⚠️ API provider returned a billing error — your API key has run out of credits"
- No actual billing limits reached (confirmed ~90% Anthropic allowance remaining, $23+ Grok balance)
- When this error appears, the agent's actual response is sometimes swallowed/not delivered
- User must re-send message to get a reply
- **Not logged anywhere** — no trace in journalctl, session transcripts, or ~/.openclaw/logs/

**Suspected Cause:**

- Possibly transient Anthropic rate limiting (per-minute, not weekly allowance) being caught and displayed as billing error
- May relate to high context usage (100%) triggering compaction-related API calls

**Impact:** High — breaks message delivery, misleads users about actual API status

---

### Issue #13888 — Billing error false positive from x402 HTTP 402 responses

**Status:** Open  
**Opened:** Feb 10, 2026

**Problem:**

- The `/\b402\b/` pattern in `ERROR_PATTERNS.billing` matches any error text containing "402"
- x402 payment protocol uses HTTP 402 as part of normal payment flow
- When x402 MCP tool output includes "402", `isBillingErrorMessage()` returns true
- Entire assistant message gets replaced with billing error warning
- This is a **false positive** — the Anthropic API key is fine

**Root Cause:**

- Pattern matching is too broad — matches "402" in tool output, not just provider HTTP responses

**Suggested Fix:**

- Only match 402 when it comes from LLM provider's HTTP response
- Or remove `/\b402\b/` pattern entirely (other patterns like "payment required", "insufficient credits" cover actual billing errors)

**Workaround:** Users patching out the pattern with sed

---

### Issue #14680 — False positive billing error on messages containing '402' in text

**Status:** Open  
**Opened:** Feb 12, 2026

Similar to #13888 — billing error triggered by "402" appearing in assistant response text, not actual API errors.

---

### Issue #12022 — False positive billing error detection on assistant response text

**Status:** Open  
**Opened:** Feb 8, 2026

OpenClaw's error pattern matching in `pi-embedded-helpers` scans assistant response text for billing-related keywords and incorrectly flags legitimate responses.

---

### Issue #24622 — Gateway hangs indefinitely on model API billing error

**Status:** Open  
**Opened:** Feb 23, 2026  
**Affected Versions:** 2026.2.9

**Problem:**

- When model API key runs out of credits/quota, gateway **hangs indefinitely** instead of failing gracefully
- Process becomes unresponsive for hours
- Requires manual SIGTERM to restart
- "Non-fatal unhandled rejection" for `TypeError: fetch failed` leaves Node.js event loop blocked

**Timeline from Logs:**

- 13:13:12 — Typing indicator timeout
- 13:13-15:36 — Complete silence (2.5 hour hang)
- 14:53:23 — Non-fatal unhandled rejection logged
- 15:36+ — Gateway logging resumes but still unresponsive
- 16:13:58 — Manual SIGTERM sent

**Recommendation:**

- Implement proper timeout and error handling for model API calls
- Handle billing/quota errors specifically
- Use circuit breaker pattern for failing providers
- Return errors to user immediately rather than hanging

---

## 2. Cron Job Issues

### Issue #42883 — Cron jobs broken after update to 2026.3.8

**Status:** Open  
**Opened:** Mar 10, 2026  
**Affected Versions:** 2026.3.8

**Problem:**

- Cron jobs working until upgrade to 2026.3.8, then stopped running
- Manual `openclaw cron run --id <job_id>` accepted/enqueued but often didn't create visible run entry
- Job sometimes stayed idle with no run history
- Other times moved to "running" and later failed with `Error: cron: job execution timed out`
- Gateway lifecycle became unstable: `openclaw gateway stop` could unload LaunchAgent while leaving gateway process listening on port 18789
- Caused "gateway already running / port already in use" errors until manual cleanup

**Impact:** High — breaks scheduled automation entirely

---

### Issue #27427 — Isolated cron job always logs status: "error" (timeout) at 600s

**Status:** Open  
**Opened:** Feb 26, 2026  
**Affected Versions:** 2026.2.23

**Problem:**

- Isolated cron jobs running longer than 600 seconds are always logged as `status: "error"` with "cron: job execution timed out"
- Even when orchestrator session continues running, receives all sub-agent Push results, and completes successfully
- **600s threshold appears hardcoded** regardless of timeout configuration
- `agents.defaults.timeoutSeconds` and CLI `--timeout` flags have **no effect**

**Test Results:**
| Test | Timers | Timeout Config | Log Status | durationMs | DM Received |
|------|--------|--------------|------------|------------|-------------|
| 1 | 1min x3 | default | ok | 79s | ✅ |
| 2 | 1, 3, 5min | CLI --timeout 600 | ok | 326s | ✅ |
| 3 | 1, 5, 10min | CLI --timeout 1800 | error | 599s | ✅ |
| 4 | 1, 10, 15min | agents.defaults.timeoutSeconds: 1200 | error | 600s | ✅ |

**Pattern:** Jobs under 600s → `status: ok`. Jobs over 600s → `status: error`.

**Additional Issue:** Cron session history inaccessible — `sessions_history` returns "forbidden" error, making debugging impossible.

---

### Issue #49258 — Cron job state inconsistency: lastDelivered: true but lastRunStatus: error

**Status:** Open  
**Opened:** Mar 17, 2026  
**Affected Versions:** 2026.3.2

**Problem:**

- Cron job shows contradictory state:
  - `lastDelivered: true` (message sent successfully to Feishu)
  - `lastRunStatus: "error"` (marked as failed)
  - `consecutiveErrors: keeps incrementing` (4+ errors despite successful delivery)
- Causes false positive alerts and confusing monitoring dashboards

**Root Cause:**

- State update logic doesn't properly correlate delivery success with execution status
- When job successfully delivers output, `lastRunStatus` should reflect success

**Additional Bug:**

- Hardcoded error message: `throw new Error("telegram sendMessage failed: ...")`
- Should be parameterized for platform (Feishu, Discord, Telegram, etc.)

**Suggested Fix:**

```javascript
if (job.state.lastDelivered === true) {
  job.state.lastRunStatus = "ok";
  job.state.consecutiveErrors = 0;
}
```

---

### Issue #17554 — Cron job state.runningAtMs not cleared after successful completion

**Status:** Open  
**Opened:** Feb 15, 2026  
**Affected Versions:** 2026.2.13

**Problem:**

- Cron job completes successfully (`lastStatus: "ok"`) but retains stale `runningAtMs` timestamp
- `cron.run` (manual trigger) returns `{"ran": false, "reason": "already-running"}`
- Prevents job from being triggered again until manual removal from jobs.json

**Workaround:** Manually remove `runningAtMs` from `~/.openclaw/cron/jobs.json`

**Suggested Fix:** Add staleness check — if `runningAtMs` older than 2×`timeoutSeconds`, treat as stale

---

### Issue #28861 — Ineffective monitoring for failing cron jobs

**Status:** Open  
**Opened:** Feb 27, 2026  
**Affected Versions:** 2026.2.21

**Problem:**

- Cron jobs created via earlier OpenClaw versions store schedule as `"cron": "..."` in jobs.json
- Current scheduler expects `"expr": "..."`
- When computing next run time, throws: `TypeError: Cannot read properties of undefined (reading 'trim')`
- **Silently prevents all affected jobs from ever firing**
- Error stored in `state.lastError` but nothing alerts the user

**Additional Migration Issues:**

- `jobId` field (schema expects `id`)
- Missing `wakeMode`
- No active monitoring alerts when scheduler errors occur

**Suggested Fix:**
In `service/store.ts ensureLoaded()`, add migration:

```javascript
if (sched.cron is a string && sched.expr is missing) {
  sched.expr = sched.cron;
  delete sched.cron;
}
```

---

### Issue #30773 — Write tool reports error in isolated cron agentTurn jobs despite file being written

**Status:** Open  
**Opened:** Mar 1, 2026

In isolated `agentTurn` cron jobs, the write tool consistently reports failure (shown as `lastError` and `lastDeliveryError` in cron job state), but the file is actually written successfully.

---

### Issue #21775 — OpenClaw Built-in Cron Scheduler Fails to Execute Jobs

**Status:** Open  
**Opened:** Feb 20, 2026

Daily schedules registered but never execute. Related to schedule parsing and state management issues.

---

## 3. Error State / Gateway Issues

### Issue #28576 — OpenClaw keeps hanging

**Status:** Open  
**Opened:** Feb 27, 2026  
**Affected Versions:** 2026.2.9

Agent hangs but `openclaw --status` shows it's running okay. Process appears healthy but unresponsive to new requests.

---

### Issue #55451 — Surface raw provider errors in UI/logs when OpenClaw rewrites them

**Status:** Open  
**Opened:** Mar 26, 2026

When provider error occurs, OpenClaw preserves raw provider message in session transcript but shows less useful message to user. Makes debugging difficult.

---

## 4. Qwen Tool Calling Issues

### Issue #63999 — Qwen model raw tool call XML leaks into visible chat messages

**Status:** Open  
**Opened:** Apr 10, 2026  
**Affected Versions:** 2026.4.5 / 2026.4.8

**Problem:**

- Using Qwen 3.5 via MLX VLM server (`openai-completions` API)
- Raw `<tool_call><function=read><parameter=path>...</parameter></function></tool_call>` XML visible in Web UI and Signal
- Tools execute correctly (badges show "2 tools read", "1 tool exec") but XML text not stripped from rendered message
- `stripToolCallXmlTags` sanitizer exists but not applied in chat rendering path

**Impact:** Medium — functional but poor UX with raw XML cluttering chat

---

### Issue #45000 — Tool call XML leak to chat with local Ollama setup

**Status:** Open  
**Opened:** Mar 13, 2026  
**Affected Versions:** 2026.3.8

Same XML leak issue with Qwen3.5-35B-A3B via Ollama native API. Raw XML visible in chat messages alongside final answer.

---

### PR #44959 — Support Qwen-style embedded tool calls in Ollama provider

**Status:** Merged (partial fix)

**Changes:**

- Added `parseQwenEmbeddedToolCalls()` in `pi-embedded-utils.ts` to parse XML format
- Updated `buildAssistantMessage()` in `ollama-stream.ts` to promote embedded tool calls to proper `toolCall` content blocks when native `tool_calls` is empty
- Handles detection but chat text stripping still has gaps

---

### Issue #46679 — Ollama native API: tool_calls arguments sent as JSON string breaks multi-turn tool calling

**Status:** Open  
**Opened:** Mar 14, 2026

**Problem:**

- Ollama native API (`/api/chat`) sends `tool_calls[].function.arguments` as **JSON string** (e.g., `"{\"command\":\"ls\"}"`) instead of parsed object
- Ollama expects object — subsequent turns fail with: `Value looks like object, but can't find closing '}' symbol`
- Model degrades into emitting fake XML tool calls instead of native tool calls

**Suggested Fix:**

```javascript
arguments: typeof functionCall.arguments === "string"
  ? JSON.parse(functionCall.arguments)
  : functionCall.arguments;
```

**Affected Files:** `dist/model-selection-*.js` and `dist/reply-*.js` (both streaming and non-streaming paths)

---

### Issue #32916 — 2026.3.2 + Llama.cpp with Qwen3.5-A35-A3B

**Status:** Open  
**Opened:** Mar 3, 2026

Similar issues reported with llama.cpp backend using Qwen 3.5.

---

## 5. NanoGPT-Specific Issues

### Reddit Discussion — Nano-GPT with OpenClaw error

**Date:** Mar 26, 2026

Users report model not found errors when using NanoGPT config. Configuration issues with API endpoint.

---

### Reddit Discussion — Nano-gpt and API rate exceeded errors

**Date:** Feb 27, 2026

Users hitting rate limit errors with NanoGPT provider.

---

### GitHub Actions History — feat: Add nano-gpt.com as a provider

Multiple PRs (#5584, #9386, #4252, #816) indicate ongoing work to add NanoGPT as a first-class provider.

---

## Summary Table

| Issue # | Category    | Title                                              | Status | Severity |
| ------- | ----------- | -------------------------------------------------- | ------ | -------- |
| #13935  | Billing     | Intermittent "billing error" — swallows response   | Open   | High     |
| #13888  | Billing     | False positive from x402 HTTP 402                  | Open   | Medium   |
| #14680  | Billing     | False positive on '402' in text                    | Open   | Medium   |
| #12022  | Billing     | False positive detection on response text          | Open   | Medium   |
| #24622  | Error State | Gateway hangs on billing error                     | Open   | High     |
| #42883  | Cron        | Cron jobs broken after 2026.3.8                    | Open   | High     |
| #27427  | Cron        | Timeout at 600s (hardcoded)                        | Open   | High     |
| #49258  | Cron        | State inconsistency lastDelivered vs lastRunStatus | Open   | Medium   |
| #17554  | Cron        | runningAtMs not cleared                            | Open   | Medium   |
| #28861  | Cron        | Silent failure on schedule migration               | Open   | Medium   |
| #30773  | Cron        | Write tool reports false error                     | Open   | Low      |
| #21775  | Cron        | Scheduler fails to execute jobs                    | Open   | Medium   |
| #63999  | Qwen Tool   | XML leaks into chat (MLX VLM)                      | Open   | Medium   |
| #45000  | Qwen Tool   | XML leaks into chat (Ollama)                       | Open   | Medium   |
| #46679  | Qwen Tool   | JSON string args break multi-turn                  | Open   | High     |
| #32916  | Qwen Tool   | Llama.cpp + Qwen3.5 issues                         | Open   | Medium   |
| #28576  | Gateway     | OpenClaw keeps hanging                             | Open   | High     |
| #55451  | Gateway     | Raw provider errors not surfaced                   | Open   | Low      |

---

## Recommendations

### Immediate Actions (High Priority)

1. **Fix billing error false positives** — Narrow pattern matching for "402" to only provider HTTP responses
2. **Fix gateway hang on billing errors** — Implement proper timeout and circuit breaker patterns
3. **Fix cron 600s hardcoded timeout** — Respect `agents.defaults.timeoutSeconds` and CLI flags
4. **Fix cron state.runningAtMs cleanup** — Ensure cleared on completion, add staleness check

### Medium Priority

5. **Fix Qwen XML leak** — Apply `stripToolCallXmlTags` sanitizer in chat rendering path
6. **Fix Ollama JSON string args** — Parse string arguments to objects before sending to Ollama
7. **Fix cron schedule migration** — Auto-migrate `"cron"` to `"expr"` in jobs.json
8. **Fix cron state inconsistency** — Correlate delivery success with execution status

### Low Priority / Nice to Have

9. **Surface raw provider errors** — Show original error messages in UI/logs for debugging
10. **Document NanoGPT configuration** — Clear setup guide for NanoGPT provider

---

_End of Report_
