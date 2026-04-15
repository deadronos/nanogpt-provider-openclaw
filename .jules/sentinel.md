## 2025-04-15 - Prevent XSS in Web Search Results
**Vulnerability:** The web search provider (`normalizeNanoGptWebSearchResult` in `web-search.ts`) was normalizing and returning URLs without verifying their protocol. This allowed `javascript:` or `data:` URLs to be passed downstream as valid results.
**Learning:** Even when consuming data from a trusted third-party API (like NanoGPT web search), any URLs intended to be rendered or clicked must be explicitly sanitized to ensure they use safe protocols.
**Prevention:** Use the `URL` constructor to parse incoming URLs and explicitly check that `parsedUrl.protocol` is either `http:` or `https:`. Return `null` for any URL that fails to parse or uses an unsafe scheme.
