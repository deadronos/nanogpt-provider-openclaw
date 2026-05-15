## 2026-05-15 - Environment Variable Exfiltration Bypass
**Vulnerability:** Partial match bypass in environment variable reference validation allowed exfiltration.
**Learning:** The previous `ANY_BRACED_ENV_REF_PATTERN` and `ANY_UNBRACED_ENV_REF_PATTERN` regexes used `^` and `$` anchors, which only matched strings that were *entirely* environment variable references (like `${SECRET}`). This allowed references embedded within larger strings (like `prefix${SECRET}suffix`) to bypass the check and potentially exfiltrate sensitive data.
**Prevention:** Validation regexes for unsafe references must be unanchored to ensure that references embedded anywhere within a string are correctly identified and blocked.
