# Qwen Tool Call Investigation - 2026-04-21

## Summary

NanoGPT's API already returns Qwen's tool calls as **properly structured `tool_calls`** in both streaming and non-streaming responses. The issue appears to be at the **OpenClaw parsing level**, not with NanoGPT or the repair code.

---

## Testing Methodology

Used a live NanoGPT API key to make direct curl requests and observe actual response formats from Qwen models.

### Models Tested

- `qwen/qwen3.5-9b` (Qwen 3.5 base)
- `qwen3-vl-235b-a22b-thinking` (Qwen 3 thinking model)

### Test Scenario

Prompt: "Read /tmp/test.txt and tell me what it says" (with `read` tool available)

---

## Findings

### 1. Non-Streaming Response: Correct Format

When the model was instructed to explain first, then call a tool, the non-streaming response was:

```json
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "I will use the `read` function to access the contents...",
        "reasoning": "Okay, the user wants me to read the file...",
        "tool_calls": [
          {
            "id": "call_588ba06c052c437ca34696",
            "type": "function",
            "function": {
              "name": "read",
              "arguments": " {\"path\": \"/tmp/test.txt\"}"
            }
          }
        ]
      },
      "finish_reason": "tool_calls"
    }
  ]
}
```

**Assessment**: ✅ Correct - both `content` and `tool_calls` present, `finish_reason` is `"tool_calls"`

### 2. Streaming Response: Correct Format

Streaming produced separate events for content and tool calls:

```
role: assistant
CONTENT: 'I will use the `read` function...'
TOOL_CALLS: [{'index': 0, 'id': 'call_fe74ff75d8e74e6a9e2fa8', 'type': 'function', 'function': {'arguments': ' {"path": "/tmp/test.txt"}', 'name': 'read'}}]
```

**Assessment**: ✅ Correct - content and tool calls delivered as separate delta events

### 3. Multi-Turn Conversation: Correct Format

```
Turn 1:
  Content: (empty)
  Tool calls: 1 - read: '{"path": "/tmp/test.txt"}'

Turn 2 (after tool result):
  Content: 'The file `/tmp/test.txt` contains...'
  Tool calls: 0
```

**Assessment**: ✅ Correct - model correctly transitions to text response after tool execution

---

## Potential Issues Identified

### Issue 1: Reasoning Field

Qwen thinking models include a separate `reasoning` field:

```json
{
  "reasoning": "Okay, the user wants me to read the file /tmp/test.txt...",
  "content": "I will use the `read` function...",
  "tool_calls": [...]
}
```

This is a separate field from `content`. OpenClaw's `buildAssistantMessage` may not properly handle models that output both `content` AND `tool_calls` simultaneously with a separate `reasoning` field.

### Issue 2: Content Before Tool Calls

When the model was instructed to "explain what you're going to do first, then do it", the response had:

- `content`: "I will use the read function..."
- `tool_calls`: structured tool call
- `finish_reason`: "tool_calls"

If OpenClaw processes `content` first and considers the turn "done", it may not properly process the subsequent `tool_calls`.

### Issue 3: XML-Style Tool Calls Not Observed

During testing, we did **not** observe Qwen outputting tool calls as:

- `<tool_call>...</tool_call>` XML tags
- `<invoke>...</invoke>` tags
- `<tools>...</tools>` tags

All observed responses were properly structured JSON in `tool_calls`.

However, issue #60601 from the OpenClaw repo describes cases where Qwen 2.5 Coder via llama.cpp outputs:

- `<tools>{"name": "read", "arguments": {...}}</tools>` (wrong wrapper tag)

This suggests the format may vary by:

- Model variant (Qwen 2.5 Coder vs Qwen 3)
- Backend (llama.cpp vs NanoGPT's API)

---

## API Documentation Notes

From [NanoGPT Chat Completions API Docs](https://docs.nano-gpt.com/api-reference/endpoint/chat-completion):

- Supports OpenAI-compatible function calling via `tools` and `tool_choice`
- `reasoning: {"exclude": true}` can strip the reasoning field from output
- Legacy endpoint `/v1legacy/chat/completions` uses `reasoning_content` field (for LiteLLM)
- `/v1thinking/chat/completions` puts full text in `delta.content` (for JanitorAI)

---

## Conclusions

1. **NanoGPT's API is not the problem** - it correctly parses and returns Qwen's tool calls as structured `tool_calls`

2. **The issue is at OpenClaw's parsing layer** - likely in how `buildAssistantMessage` handles responses that contain both `content` AND `tool_calls` with a separate `reasoning` field

3. **Repair code is likely unnecessary for Qwen 3 via NanoGPT** - since the API already returns correct structure

4. **Request rewriting may still be valuable** - as an alternative to response repair, rewriting tool-enabled requests into a strict JSON contract (like NanoProxy's object-bridge mode) could ensure consistent behavior across all model variants

---

## Recommendations

1. **Disable repair by default** (done via `enableRepair: false`) to pass raw NanoGPT responses through

2. **Investigate OpenClaw's message parsing** - specifically how it handles `tool_calls` when `content` is also present

3. **Consider `reasoning: {"exclude": true}`** - to simplify responses by removing the separate reasoning field

4. **Explore request rewriting** - instead of repairing responses, rewrite the initial request to use NanoGPT's structured output format

---

## Test Commands Used

```bash
# Non-streaming test
curl -X POST "https://nano-gpt.com/api/v1/chat/completions" \
  -H "Authorization: Bearer $NANOGPT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-vl-235b-a22b-thinking",
    "messages": [{"role": "user", "content": "Read /tmp/test.txt"}],
    "tools": [{"type": "function", "function": {"name": "read", "parameters": {"type": "object", "properties": {"path": {"type": "string"}}, "required": ["path"]}}}],
    "max_tokens": 500
  }'

# Streaming test
curl -X POST "https://nano-gpt.com/api/v1/chat/completions" \
  -H "Authorization: Bearer $NANOGPT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{...same as above..., "stream": true}'
```
