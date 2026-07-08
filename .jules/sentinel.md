## 2026-06-08 - [HIGH] Fix ReDoS in xml-parser.ts
**Vulnerability:** The regular expressions `toolRegex` and `childRegex` in `provider/bridge/xml-parser.ts` were vulnerable to Regular Expression Denial of Service (ReDoS) due to catastrophic backtracking in the pattern `(?:\s+[^>]*)?>`.
**Learning:** Overlapping quantifiers like `\s+` and `[^>]*` can lead to exponential evaluation time when matching fails, especially if the expected end character (like `>`) is missing in a long string.
**Prevention:** Use mutually exclusive paths in alternation, such as `(?:>|\s[^>]*>)`, to ensure the regex engine doesn't have to test multiple paths that can match the same sequence of characters.
