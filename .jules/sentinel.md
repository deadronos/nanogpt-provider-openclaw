## 2024-05-20 - Fix environment variable exfiltration via apiKey parameter

**Vulnerability:** The code in `web-search/credentials.ts` validated if a string looked like an environment variable reference (e.g. `${ENV_VAR}`) using the restrictive regex `/^\$\{([A-Z][A-Z0-9_]*)\}$/`.

**Learning:** This regex failed to catch secrets named with lowercase characters or leading underscores (e.g., `${_secret}` or `${my_secret}`). This allowed those strings to bypass the check and potentially leak an environment variable value if the underlying framework tried to resolve it.

**Prevention:** Always use broad regexes when checking for unsafe string formats (like `/^\$\{([^}]+)\}$/` instead of `/^\$\{([A-Z][A-Z0-9_]*)\}$/`) to ensure attackers cannot bypass validation simply by changing the casing or naming pattern.
