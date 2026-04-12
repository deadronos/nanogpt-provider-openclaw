import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizePluginDiscoveryResult,
  resolvePluginDiscoveryProviders,
  runProviderCatalog,
} from "./node_modules/openclaw/src/plugins/provider-discovery.js";
import type { ProviderPlugin } from "./node_modules/openclaw/src/plugins/types.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  nanoGptCatalogProviderPromise = undefined;
});

let nanoGptCatalogProviderPromise: Promise<ProviderPlugin | undefined> | undefined;

async function loadNanoGptCatalogProvider(): Promise<ProviderPlugin | undefined> {
  nanoGptCatalogProviderPromise ??= resolvePluginDiscoveryProviders({
    config: {
      plugins: {
        allow: ["nanogpt"],
        entries: {
          nanogpt: {
            enabled: true,
            config: {
              routingMode: "auto",
              catalogSource: "auto",
            },
          },
        },
      },
    },
    workspaceDir: process.cwd(),
    env: {
      ...process.env,
      OPENCLAW_TEST_ONLY_PROVIDER_PLUGIN_IDS: "nanogpt",
      VITEST: "1",
      NODE_ENV: "test",
    },
    onlyPluginIds: ["nanogpt"],
  }).then((providers) => providers.find((provider) => provider.id === "nanogpt"));

  return nanoGptCatalogProviderPromise;
}

describe("NanoGPT OpenClaw discovery integration", () => {
  it(
    "returns discovered NanoGPT models through the OpenClaw provider catalog hook",
    async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ subscribed: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          object: "list",
          data: [
            {
              id: "moonshotai/kimi-k2.5:thinking",
              displayName: "Kimi K2.5 Thinking",
              capabilities: {
                reasoning: true,
                vision: true,
                tool_calling: true,
              },
              context_length: 262144,
              max_output_tokens: 8192,
              pricing: {
                prompt: 1.5,
                completion: 4.5,
                unit: "per_million_tokens",
              },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

      const provider = await loadNanoGptCatalogProvider();
    expect(provider).toBeDefined();

      const result = await runProviderCatalog({
        provider: provider!,
        config: {
        plugins: {
          allow: ["nanogpt"],
          entries: {
            nanogpt: {
              enabled: true,
              config: {
                routingMode: "auto",
                catalogSource: "auto",
              },
            },
          },
        },
      },
        agentDir: process.cwd(),
        workspaceDir: process.cwd(),
        env: {
        ...process.env,
        OPENCLAW_TEST_ONLY_PROVIDER_PLUGIN_IDS: "nanogpt",
        VITEST: "1",
        NODE_ENV: "test",
        },
        resolveProviderApiKey: () => ({ apiKey: "test-key" }),
        resolveProviderAuth: () => ({
        apiKey: "test-key",
        discoveryApiKey: "test-key",
        mode: "api_key",
        source: "env",
        }),
      });

      const providers = normalizePluginDiscoveryResult({
        provider: provider!,
        result,
      });

      expect(providers.nanogpt).toMatchObject({
      api: "openai-completions",
      baseUrl: "https://nano-gpt.com/api/subscription/v1",
      models: [
        expect.objectContaining({
          id: "moonshotai/kimi-k2.5:thinking",
          name: "Kimi K2.5 Thinking",
          reasoning: true,
          input: ["text", "image"],
          contextWindow: 262144,
          maxTokens: 8192,
          cost: {
            input: 1.5,
            output: 4.5,
            cacheRead: 0,
            cacheWrite: 0,
          },
        }),
      ],
    });

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://nano-gpt.com/api/subscription/v1/usage",
      );
      expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      "https://nano-gpt.com/api/subscription/v1/models?detailed=true",
      );
    },
    30_000,
  );
});