## 2025-02-20 - [Redact Sensitive Data In Log Meta Output]
**Vulnerability:** The logger `provider/nanogpt-logger.ts` was serializing the raw `meta` object using `JSON.stringify(meta)` without redacting sensitive information like `apiKey`, `secret`, `token`, `password`, and `authorization` keys.
**Learning:** Raw logger implementations should always use a JSON replacer to intercept object key serialization in order to filter/redact sensitive metadata (e.g. passwords, API keys) which may inadvertently be passed into logs, thus polluting logs with secrets.
**Prevention:** Implement a replacer function for `JSON.stringify` that checks keys via regex and redacts sensitive data with `[REDACTED]`.
## 2026-05-15 - Environment Variable Exfiltration Bypass
**Vulnerability:** Partial match bypass in environment variable reference validation allowed exfiltration.
**Learning:** The previous `ANY_BRACED_ENV_REF_PATTERN` and `ANY_UNBRACED_ENV_REF_PATTERN` regexes used `^` and `$` anchors, which only matched strings that were *entirely* environment variable references (like `${SECRET}`). This allowed references embedded within larger strings (like `prefix${SECRET}suffix`) to bypass the check and potentially exfiltrate sensitive data.
**Prevention:** Validation regexes for unsafe references must be unanchored to ensure that references embedded anywhere within a string are correctly identified and blocked.
## 2026-05-18 - SSRF/Parser Differential via URL Validation
**Vulnerability:** The web search results normalizer (`web-search/results.ts`) validated URLs using the `URL` constructor to ensure they used `http:` or `https:`, but returned the *raw* user-supplied string rather than the parsed URL string. This allowed URL parser differentials where the string passed validation but downstream consumers interpreted it as a different, potentially malicious URI.
**Learning:** Checking a parsed URL is not enough if you continue to use the raw, un-normalized string. You must use the sanitized, serialized output of the parser (`parsedUrl.href`) to ensure the validation logic accurately reflects what the downstream consumer will process.
**Prevention:** Always extract and export the canonicalized properties (`parsedUrl.href`) from the parsed URL object rather than returning the raw input string.
## 2026-06-16 - Safe Replacer Over-redaction Bypass
**Vulnerability:** The logger redaction regex `SENSITIVE_KEY_PATTERN` was checking for sensitive substrings with case-insensitive exact matching `SENSITIVE_KEYS.has(key.toLowerCase())`. If a compound key such as `providerApiKey` was passed in, the `has()` lookup would fail to match `apikey` exactly and fail to redact the sensitive payload.
**Learning:** Hardcoded exact match lookups for sensitive fields fail on camelCase, snake_case, or dynamically generated payload keys.
**Prevention:** Use unanchored `/apiKey|token/i.test(key)` case-insensitive regex for string matching any potential occurrences of a substring like "apikey". Explicitly skip "safe" keys such as "prompt_tokens" which match the pattern but do not contain sensitive credentials.
