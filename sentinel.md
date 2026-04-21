## 2024-05-15 - [CRITICAL] Fix arbitrary environment variable exposure in Web Search Provider
**Vulnerability:** The `resolveNanoGptWebSearchApiKey` function in `web-search.ts` allowed the reading of arbitrary environment variables (e.g., `${AWS_SECRET_KEY}`) through the `apiKey` configuration.
**Learning:** The legacy `${ENV_VAR}` pattern matching allowed any uppercase environment variable to be evaluated. This breaks isolation and allows config-driven exfiltration of sensitive environment values that OpenClaw is otherwise meant to protect.
**Prevention:** Restrict the matched environment variable to exactly `NANOGPT_API_KEY`.
