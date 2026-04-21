Investigate Qwen tool-call failure
No tasks in progress


<exec>du -sh /Users/openclaw/.openclaw/workspace-teleclaw /Users/openclaw/.openclaw/workspace-shared 2>&1</exec>

https://github.com/openclaw/openclaw/pull/64214

around that time it seems upstream openclaw had some mitigations for qwen as well - the example above is even with our own latest improvements to our repair attempts in our nanogpt plugin

interesting: the previous issues on qwen in openclaw said the model leaked text but still executed tools

our issue right now is the qwen model is that openclaw might not receiver the repaired tool calls and doesnt execute them and/or it still and only leaks into prose/text responses

please investigate
5:38 PM


Worked for 5m 11s
Yes. #62874 is probably the closer upstream match than #64214.

#62874 was opened on April 8, 2026 and reports that with local vLLM + Qwen under tool_choice: "auto", the response leaves tool_calls empty and sometimes puts the tool intent into content instead. Only tool_choice: "required" makes tool_calls populate. That is an execution-path failure, not just a display leak.
#64214, merged on April 10, 2026, is narrower: it strips leaked Qwen XML from visible assistant text, so users stop seeing raw <tool_call><function=...> output. It does not, by itself, turn leaked text into executable tool calls.
That lines up with what I found locally: this plugin already tries to salvage Qwen leaked text into synthetic toolCall blocks in repair.ts (line 1418) and wires that path for Qwen in index.ts (line 467). But we do not currently force tool_choice: "required" or otherwise patch the outbound request. If NanoGPT/Qwen behaves like the #62874 report, OpenClaw may still get no native tool call and our salvage has to guess from text.
One more useful comparison: the OpenClaw build installed in this repo still promotes only native response.message.tool_calls to executable tool blocks in stream-ii_pg4bj.js (line 364), while text cleanup lives separately in assistant-visible-text-Bu-2kS6O.js (line 237). So your hypothesis is credible: upstream can hide the leaked text without fixing execution.

I also checked the plugin tests: npm test -- repair.test.ts index.test.ts passes, but there is no explicit coverage yet for the exact tool_calls: [] plus content-only Qwen case from #62874. If you want, I can make that the next repro and patch target.





5:44 PM
yes try to do mitigation around those new findings and tests
5:46 PM


Worked for 5m 37s
Implemented a targeted Qwen mitigation without forcing global tool use.

In repair.ts (line 809) and repair.ts (line 1210), the wrapper now does two new things: it recognizes raw function-style leaked tool text like exec({"command":"pwd"}), and on the existing one-shot Qwen retry path it upgrades the retry to toolChoice: "required" only when the first tool-enabled turn was clearly broken and the original choice was unset or auto (repair.ts (line 1805)). That gives us a mitigation for the empty-tool_calls / content-only Qwen failure mode from #62874 without making every normal Qwen turn tool-forced. I also updated the behavior notes in README.md (line 203).

Regression coverage was added in repair.test.ts (line 750) for the new exec({...}) salvage path and for the Qwen retry now carrying toolChoice: "required" on the second attempt (repair.test.ts (line 804)).

Verified with npm test and npm run typecheck. I didn’t run npm run build because the shipped package surface didn’t change.





5:52 PM
3 files changed
+200
-1
Undo

Review
README.md
repair.test.ts
repair.ts
Model changed from GPT-5.4 to GPT-5.4-Mini.
please also make the qwen path trigger logs to openclaw when it detects and rewrites stuff
5:53 PM


Worked for 2m 18s
Qwen rewrites now emit structured OpenClaw info logs, not just silent salvage. The repair path logs when it salvages leaked assistant text into tool calls, sanitizes leaked Qwen text, rewrites a wrong stopReason, and forces the retry to toolChoice: "required" for the empty-tool_calls case. The core hooks are in repair.ts (line 580), repair.ts (line 1583), repair.ts (line 1743), and repair.ts (line 1852). I also noted the behavior in README.md (line 217).

The regression tests now assert those Qwen log events too, including salvage, sanitization, retry forcing, and stop-reason normalization in repair.test.ts (line 748), repair.test.ts (line 856), repair.test.ts (line 913), and repair.test.ts (line 1127). npm test and npm run typecheck both passed.

If you want, I can also add a tiny dedicated event name map so these Qwen rewrite logs are easier to grep in OpenClaw logs later.





5:56 PM
3 files changed
+76
-1
Undo

Review
README.md
repair.test.ts
repair.ts
yes make it surface with our plugin name "nanogpt" and "qwen" and do that event map
do the same logging improvement for our "kimi" and "glm" paths too please
5:59 PM



Worked for 4m 57s
Implemented the logging rollout for the repair layer. The structured reliability logger in repair.ts (line 594) now stamps every repair artifact with plugin: "nanogpt" and family, and it routes events through a small family map so the emitted names are prefixed like nanogpt_qwen_*, nanogpt_kimi_*, and nanogpt_glm_* (repair.ts (line 604), repair.ts (line 619)). That now covers the Qwen/Kimi salvage, sanitization, stop-reason rewrite, retry, malformed-tool-call, and GLM semantic-diagnostic paths (repair.ts (line 662), repair.ts (line 835), repair.ts (line 1632), repair.ts (line 1755), repair.ts (line 1869), repair.ts (line 2058)).

The tests now assert the new log shape across Kimi, Qwen, and GLM cases, including the plugin/family fields and the prefixed event names (repair.test.ts (line 261), repair.test.ts (line 642), repair.test.ts (line 773), repair.test.ts (line 1693), repair.test.ts (line 1850)). I also updated the README logging notes to match the new event naming and envelope (README.md (line 217), README.md (line 366)).

npm test and npm run typecheck both pass.





6:04 PM
3 files changed
+136
-56
Undo

Review
README.md
repair.test.ts
repair.ts




Full access

GPT-5.4-Mini

Extra High

IDE context


Work locally
