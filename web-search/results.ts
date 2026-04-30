import { resolveSiteName, wrapWebContent } from "openclaw/plugin-sdk/provider-web-search";

type NanoGptWebSearchResult = {
  title?: string;
  url?: string;
  snippet?: string;
  description?: string;
};

function normalizeNanoGptWebSearchResult(entry: NanoGptWebSearchResult): {
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
} | null {
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!url) {
    return null;
  }

  try {
    const parsedUrl = new URL(url);
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return null;
    }
  } catch {
    return null;
  }

  const title = typeof entry.title === "string" ? entry.title.trim() : "";
  const rawSnippet =
    typeof entry.snippet === "string"
      ? entry.snippet.trim()
      : typeof entry.description === "string"
        ? entry.description.trim()
        : "";

  return {
    title: title ? wrapWebContent(title, "web_search") : "",
    url,
    snippet: rawSnippet ? wrapWebContent(rawSnippet, "web_search") : "",
    siteName: resolveSiteName(url) || undefined,
  };
}

export type { NanoGptWebSearchResult };
export { normalizeNanoGptWebSearchResult };
