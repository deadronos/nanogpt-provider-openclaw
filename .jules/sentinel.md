## 2024-05-20 - Fix environment variable exfiltration via apiKey parameter

**Vulnerability:** The code in `web-search/credentials.ts` validated if a string looked like an environment variable reference (e.g. `${ENV_VAR}`) using the restrictive regex `/^\$\{([A-Z][A-Z0-9_]*)\}$/`.

**Learning:** This regex failed to catch secrets named with lowercase characters or leading underscores (e.g., `${_secret}` or `${my_secret}`). This allowed those strings to bypass the check and potentially leak an environment variable value if the underlying framework tried to resolve it.

**Prevention:** Always use broad regexes when checking for unsafe string formats (like `/^\$\{([^}]+)\}$/` instead of `/^\$\{([A-Z][A-Z0-9_]*)\}$/`) to ensure attackers cannot bypass validation simply by changing the casing or naming pattern.

## 2026-04-24 - Add input length limits to image generation prompt

**Vulnerability:** The image generation provider accepted an arbitrarily long `req.prompt` parameter, passing it directly to the provider payload. This lack of validation created a potential DoS/resource exhaustion vector.
**Learning:** Missing length limits on arbitrary text inputs passed to external APIs can be exploited to cause large memory allocations or exceed upstream API payload limits unnecessarily.
**Prevention:** Implement input length validation early in the request pipeline (e.g. `req.prompt.length > 4000`) to enforce a safe maximum before payload serialization.
