import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { stagePackageDir } from "./scripts/stage-package-dir.mjs";
import { mergeProcessEnv } from "./test-env.js";

type ProviderCatalogHook = {
  order?: string;
  run: (params: {
    config: unknown;
    agentDir?: string;
    workspaceDir?: string;
    env: NodeJS.ProcessEnv;
    resolveProviderApiKey: (providerId?: string) => {
      apiKey: string | undefined;
      discoveryApiKey?: string;
    };
    resolveProviderAuth: (providerId?: string, options?: { oauthMarker?: string }) => {
      apiKey: string | undefined;
      discoveryApiKey?: string;
      mode: "api_key" | "oauth" | "token" | "none";
      source: "env" | "profile" | "none";
      profileId?: string;
    };
  }) => Promise<unknown> | unknown;
};

type ProviderPlugin = {
  id: string;
  aliases?: string[];
  hookAliases?: string[];
  catalog?: ProviderCatalogHook;
  discovery?: ProviderCatalogHook;
} & Record<string, unknown>;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  nanoGptCatalogProviderPromise = undefined;
  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (!tempPath) {
      continue;
    }
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

let nanoGptCatalogProviderPromise: Promise<ProviderPlugin | undefined> | undefined;
const tempPaths: string[] = [];

function makeTempWorkspace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nanogpt-discovery-workspace-"));
  tempPaths.push(tempDir);
  return tempDir;
}

function stageNanoGptWorkspace() {
  const workspaceDir = makeTempWorkspace();
  const packageDir = path.join(workspaceDir, ".openclaw", "extensions", "nanogpt");
  stagePackageDir({ outputDir: packageDir });
  return { workspaceDir, packageDir };
}

function resolveProviderCatalogHook(provider: ProviderPlugin): ProviderCatalogHook | undefined {
  return provider.catalog ?? provider.discovery;
}

async function resolvePluginDiscoveryProviders(params: {
  config?: unknown;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  onlyPluginIds?: string[];
}): Promise<ProviderPlugin[]> {
  const require = createRequire(import.meta.url);
  const { resolvePluginDiscoveryProvidersRuntime } = require("./node_modules/openclaw/dist/plugins/provider-discovery.runtime.js") as {
    resolvePluginDiscoveryProvidersRuntime: (runtimeParams: typeof params) => ProviderPlugin[];
  };

  return resolvePluginDiscoveryProvidersRuntime(params).filter(
    (provider: ProviderPlugin) => resolveProviderCatalogHook(provider) !== undefined,
  );
}

function normalizeProviderId(providerId: string): string {
  return providerId.trim().toLowerCase();
}

function normalizePluginDiscoveryResult(params: {
  provider: ProviderPlugin;
  result: unknown;
}): Record<string, unknown> {
  const result = params.result;
  if (!result || typeof result !== "object") {
    return {};
  }

  if ("provider" in result) {
    const normalized: Record<string, unknown> = {};
    for (const providerId of [
      params.provider.id,
      ...(params.provider.aliases ?? []),
      ...(params.provider.hookAliases ?? []),
    ]) {
      const normalizedKey = normalizeProviderId(providerId);
      if (!normalizedKey) {
        continue;
      }
      normalized[normalizedKey] = (result as { provider: unknown }).provider;
    }
    return normalized;
  }

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries((result as { providers?: Record<string, unknown> }).providers ?? {})) {
    const normalizedKey = normalizeProviderId(key);
    if (!normalizedKey || !value) {
      continue;
    }
    normalized[normalizedKey] = value;
  }

  return normalized;
}

function runProviderCatalog(params: {
  provider: ProviderPlugin;
  config: unknown;
  agentDir?: string;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
  resolveProviderApiKey: (providerId?: string) => {
    apiKey: string | undefined;
    discoveryApiKey?: string;
  };
  resolveProviderAuth: (providerId?: string, options?: { oauthMarker?: string }) => {
    apiKey: string | undefined;
    discoveryApiKey?: string;
    mode: "api_key" | "oauth" | "token" | "none";
    source: "env" | "profile" | "none";
    profileId?: string;
  };
}): Promise<unknown> | unknown {
  return resolveProviderCatalogHook(params.provider)?.run({
    config: params.config,
    agentDir: params.agentDir,
    workspaceDir: params.workspaceDir,
    env: params.env,
    resolveProviderApiKey: params.resolveProviderApiKey,
    resolveProviderAuth: params.resolveProviderAuth,
  });
}

