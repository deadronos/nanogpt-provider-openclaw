import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import plugin from "./index.js";
import { createNanoGptWebSearchProvider, __testing } from "./web-search.js";

let originalNanoGptApiKey: string | undefined;

beforeEach(() => {
  originalNanoGptApiKey = process.env.NANOGPT_API_KEY;
  delete process.env.NANOGPT_API_KEY;
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
      "Search query is too long (maximum 2000 characters)."
    );
  });

  it("normalizes NanoGPT search results and forwards domain filters", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
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
    );
    vi.stubGlobal("fetch", fetchSpy);

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

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("https://nano-gpt.com/api/web");
    expect(fetchSpy.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer test-key",
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
      query: "nanogpt docs",
      provider: "linkup",
      depth: "standard",
      outputType: "searchResults",
      includeDomains: ["docs.nano-gpt.com"],
      excludeDomains: ["example.com"],
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
  it("filters out results with unsafe or invalid URLs", () => {
    expect(
      __testing.normalizeNanoGptWebSearchResult({
        url: "javascript:alert(1)",
        title: "Malicious",
        snippet: "Malicious",
      })
    ).toBeNull();

    expect(
      __testing.normalizeNanoGptWebSearchResult({
        url: "data:text/html,<script>alert(1)</script>",
        title: "Malicious",
        snippet: "Malicious",
      })
    ).toBeNull();

    expect(
      __testing.normalizeNanoGptWebSearchResult({
        url: "not-a-valid-url",
        title: "Invalid",
        snippet: "Invalid",
      })
    ).toBeNull();
  });
});

afterEach(() => {
  if (originalNanoGptApiKey === undefined) {
    delete process.env.NANOGPT_API_KEY;
  } else {
    process.env.NANOGPT_API_KEY = originalNanoGptApiKey;
  }
  originalNanoGptApiKey = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
