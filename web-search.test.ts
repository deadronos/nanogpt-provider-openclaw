import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { postTrustedWebToolsJsonMock } = vi.hoisted(() => ({
  postTrustedWebToolsJsonMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/provider-web-search", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/provider-web-search")>(
    "openclaw/plugin-sdk/provider-web-search",
  );
  return {
    ...actual,
    postTrustedWebToolsJson: postTrustedWebToolsJsonMock,
  };
});

import plugin from "./index.js";
import { clearEnvKeys, restoreEnv, snapshotEnv } from "./test-env.js";
import { createNanoGptWebSearchProvider, __testing } from "./web-search.js";

const WEB_SEARCH_ENV_KEYS = ["NANOGPT_API_KEY"] as const;

let webSearchEnvSnapshot: Record<string, string | undefined> | undefined;

beforeEach(() => {
  webSearchEnvSnapshot = snapshotEnv(WEB_SEARCH_ENV_KEYS);
  clearEnvKeys(WEB_SEARCH_ENV_KEYS);
  postTrustedWebToolsJsonMock.mockReset();
});

describe("nanogpt web search provider", () => {
  it("registers the nanogpt web search provider", () => {
    const webSearchProviders: unknown[] = [];

    plugin.register({
      pluginConfig: {},
      registerProvider() {},
      registerWebSearchProvider(provider: unknown) {
        webSearchProviders.push(provider);
      },
      registerImageGenerationProvider() {},
    } as never);

    expect(webSearchProviders).toHaveLength(1);
    expect(webSearchProviders[0]).toMatchObject({
      id: "nanogpt",
      label: "NanoGPT Search",
      envVars: ["NANOGPT_API_KEY"],
      credentialPath: "plugins.entries.nanogpt.config.webSearch.apiKey",
    });
  });

  it("round-trips credentials through the normal provider contract fields", () => {
    const provider = createNanoGptWebSearchProvider();
    const searchConfig: Record<string, unknown> = {};
    const config: Record<string, unknown> = {};

    provider.setCredentialValue(searchConfig, "top-level-key");
    provider.setConfiguredCredentialValue?.(config as never, "configured-key");

    expect(provider.getCredentialValue(searchConfig)).toBe("top-level-key");
    expect(provider.getConfiguredCredentialValue?.(config as never)).toBe("configured-key");
    expect(searchConfig).toMatchObject({
      apiKey: "top-level-key",
    });
    expect(config).toMatchObject({
      plugins: {
        entries: {
          nanogpt: {
            enabled: true,
            config: {
              webSearch: {
                apiKey: "configured-key",
              },
            },
          },
        },
      },
    });
  });

  it("returns a missing-key payload when no NanoGPT key is configured", async () => {
    const provider = createNanoGptWebSearchProvider();
    const tool = provider.createTool({
      config: {},
      searchConfig: {},
    } as never);
    if (!tool) {
      throw new Error("Expected tool definition");
    }

    await expect(tool.execute({ query: "nanogpt docs" })).resolves.toMatchObject({
      error: "missing_nanogpt_api_key",
    });
    expect(postTrustedWebToolsJsonMock).not.toHaveBeenCalled();
  });

  it("accepts search queries exactly at the maximum length limit", async () => {
    postTrustedWebToolsJsonMock.mockImplementation(
      async (
        params: Record<string, unknown>,
        parseResponse: (response: Response) => Promise<unknown>,
      ) =>
        await parseResponse(
          new Response(
            JSON.stringify({
              data: [],
              metadata: {
                query: "a".repeat(2000),
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
    );

    const provider = createNanoGptWebSearchProvider();
    const tool = provider.createTool({
      config: {
        plugins: {
          entries: {
            nanogpt: {
              config: {
                webSearch: {
                  apiKey: "test-key",
                },
              },
            },
          },
        },
      },
      searchConfig: {},
    } as never);
    if (!tool) {
      throw new Error("Expected tool definition");
    }

    const exactLengthQuery = "a".repeat(2000);
    const result = await tool.execute({ query: exactLengthQuery });

    expect(postTrustedWebToolsJsonMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      query: exactLengthQuery,
      provider: "nanogpt",
      count: 0,
      results: [],
    });
  });

  it("rejects search queries that exceed the maximum length", async () => {
    const provider = createNanoGptWebSearchProvider();
    const tool = provider.createTool({
      config: {
        plugins: {
          entries: {
            nanogpt: {
              config: {
                webSearch: {
                  apiKey: "test-key",
                },
              },
            },
          },
        },
      },
      searchConfig: {},
    } as never);
    if (!tool) {
      throw new Error("Expected tool definition");
    }

    const longQuery = "a".repeat(2001);
    await expect(tool.execute({ query: longQuery })).rejects.toThrow(
      "Search query is too long (maximum 2000 characters).",
    );
    expect(postTrustedWebToolsJsonMock).not.toHaveBeenCalled();
  });

  it("normalizes NanoGPT search results and forwards domain filters through the trusted helper", async () => {
    postTrustedWebToolsJsonMock.mockImplementation(
      async (
        params: Record<string, unknown>,
        parseResponse: (response: Response) => Promise<unknown>,
      ) =>
        await parseResponse(
          new Response(
            JSON.stringify({
              data: [
                {
                  title: "NanoGPT Docs",
                  url: "https://docs.nano-gpt.com/",
                  snippet: "API reference and integration guides.",
                },
              ],
              metadata: {
                query: "nanogpt docs",
                provider: "linkup",
                depth: "standard",
                outputType: "searchResults",
                cost: 0.006,
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        ),
    );

    const provider = createNanoGptWebSearchProvider();
    const tool = provider.createTool({
      config: {
        plugins: {
          entries: {
            nanogpt: {
              config: {
                webSearch: {
                  apiKey: "test-key",
                },
              },
            },
          },
        },
      },
      searchConfig: {},
    } as never);
    if (!tool) {
      throw new Error("Expected tool definition");
    }

    const result = await tool.execute({
      query: "nanogpt docs",
      includeDomains: ["docs.nano-gpt.com"],
      excludeDomains: ["example.com"],
    });

    expect(postTrustedWebToolsJsonMock).toHaveBeenCalledTimes(1);
    expect(postTrustedWebToolsJsonMock.mock.calls[0]?.[0]).toMatchObject({
      url: "https://nano-gpt.com/api/web",
      apiKey: "test-key",
      timeoutSeconds: 30,
      errorLabel: "NanoGPT web search",
      body: {
        query: "nanogpt docs",
        provider: "linkup",
        depth: "standard",
        outputType: "searchResults",
        includeDomains: ["docs.nano-gpt.com"],
        excludeDomains: ["example.com"],
      },
    });
    expect(result).toMatchObject({
      query: "nanogpt docs",
      provider: "nanogpt",
      count: 1,
      results: [
        {
          url: "https://docs.nano-gpt.com/",
          siteName: "docs.nano-gpt.com",
        },
      ],
    });
  });

  it("prefers the dedicated NanoGPT web_search credential over NANOGPT_API_KEY", async () => {
    process.env.NANOGPT_API_KEY = "env-key";
    postTrustedWebToolsJsonMock.mockImplementation(
      async (
        params: Record<string, unknown>,
        parseResponse: (response: Response) => Promise<unknown>,
      ) => {
        expect(params).toMatchObject({
          apiKey: "config-key",
        });
        return await parseResponse(
          new Response(JSON.stringify({ data: [], metadata: {} }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );

    const provider = createNanoGptWebSearchProvider();
    const tool = provider.createTool({
      config: {
        plugins: {
          entries: {
            nanogpt: {
              config: {
                webSearch: {
                  apiKey: "config-key",
                },
              },
            },
          },
        },
      },
      searchConfig: {},
    } as never);
    if (!tool) {
      throw new Error("Expected tool definition");
    }

    await tool.execute({ query: "nanogpt docs" });
    expect(postTrustedWebToolsJsonMock).toHaveBeenCalledTimes(1);
  });

  it("prefers the configured NanoGPT credential over a top-level search apiKey", async () => {
    postTrustedWebToolsJsonMock.mockImplementation(
      async (
        params: Record<string, unknown>,
        parseResponse: (response: Response) => Promise<unknown>,
      ) => {
        expect(params).toMatchObject({
          apiKey: "configured-key",
        });
        return await parseResponse(
          new Response(JSON.stringify({ data: [], metadata: {} }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      },
    );

    const provider = createNanoGptWebSearchProvider();
    const tool = provider.createTool({
      config: {
        plugins: {
          entries: {
            nanogpt: {
              config: {
                webSearch: {
                  apiKey: "configured-key",
                },
              },
            },
          },
        },
      },
      searchConfig: {
        apiKey: "top-level-key",
      },
    } as never);
    if (!tool) {
      throw new Error("Expected tool definition");
    }

    await tool.execute({ query: "nanogpt docs" });
    expect(postTrustedWebToolsJsonMock).toHaveBeenCalledTimes(1);
  });

  it("does not resolve unauthorized environment variables", () => {
    process.env.AWS_SECRET = "super-secret-aws-key";

    const apiKey = __testing.resolveNanoGptWebSearchApiKey({
      apiKey: "${AWS_SECRET}",
    });

    expect(apiKey).toBeUndefined();
    expect(__testing.resolveNanoGptWebSearchApiKey({ apiKey: "${_secret}" })).toBeUndefined();
    expect(__testing.resolveNanoGptWebSearchApiKey({ apiKey: "${secret_var}" })).toBeUndefined();
  });

  it("resolves env secret refs from the provisioned NanoGPT web_search credential path", async () => {
    process.env.NANOGPT_API_KEY = "env-ref-key";
    postTrustedWebToolsJsonMock.mockImplementation(
      async (
        params: Record<string, unknown>,
        parseResponse: (response: Response) => Promise<unknown>,
      ) => {
        expect(params).toMatchObject({
          apiKey: "env-ref-key",
        });
        return await parseResponse(
          new Response(
            JSON.stringify({
              data: [],
              metadata: {
                query: "nanogpt docs",
              },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          ),
        );
      },
    );

    const provider = createNanoGptWebSearchProvider();
    const tool = provider.createTool({
      config: {
        plugins: {
          entries: {
            nanogpt: {
              config: {
                webSearch: {
                  apiKey: "${NANOGPT_API_KEY}",
                },
              },
            },
          },
        },
      },
      searchConfig: {},
    } as never);
    if (!tool) {
      throw new Error("Expected tool definition");
    }

    await tool.execute({ query: "nanogpt docs" });
    expect(postTrustedWebToolsJsonMock).toHaveBeenCalledTimes(1);
  });

  it("filters out results with unsafe or invalid URLs", () => {
    expect(
      __testing.normalizeNanoGptWebSearchResult({
        url: "javascript:alert(1)",
        title: "Malicious",
        snippet: "Malicious",
      }),
    ).toBeNull();

    expect(
      __testing.normalizeNanoGptWebSearchResult({
        url: "data:text/html,<script>alert(1)</script>",
        title: "Malicious",
        snippet: "Malicious",
      }),
    ).toBeNull();

    expect(
      __testing.normalizeNanoGptWebSearchResult({
        url: "not-a-valid-url",
        title: "Invalid",
        snippet: "Invalid",
      }),
    ).toBeNull();
  });
});

afterEach(() => {
  if (webSearchEnvSnapshot) {
    restoreEnv(webSearchEnvSnapshot);
  }
  webSearchEnvSnapshot = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
