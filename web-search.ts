import {
  enablePluginInConfig,
  readNumberParam,
  readProviderEnvValue,
  readStringArrayParam,
  readStringParam,
  resolveProviderWebSearchPluginConfig,
  resolveSearchCount,
  resolveSiteName,
  setProviderWebSearchPluginConfigValue,
  wrapWebContent,
  type WebSearchProviderPlugin,
} from "openclaw/plugin-sdk/provider-web-search";

const NANOGPT_WEB_SEARCH_URL = "https://nano-gpt.com/api/web";
const NANOGPT_WEB_SEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    query: {
      type: "string",
      description: "Search query string.",
    },
    count: {
      type: "number",
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: 10,
    },
    includeDomains: {
      type: "array",
      description: "Restrict results to these domains.",
      items: {
        type: "string",
        minLength: 1,
      },
    },
    excludeDomains: {
      type: "array",
      description: "Exclude results from these domains.",
      items: {
        type: "string",
        minLength: 1,
      },
    },
  },
  required: ["query"],
} as const;

type NanoGptWebSearchResult = {
  title?: string;
  url?: string;
  snippet?: string;
  description?: string;
};

type NanoGptWebSearchResponse = {
  data?: NanoGptWebSearchResult[];
  metadata?: {
    query?: string;
    provider?: string;
    depth?: string;
    outputType?: string;
    cost?: number;
  };
};

function resolveNanoGptWebSearchApiKey(config?: Record<string, unknown>): string | undefined {
  const pluginConfig = resolveProviderWebSearchPluginConfig(
    config as Parameters<typeof resolveProviderWebSearchPluginConfig>[0],
    "nanogpt",
  );
  const apiKey = typeof pluginConfig?.apiKey === "string" ? pluginConfig.apiKey.trim() : "";
  if (apiKey) {
    return apiKey;
  }

  return readProviderEnvValue(["NANOGPT_API_KEY"]);
}

function normalizeNanoGptWebSearchResult(
  entry: NanoGptWebSearchResult,
): {
  title: string;
  url: string;
  snippet: string;
  siteName?: string;
} | null {
  const url = typeof entry.url === "string" ? entry.url.trim() : "";
  if (!url) {
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

function missingNanoGptKeyPayload() {
  return {
    error: "missing_nanogpt_api_key",
    message:
      "web_search (nanogpt) needs NANOGPT_API_KEY. Set it in the environment or store it under plugins.entries.nanogpt.config.webSearch.apiKey.",
    docs: "https://docs.nano-gpt.com/api-reference/endpoint/web-search",
  };
}

export function createNanoGptWebSearchProvider(): WebSearchProviderPlugin {
  return {
    id: "nanogpt",
    label: "NanoGPT Search",
    hint: "Direct NanoGPT web search via /api/web",
    onboardingScopes: ["text-inference"],
    credentialLabel: "NanoGPT API key",
    envVars: ["NANOGPT_API_KEY"],
    placeholder: "ngpt_...",
    signupUrl: "https://nano-gpt.com/api",
    docsUrl: "https://docs.nano-gpt.com/api-reference/endpoint/web-search",
    autoDetectOrder: 60,
    credentialPath: "plugins.entries.nanogpt.config.webSearch.apiKey",
    inactiveSecretPaths: ["plugins.entries.nanogpt.config.webSearch.apiKey"],
    getCredentialValue: (searchConfig: unknown) => {
      const cfg = searchConfig as Record<string, unknown> | undefined;
      return typeof cfg?.apiKey === "string" ? cfg.apiKey : undefined;
    },
    setCredentialValue: () => {},
    getConfiguredCredentialValue: (config) =>
      resolveProviderWebSearchPluginConfig(config, "nanogpt")?.apiKey,
    setConfiguredCredentialValue: (configTarget, value) => {
      setProviderWebSearchPluginConfigValue(configTarget, "nanogpt", "apiKey", value);
    },
    applySelectionConfig: (config) => enablePluginInConfig(config, "nanogpt").config,
    createTool: (ctx) => ({
      description:
        "Search the web using NanoGPT's direct web search API. Returns titles, URLs, and snippets.",
      parameters: NANOGPT_WEB_SEARCH_SCHEMA,
      execute: async (args) => {
        const apiKey = resolveNanoGptWebSearchApiKey(ctx.config as Record<string, unknown>);
        if (!apiKey) {
          return missingNanoGptKeyPayload();
        }

        const query = readStringParam(args, "query", { required: true });
        const count = resolveSearchCount(readNumberParam(args, "count", { integer: true }), 5);
        const includeDomains = readStringArrayParam(args, "includeDomains")?.filter(Boolean);
        const excludeDomains = readStringArrayParam(args, "excludeDomains")?.filter(Boolean);

        const response = await fetch(NANOGPT_WEB_SEARCH_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            query,
            provider: "linkup",
            depth: "standard",
            outputType: "searchResults",
            ...(includeDomains && includeDomains.length > 0 ? { includeDomains } : {}),
            ...(excludeDomains && excludeDomains.length > 0 ? { excludeDomains } : {}),
          }),
        });

        if (!response.ok) {
          const detail = await response.text();
          throw new Error(
            `NanoGPT web search failed (${response.status}): ${detail || response.statusText}`,
          );
        }

        const payload = (await response.json()) as NanoGptWebSearchResponse;
        const results = (Array.isArray(payload.data) ? payload.data : [])
          .map(normalizeNanoGptWebSearchResult)
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
          .slice(0, count);

        return {
          query,
          provider: "nanogpt",
          count: results.length,
          externalContent: {
            untrusted: true,
            source: "web_search",
            provider: "nanogpt",
            wrapped: true,
          },
          results,
          metadata: payload.metadata ?? {},
        };
      },
    }),
  };
}

export const __testing = {
  resolveNanoGptWebSearchApiKey,
  normalizeNanoGptWebSearchResult,
};

export type WebSearchTestingExports = typeof __testing;
