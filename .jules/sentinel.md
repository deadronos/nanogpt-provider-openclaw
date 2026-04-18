## 2025-04-15 - Prevent XSS in Web Search Results
**Vulnerability:** The web search provider (`normalizeNanoGptWebSearchResult` in `web-search.ts`) was normalizing and returning URLs without verifying their protocol. This allowed `javascript:` or `data:` URLs to be passed downstream as valid results.
**Learning:** Even when consuming data from a trusted third-party API (like NanoGPT web search), any URLs intended to be rendered or clicked must be explicitly sanitized to ensure they use safe protocols.
**Prevention:** Use the `URL` constructor to parse incoming URLs and explicitly check that `parsedUrl.protocol` is either `http:` or `https:`. Return `null` for any URL that fails to parse or uses an unsafe scheme.
## 2025-05-18 - Missing timeouts on external API calls
**Vulnerability:** External fetch calls in `web-search.ts` and `image-generation-provider.ts` were missing timeout configurations, which could lead to resource exhaustion if the remote endpoints hang indefinitely.
**Learning:** Relying on default `fetch` behavior for external APIs leaves the application susceptible to denial-of-service (DoS) conditions through connection hanging.
**Prevention:** Always use `signal: AbortSignal.timeout(ms)` when making outbound network requests using `fetch` to ensure operations fail securely within an expected timeframe.
