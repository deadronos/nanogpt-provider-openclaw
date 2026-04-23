import { NANOGPT_PROVIDER_ID } from "./models.js";
import { sanitizeApiKey } from "./shared/http.js";
import {
  NANOGPT_WEB_SEARCH_CREDENTIAL_PATH,
  resolveNanoGptWebSearchApiKey,
  resolveNanoGptWebSearchConfig,
} from "./web-search/credentials.js";
import { normalizeNanoGptWebSearchResult } from "./web-search/results.js";
import {
  postTrustedWebToolsJson,
  readNumberParam,
  readStringArrayParam,
  readStringParam,
  resolveSearchCount,
  resolveSearchTimeoutSeconds,
  type WebSearchProviderPlugin,
} from "openclaw/plugin-sdk/provider-web-search";
import { createWebSearchProviderContractFields } from "openclaw/plugin-sdk/provider-web-search-contract";
import { createNanoGptLoggerSync } from "./provider/nanogpt-logger.js";

const _webSearchLogger = createNanoGptLoggerSync("web-search");

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

type NanoGptWebSearchResponse = {
  data?: Array<{
    title?: string;
    url?: string;
    snippet?: string;
    description?: string;
  }>;
  metadata?: {
    query?: string;
    provider?: string;
    depth?: string;
    outputType?: string;
    cost?: number;
  };
};

function missingNanoGptKeyPayload() {
  return {
    error: "missing_nanogpt_api_key",
    message:
      "web_search (nanogpt) needs a NanoGPT API key. Set tools.web.search.apiKey, set NANOGPT_API_KEY in the environment, or store it under plugins.entries.nanogpt.config.webSearch.apiKey.",
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
    credentialPath: NANOGPT_WEB_SEARCH_CREDENTIAL_PATH,
    ...createWebSearchProviderContractFields({
      credentialPath: NANOGPT_WEB_SEARCH_CREDENTIAL_PATH,
      searchCredential: {
        type: "top-level",
      },
      configuredCredential: {
        pluginId: NANOGPT_PROVIDER_ID,
      },
      selectionPluginId: NANOGPT_PROVIDER_ID,
    }),
    createTool: (ctx) => ({
      description:
        "Search the web using NanoGPT's direct web search API. Returns titles, URLs, and snippets.",
      parameters: NANOGPT_WEB_SEARCH_SCHEMA,
      execute: async (args) => {
        const searchConfig = resolveNanoGptWebSearchConfig({
          config: ctx.config as Record<string, unknown> | undefined,
          searchConfig: ctx.searchConfig as Record<string, unknown> | undefined,
        });
        const apiKey = resolveNanoGptWebSearchApiKey(searchConfig);
        if (!apiKey) {
          _webSearchLogger.error("web search missing API key");
          return missingNanoGptKeyPayload();
        }

        const query = readStringParam(args, "query", { required: true });
        if (query.length > 2000) {
          throw new Error("Search query is too long (maximum 2000 characters).");
        }

        _webSearchLogger.info("web search request", { query });
        const count = resolveSearchCount(readNumberParam(args, "count", { integer: true }), 5);
        const includeDomains = readStringArrayParam(args, "includeDomains")?.filter(Boolean);
        const excludeDomains = readStringArrayParam(args, "excludeDomains")?.filter(Boolean);

        return await postTrustedWebToolsJson(
          {
            url: NANOGPT_WEB_SEARCH_URL,
            apiKey: sanitizeApiKey(apiKey),
            timeoutSeconds: resolveSearchTimeoutSeconds(searchConfig),
            errorLabel: "NanoGPT web search",
            body: {
              query,
              provider: "linkup",
              depth: "standard",
              outputType: "searchResults",
              ...(includeDomains && includeDomains.length > 0 ? { includeDomains } : {}),
              ...(excludeDomains && excludeDomains.length > 0 ? { excludeDomains } : {}),
            },
          },
          async (response) => {
            const payload = (await response.json()) as NanoGptWebSearchResponse;
            const results = (Array.isArray(payload.data) ? payload.data : [])
              .map(normalizeNanoGptWebSearchResult)
              .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
              .slice(0, count);

            _webSearchLogger.info("web search response received", { query, resultCount: results.length });
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
        );
      },
    }),
  };
}

export const __testing = {
  resolveNanoGptWebSearchApiKey,
  normalizeNanoGptWebSearchResult,
};
