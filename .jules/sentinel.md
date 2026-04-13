## 2024-04-13 - [Sentinel] Enforced Web Search Input Length Validation
**Vulnerability:** The web search query in `web-search.ts` lacked length validation, making the application potentially vulnerable to DoS attacks via excessively long strings.
**Learning:** In external API proxy routes, inputs passed to downstream APIs must be strictly constrained to prevent resource exhaustion or upstream rejection failures.
**Prevention:** Apply strict length validation (e.g., `query.length <= 2000`) to all user-controlled inputs before processing them.
