## 2025-02-20 - [Redact Sensitive Data In Log Meta Output]
**Vulnerability:** The logger `provider/nanogpt-logger.ts` was serializing the raw `meta` object using `JSON.stringify(meta)` without redacting sensitive information like `apiKey`, `secret`, `token`, `password`, and `authorization` keys.
**Learning:** Raw logger implementations should always use a JSON replacer to intercept object key serialization in order to filter/redact sensitive metadata (e.g. passwords, API keys) which may inadvertently be passed into logs, thus polluting logs with secrets.
**Prevention:** Implement a replacer function for `JSON.stringify` that checks keys via regex and redacts sensitive data with `[REDACTED]`.
## 2026-05-15 - Environment Variable Exfiltration Bypass
**Vulnerability:** Partial match bypass in environment variable reference validation allowed exfiltration.
**Learning:** The previous `ANY_BRACED_ENV_REF_PATTERN` and `ANY_UNBRACED_ENV_REF_PATTERN` regexes used `^` and `$` anchors, which only matched strings that were *entirely* environment variable references (like `${SECRET}`). This allowed references embedded within larger strings (like `prefix${SECRET}suffix`) to bypass the check and potentially exfiltrate sensitive data.
**Prevention:** Validation regexes for unsafe references must be unanchored to ensure that references embedded anywhere within a string are correctly identified and blocked.
