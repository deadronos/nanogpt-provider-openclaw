## 2025-02-20 - [Redact Sensitive Data In Log Meta Output]
**Vulnerability:** The logger `provider/nanogpt-logger.ts` was serializing the raw `meta` object using `JSON.stringify(meta)` without redacting sensitive information like `apiKey`, `secret`, `token`, `password`, and `authorization` keys.
**Learning:** Raw logger implementations should always use a JSON replacer to intercept object key serialization in order to filter/redact sensitive metadata (e.g. passwords, API keys) which may inadvertently be passed into logs, thus polluting logs with secrets.
**Prevention:** Implement a replacer function for `JSON.stringify` that checks keys via regex and redacts sensitive data with `[REDACTED]`.
