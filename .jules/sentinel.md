## 2024-05-20 - Fix environment variable exfiltration via apiKey parameter

**Vulnerability:** The code in `web-search/credentials.ts` validated if a string looked like an environment variable reference (e.g. `${ENV_VAR}`) using the restrictive regex `/^\$\{([A-Z][A-Z0-9_]*)\}$/`.

**Learning:** This regex failed to catch secrets named with lowercase characters or leading underscores (e.g., `${_secret}` or `${my_secret}`). This allowed those strings to bypass the check and potentially leak an environment variable value if the underlying framework tried to resolve it.

**Prevention:** Always use broad regexes when checking for unsafe string formats (like `/^\$\{([^}]+)\}$/` instead of `/^\$\{([A-Z][A-Z0-9_]*)\}$/`) to ensure attackers cannot bypass validation simply by changing the casing or naming pattern.
## 2026-04-24 - Add input length limits to image generation prompt
**Vulnerability:** The image generation provider accepted an arbitrarily long `req.prompt` parameter, passing it directly to the provider payload. This lack of validation created a potential DoS/resource exhaustion vector.
**Learning:** Missing length limits on arbitrary text inputs passed to external APIs can be exploited to cause large memory allocations or exceed upstream API payload limits unnecessarily.
**Prevention:** Implement input length validation early in the request pipeline (e.g. `req.prompt.length > 4000`) to enforce a safe maximum before payload serialization.
## 2026-05-24 - Limit array sizes and external error strings to prevent DoS and information leak

**Vulnerability:** The web search provider did not enforce a size limit on the `includeDomains` and `excludeDomains` input arrays. Additionally, the image generation provider threw the raw text of HTTP error responses from the upstream API directly to the user.
**Learning:** Failing to enforce limits on arrays creates an Application-level DoS vector, and passing upstream HTTP error bodies blindly can lead to large allocations, unexpected payload leakage, and crashes.
**Prevention:** Cap array inputs (e.g. `includeDomains.length > 50`) and limit external error responses to a safe length (e.g. `detail.slice(0, 200)`) before logging or throwing.
