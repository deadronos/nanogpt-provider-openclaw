# Sentinel Notes

## 2026-06-08 - [HIGH] Fix ReDoS in xml-parser.ts

**Vulnerability:** The regular expressions `toolRegex` and `childRegex` in `provider/bridge/xml-parser.ts` were vulnerable to Regular Expression Denial of Service (ReDoS) due to catastrophic backtracking in the pattern `(?:\s+[^>]*)?>`.
**Learning:** Overlapping quantifiers like `\s+` and `[^>]*` can lead to exponential evaluation time when matching fails, especially if the expected end character (like `>`) is missing in a long string.
**Prevention:** Use mutually exclusive paths in alternation, such as `(?:>|\s[^>]*>)`, to ensure the regex engine doesn't have to test multiple paths that can match the same sequence of characters.

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

## 2025-02-20 - [Redact Compound Sensitive Keys Without Losing Critical Metrics]

**Vulnerability:** Case-insensitive exact matching logic (`SENSITIVE_KEYS.has(key.toLowerCase())`) fails to match compound keys (like `providerApiKey`, `nanoGptApiKey`), potentially polluting logs with leaked secrets.
**Learning:** To ensure robust redaction for compound or dynamic keys containing sensitive patterns, use a regular expression test (`SENSITIVE_PATTERN.test(key)`) with case-insensitivity. Crucially, when using substrings to redact, you must explicitly exclude safe metrics like LLM token counts (`prompt_tokens`, `completion_tokens`, `total_tokens`), otherwise they might get incorrectly redacted by loose match patterns like `token`.
**Prevention:** Implement a replacer function for `JSON.stringify` that explicitely checks keys against an allowlist for known-safe items (e.g. `SAFE_METRICS.has(key)`), then falls back to case-insensitive substring regex matching (`/apikey|token|password/i`) for redaction.

## 2026-06-25 - [Predictable Temporary File Names]

**Vulnerability:** The codebase was using `Math.random()` to generate temporary file paths, which is predictable and insecure.
**Learning:** `Math.random()` is not cryptographically secure and predictable values can lead to symlink or collision attacks in temporary directories.
**Prevention:** Always use cryptographically secure methods like `crypto.randomUUID()` or `crypto.randomBytes()` from `node:crypto` to generate temporary file names or any other random values used in security-sensitive contexts.

## 2026-06-23 - [Insecure Temporary File Generation]

**Vulnerability:** The `Math.random()` function was used to generate temporary file names for atomic writes, making the names predictable and potentially vulnerable to symlink or naming collision attacks.
**Learning:** When generating temporary file names for secure atomic operations, cryptographically secure randomness should be used to prevent prediction or collision attacks.
**Prevention:** Use `crypto.randomUUID()` or `crypto.randomBytes()` from the native `node:crypto` module instead of `Math.random()`.

## 2025-02-21 - [Predictable Temporary File Names (Hex)]

**Vulnerability:** `provider/discovery-persistence.ts` used `Math.random().toString(36)` to generate temp file names. This pseudo-random number generator is predictable, making the application vulnerable to symlink or collision attacks when generating temporary files in shared directories.
**Learning:** Never use `Math.random()` for any security-sensitive operations, including generating temporary filenames, session IDs, or tokens.
**Prevention:** Always use cryptographically secure randomness functions, such as `crypto.randomBytes(4).toString('hex')` or `crypto.randomUUID()` from the native `node:crypto` module, to guarantee unpredictability when generating temporary files.

## 2025-02-21 - [Prevent Predictable Temporary File Names]

**Vulnerability:** The persistence script (`provider/discovery-persistence.ts`) was using a weak, predictable pseudo-random number generator (`Math.random()`) to construct temporary file names before renaming them to `models.json`. This predictable nature created a potential vulnerability for symlink attacks and file collisions, particularly on shared or multi-tenant environments.
**Learning:** `Math.random()` should never be used for security-sensitive operations such as generating unique temporary paths, credentials, tokens, or identifiers. Predictable paths allow malicious users to pre-create files (e.g. symlinks) at the predicted path to escalate privileges or overwrite files they do not own.
**Prevention:** Always use cryptographically secure random generation methods (e.g. `crypto.randomUUID()`, `crypto.randomBytes()`) when constructing temporary file names or unique identifiers.

## 2026-06-05 - Predictable Temporary File Name Vulnerability

**Vulnerability:** The function `writeNanogptProviderCatalogToModelsJson` used `Math.random()` to generate a suffix for temporary file names.
**Learning:** `Math.random()` does not provide cryptographically secure randomness, making temporary file names predictable and susceptible to symlink or collision attacks.
**Prevention:** Always use `crypto.randomUUID()` or `crypto.randomBytes()` from the native `node:crypto` module when generating temporary file paths to ensure secure randomness.

## 2026-06-28 - Secure Temporary File Generation

**Vulnerability:** Predictable temporary file names using `Math.random()` for atomic writes.
**Learning:** `Math.random()` is not cryptographically secure and can lead to predictable file names, opening up potential symlink/collision attacks during file writes.
**Prevention:** Always use `node:crypto` (e.g. `randomUUID`) when generating temporary file paths.

## 2026-06-29 - [Insecure Temporary File Generation]

**Vulnerability:** Predictable temporary file names were generated using `Math.random()` in `provider/discovery-persistence.ts`, which could lead to symlink attacks or file collisions.
**Learning:** Using predictable pseudo-random number generators (PRNGs) like `Math.random()` for security-sensitive operations such as creating temporary files introduces vulnerabilities where an attacker could predict the filename and pre-create it as a symlink or malicious file.
**Prevention:** Always use cryptographically secure pseudo-random number generators (CSPRNGs) like `node:crypto`'s `randomUUID()` or `randomBytes()` when generating unique, unpredictable file paths.

## 2025-02-21 - [Predictable Temporary File Names]

**Vulnerability:** `provider/discovery-persistence.ts` used `Math.random().toString(36)` to generate temp file names. This pseudo-random number generator is predictable, making the application vulnerable to symlink or collision attacks when generating temporary files in shared directories.
**Learning:** Never use `Math.random()` for any security-sensitive operations, including generating temporary filenames, session IDs, or tokens.
**Prevention:** Always use cryptographically secure randomness functions, such as `crypto.randomBytes(4).toString('hex')` or `crypto.randomUUID()` from the native `node:crypto` module, to guarantee unpredictability when generating temporary files.