async function loadNanoGptCatalogProvider(workspaceDir: string): Promise<ProviderPlugin | undefined> {
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
    workspaceDir,
    env: mergeProcessEnv({
      OPENCLAW_TEST_ONLY_PROVIDER_PLUGIN_IDS: "nanogpt",
      VITEST: "1",
      NODE_ENV: "test",
    }),
    onlyPluginIds: ["nanogpt"],
  }).then((providers) => providers.find((provider) => provider.id === "nanogpt"));

  return nanoGptCatalogProviderPromise;
}

async function loadNanoGptCatalogProviderWithPluginConfig(
  workspaceDir: string,
  pluginConfig: Record<string, unknown>,
): Promise<ProviderPlugin | undefined> {
  const providers = await resolvePluginDiscoveryProviders({
    config: {
      plugins: {
        allow: ["nanogpt"],
        entries: {
          nanogpt: {
            enabled: true,
            config: pluginConfig,
          },
        },
      },
    },
    workspaceDir,
    env: mergeProcessEnv({
      OPENCLAW_TEST_ONLY_PROVIDER_PLUGIN_IDS: "nanogpt",
      VITEST: "1",
      NODE_ENV: "test",
    }),
    onlyPluginIds: ["nanogpt"],
  });

  return providers.find((provider) => provider.id === "nanogpt");
}

describe("NanoGPT OpenClaw discovery integration", () => {
  it(
    "returns discovered NanoGPT models through the OpenClaw provider catalog hook",
    async () => {
      const { workspaceDir, packageDir } = stageNanoGptWorkspace();
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

      const provider = await loadNanoGptCatalogProvider(workspaceDir);
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
        agentDir: packageDir,
        workspaceDir,
        env: mergeProcessEnv({
          OPENCLAW_TEST_ONLY_PROVIDER_PLUGIN_IDS: "nanogpt",
          VITEST: "1",
          NODE_ENV: "test",
        }),
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

  it("does not serialize a placeholder Authorization header through the discovery hook result", async () => {
    const { workspaceDir, packageDir } = stageNanoGptWorkspace();
    const fetchMock = vi
      .fn()
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          supportsProviderSelection: true,
          providers: [
            {
              provider: "openrouter",
              available: true,
              pricing: {
                inputPer1kTokens: 0.00042,
                outputPer1kTokens: 0.0018375,
                unit: "per_1k_tokens",
              },
            },
          ],
        }),
      });
    vi.stubGlobal("fetch", fetchMock);

    const provider = await loadNanoGptCatalogProviderWithPluginConfig(workspaceDir, {
      routingMode: "subscription",
      catalogSource: "subscription",
      provider: "openrouter",
    });
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
                routingMode: "subscription",
                catalogSource: "subscription",
                provider: "openrouter",
              },
            },
          },
        },
      },
      agentDir: packageDir,
      workspaceDir,
      env: mergeProcessEnv({
        OPENCLAW_TEST_ONLY_PROVIDER_PLUGIN_IDS: "nanogpt",
        VITEST: "1",
        NODE_ENV: "test",
      }),
      resolveProviderApiKey: () => ({ apiKey: "NANOGPT_API_KEY" }),
      resolveProviderAuth: () => ({
        apiKey: "NANOGPT_API_KEY",
        discoveryApiKey: "NANOGPT_API_KEY",
        mode: "api_key",
        source: "env",
      }),
    });

    const providers = normalizePluginDiscoveryResult({
      provider: provider!,
      result,
    });
    const nanogptProvider = providers.nanogpt as Record<string, unknown> | undefined;
    const serializedProvider = JSON.stringify({ providers: { nanogpt: nanogptProvider } });

    expect(nanogptProvider).toMatchObject({
      api: "openai-completions",
      apiKey: "NANOGPT_API_KEY",
      baseUrl: "https://nano-gpt.com/api/subscription/v1",
    });
    expect(nanogptProvider?.headers).toBeUndefined();
    expect(serializedProvider).not.toContain("Authorization");
    expect(serializedProvider).not.toContain("Bearer NANOGPT_API_KEY");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://nano-gpt.com/api/subscription/v1/models?detailed=true",
    );
  });
});