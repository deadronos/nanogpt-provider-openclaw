## 2024-05-18 - [Denial of Service mitigation]
**Vulnerability:** External API calls via `fetch` did not have timeouts configured.
**Learning:** This exposes the application to resource exhaustion if the remote endpoint hangs or is very slow, which is a Denial of Service risk.
**Prevention:** Always use `AbortSignal.timeout(ms)` to enforce limits on external HTTP requests.
