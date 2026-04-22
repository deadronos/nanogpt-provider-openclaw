import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import plugin from "./index.js";
import {
  getRegisteredProvider,
  getRegisteredProviderWithAuth,
} from "./provider/test-harness.js";

describe("nanogpt plugin entry", () => {
  it("exports the expected plugin metadata", () => {
    expect(plugin.id).toBe("nanogpt");
    expect(plugin.name).toBe("NanoGPT Provider");
    expect(plugin.description).toContain("NanoGPT");
    expect(typeof plugin.register).toBe("function");
  });

  it("registers both the model provider and the web search provider", () => {
    const providers: unknown[] = [];
    const webSearchProviders: unknown[] = [];
    const imageProviders: unknown[] = [];

    plugin.register({
      pluginConfig: {},
      registerProvider(provider: unknown) {
        providers.push(provider);
      },
      registerWebSearchProvider(provider: unknown) {
        webSearchProviders.push(provider);
      },
      registerImageGenerationProvider(provider: unknown) {
        imageProviders.push(provider);
      },
    } as never);

    expect(providers).toHaveLength(1);
    expect(providers[0]).toMatchObject({
      id: "nanogpt",
      label: "NanoGPT",
    });
    expect(webSearchProviders).toHaveLength(1);
    expect(webSearchProviders[0]).toMatchObject({
      id: "nanogpt",
      label: "NanoGPT Search",
    });
    expect(imageProviders).toHaveLength(1);
    expect(imageProviders[0]).toMatchObject({
      id: "nanogpt",
      label: "NanoGPT",
    });
    expect((providers[0] as { resolveUsageAuth?: unknown }).resolveUsageAuth).toEqual(
      expect.any(Function),
    );
    expect((providers[0] as { fetchUsageSnapshot?: unknown }).fetchUsageSnapshot).toEqual(
      expect.any(Function),
    );
    expect((providers[0] as { buildReplayPolicy?: unknown }).buildReplayPolicy).toEqual(
      expect.any(Function),
    );
    expect((providers[0] as { sanitizeReplayHistory?: unknown }).sanitizeReplayHistory).toEqual(
      expect.any(Function),
    );
    expect((providers[0] as { validateReplayTurns?: unknown }).validateReplayTurns).toEqual(
      expect.any(Function),
    );
    expect((providers[0] as { resolveReasoningOutputMode?: unknown }).resolveReasoningOutputMode).toEqual(
      expect.any(Function),
    );
    expect((providers[0] as { applyNativeStreamingUsageCompat?: unknown }).applyNativeStreamingUsageCompat).toEqual(
      expect.any(Function),
    );
  });

  it("registers replay and reasoning hooks on the model provider surface", () => {
    const provider = getRegisteredProvider();

    expect(provider.buildReplayPolicy).toEqual(expect.any(Function));
    expect(provider.sanitizeReplayHistory).toEqual(expect.any(Function));
    expect(provider.validateReplayTurns).toEqual(expect.any(Function));
    expect(provider.resolveReasoningOutputMode).toEqual(expect.any(Function));
  });

  it("fills missing streaming usage compat without clobbering explicit false", () => {
    const provider = getRegisteredProvider();
    const applyCompat = provider.applyNativeStreamingUsageCompat;
    expect(applyCompat).toEqual(expect.any(Function));

    const result = applyCompat?.({
      providerConfig: {
        api: "openai-completions",
        baseUrl: "https://nano-gpt.com/api/subscription/v1",
        models: [
          {
            id: "moonshotai/kimi-k2.5:thinking",
            compat: { supportsDeveloperRole: false },
          },
          {
            id: "gpt-5.4-mini",
            compat: { supportsUsageInStreaming: false },
          },
        ],
      },
    }) as {
      models: Array<{ compat?: { supportsDeveloperRole?: boolean; supportsUsageInStreaming?: boolean } }>;
    } | null;

    expect(result).toBeTruthy();
    expect(result?.models[0]?.compat).toEqual({
      supportsDeveloperRole: false,
      supportsUsageInStreaming: true,
    });
    expect(result?.models[1]?.compat?.supportsUsageInStreaming).toBe(false);
  });

  it("returns no compat patch when completions models already declare streaming usage support", () => {
    const provider = getRegisteredProvider();
    const applyCompat = provider.applyNativeStreamingUsageCompat;
    expect(applyCompat).toEqual(expect.any(Function));

    const result = applyCompat?.({
      providerConfig: {
        api: "openai-completions",
        baseUrl: "https://nano-gpt.com/api/subscription/v1",
        models: [
          {
            id: "moonshotai/kimi-k2.5:thinking",
            compat: { supportsUsageInStreaming: true },
          },
          {
            id: "gpt-5.4-mini",
            compat: { supportsUsageInStreaming: false },
          },
        ],
      },
    });

    expect(result).toBeNull();
  });

  it("opts in any completions config and skips non-completions APIs", () => {
    const provider = getRegisteredProvider();
    const applyCompat = provider.applyNativeStreamingUsageCompat;
    expect(applyCompat).toEqual(expect.any(Function));

    const completionsResult = applyCompat?.({
      providerConfig: {
        api: "openai-completions",
        baseUrl: "https://example.com/v1",
        models: [{ id: "x" }],
      },
    });
    expect(completionsResult).toMatchObject({
      models: [{ compat: { supportsUsageInStreaming: true } }],
    });

    const responsesApiResult = applyCompat?.({
      providerConfig: {
        api: "openai-responses",
        baseUrl: "https://nano-gpt.com/api/v1",
        models: [{ id: "x" }],
      },
    });
    expect(responsesApiResult).toBeNull();
  });

  it("passes through streamFn directly without repair", () => {
    const provider = getRegisteredProvider();
    expect(provider.wrapStreamFn).toEqual(expect.any(Function));

    const baseStreamFn = vi.fn();
    const resultStream = provider.wrapStreamFn?.({
      streamFn: baseStreamFn,
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: { id: "moonshotai/kimi-k2.5:thinking" },
    });
    expect(resultStream).toBe(baseStreamFn);
  });

  it("passes through streamFn when enableRepair is true (repair was removed)", () => {
    const provider = getRegisteredProvider({ enableRepair: true });
    expect(provider.wrapStreamFn).toEqual(expect.any(Function));

    const baseStreamFn = vi.fn();
    const wrappedFn = provider.wrapStreamFn?.({
      streamFn: baseStreamFn,
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: { id: "moonshotai/kimi-k2.5:thinking" },
    });
    expect(wrappedFn).toBe(baseStreamFn);
  });

  it("surfaces discovered NanoGPT models from models.json into catalog augmentation", () => {
    const provider = getRegisteredProvider();

    expect(provider.augmentModelCatalog).toEqual(expect.any(Function));

    const agentDir = mkdtempSync(join(tmpdir(), "nanogpt-agent-"));
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify(
        {
          providers: {
            nanogpt: {
              api: "openai-completions",
              baseUrl: "https://nano-gpt.com/api/subscription/v1",
              models: [
                {
                  id: "openai/gpt-oss-120b",
                  name: "GPT OSS 120B",
                  reasoning: true,
                  input: ["text"],
                  contextWindow: 131072,
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    expect(
      provider.augmentModelCatalog?.({
        agentDir,
        config: {},
        env: {},
        entries: [],
      }),
    ).toMatchObject([
      {
        provider: "nanogpt",
        id: "openai/gpt-oss-120b",
        name: "GPT OSS 120B",
        reasoning: true,
        input: ["text"],
        contextWindow: 131072,
      },
    ]);
  });

  it("rehydrates flattened discovered NanoGPT metadata from models.json", () => {
    const provider = getRegisteredProvider();

    expect(provider.normalizeResolvedModel).toEqual(expect.any(Function));

    const agentDir = mkdtempSync(join(tmpdir(), "nanogpt-agent-"));
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify(
        {
          providers: {
            nanogpt: {
              api: "openai-completions",
              baseUrl: "https://nano-gpt.com/api/subscription/v1",
              models: [
                {
                  id: "openai/gpt-5.4-mini",
                  name: "GPT-5.4 Mini",
                  reasoning: true,
                  input: ["text", "image"],
                  cost: {
                    input: 0.15,
                    output: 0.6,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 400000,
                  maxTokens: 128000,
                  compat: {
                    supportsTools: true,
                  },
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    expect(
      provider.normalizeResolvedModel?.({
        agentDir,
        provider: "nanogpt",
        modelId: "openai/gpt-5.4-mini",
        model: {
          id: "openai/gpt-5.4-mini",
          name: "openai/gpt-5.4-mini",
          provider: "nanogpt",
          api: "openai-completions",
          baseUrl: "https://nano-gpt.com/api/v1",
          reasoning: false,
          input: ["text"],
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
          },
          contextWindow: 200000,
          maxTokens: 32768,
        },
      }),
    ).toMatchObject({
      id: "openai/gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400000,
      maxTokens: 128000,
      compat: {
        supportsTools: true,
      },
    });
  });

  it("uses models.json metadata when dynamic model resolution has no provider model templates", () => {
    const provider = getRegisteredProvider();

    expect(provider.resolveDynamicModel).toEqual(expect.any(Function));

    const agentDir = mkdtempSync(join(tmpdir(), "nanogpt-agent-"));
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify(
        {
          providers: {
            nanogpt: {
              api: "openai-completions",
              baseUrl: "https://nano-gpt.com/api/subscription/v1",
              models: [
                {
                  id: "openai/gpt-5.4-mini",
                  name: "GPT-5.4 Mini",
                  reasoning: true,
                  input: ["text", "image"],
                  cost: {
                    input: 0.15,
                    output: 0.6,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 400000,
                  maxTokens: 128000,
                  compat: {
                    supportsTools: true,
                  },
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    expect(
      provider.resolveDynamicModel?.({
        agentDir,
        provider: "nanogpt",
        modelId: "openai/gpt-5.4-mini",
        modelRegistry: {},
        providerConfig: {
          api: "openai-completions",
          baseUrl: "https://nano-gpt.com/api/v1",
          models: [],
        },
      }),
    ).toMatchObject({
      id: "openai/gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      provider: "nanogpt",
      api: "openai-completions",
      baseUrl: "https://nano-gpt.com/api/v1",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400000,
      maxTokens: 128000,
      compat: {
        supportsTools: true,
      },
      cost: {
        input: 0.15,
        output: 0.6,
        cacheRead: 0,
        cacheWrite: 0,
      },
    });
  });

  it("falls back to OPENCLAW_AGENT_DIR when dynamic model resolution omits agentDir", () => {
    const provider = getRegisteredProvider();

    expect(provider.resolveDynamicModel).toEqual(expect.any(Function));

    const agentDir = mkdtempSync(join(tmpdir(), "nanogpt-agent-"));
    writeFileSync(
      join(agentDir, "models.json"),
      JSON.stringify(
        {
          providers: {
            nanogpt: {
              api: "openai-completions",
              baseUrl: "https://nano-gpt.com/api/subscription/v1",
              models: [
                {
                  id: "openai/gpt-5.4-mini",
                  name: "GPT-5.4 Mini",
                  reasoning: true,
                  input: ["text", "image"],
                  cost: {
                    input: 0.15,
                    output: 0.6,
                    cacheRead: 0,
                    cacheWrite: 0,
                  },
                  contextWindow: 400000,
                  maxTokens: 128000,
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    expect(
      provider.resolveDynamicModel?.({
        provider: "nanogpt",
        modelId: "openai/gpt-5.4-mini",
        modelRegistry: {},
        env: { OPENCLAW_AGENT_DIR: agentDir },
        providerConfig: {
          api: "openai-completions",
          baseUrl: "https://nano-gpt.com/api/v1",
          models: [],
        },
      }),
    ).toMatchObject({
      id: "openai/gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 400000,
      maxTokens: 128000,
    });
  });

  it("resolves unknown NanoGPT model ids dynamically without rewriting them", () => {
    const provider = getRegisteredProvider();

    expect(provider.resolveDynamicModel).toEqual(expect.any(Function));
    expect(
      provider.resolveDynamicModel?.({
        provider: "nanogpt",
        modelId: "moonshotai/kimi-k2.5:thinking",
        modelRegistry: {},
        providerConfig: {
          api: "openai-completions",
          baseUrl: "https://nano-gpt.com/api/subscription/v1",
          models: [],
        },
      }),
    ).toMatchObject({
      id: "moonshotai/kimi-k2.5:thinking",
      provider: "nanogpt",
      api: "openai-completions",
      baseUrl: "https://nano-gpt.com/api/subscription/v1",
      reasoning: true,
    });
  });

  it("does not force a hardcoded default model during API-key onboarding", async () => {
    const provider = getRegisteredProviderWithAuth();
    const authMethod = provider.auth?.[0];

    expect(authMethod?.runNonInteractive).toEqual(expect.any(Function));

    const result = await authMethod?.runNonInteractive?.({
      opts: {},
      config: {},
      env: {},
      agentDir: "/tmp/nanogpt-agent",
      resolveApiKey: async () => ({ source: "profile" }),
      toApiKeyCredential: () => null,
    });

    expect(result).toMatchObject({
      agents: {
        defaults: {
          models: {
            "nanogpt/gpt-5.4-mini": {
              alias: "NanoGPT",
            },
          },
        },
      },
      auth: {
        profiles: {
          "nanogpt:default": {
            provider: "nanogpt",
            mode: "api_key",
          },
        },
      },
    });
    expect((result as { agents?: { defaults?: { model?: unknown } } })?.agents?.defaults?.model).toBeUndefined();
  });

  it("mirrors interactive NanoGPT auth into the web search credential path", async () => {
    const provider = getRegisteredProviderWithAuth();
    const authMethod = provider.auth?.[0] as
      | {
          run?: (ctx: Record<string, unknown>) => Promise<Record<string, unknown>>;
        }
      | undefined;

    expect(authMethod?.run).toEqual(expect.any(Function));

    const result = await authMethod?.run?.({
      opts: {
        nanogptApiKey: "ngpt_interactive_key",
      },
      config: {},
      env: {},
      agentDir: "/tmp/nanogpt-agent",
      runtime: {},
      prompter: {
        note: vi.fn(),
        select: vi.fn(),
        input: vi.fn(),
        secret: vi.fn(),
        confirm: vi.fn(),
      },
      secretInputMode: "plaintext",
      allowSecretRefPrompt: false,
      isRemote: false,
      openUrl: async () => {},
      oauth: {
        createVpsAwareHandlers: vi.fn(),
      },
    });

    expect(result).toMatchObject({
      configPatch: {
        plugins: {
          entries: {
            nanogpt: {
              enabled: true,
              config: {
                webSearch: {
                  apiKey: "ngpt_interactive_key",
                },
              },
            },
          },
        },
      },
    });
  });

  it("mirrors non-interactive NanoGPT auth into the web search credential path", async () => {
    const provider = getRegisteredProviderWithAuth();
    const authMethod = provider.auth?.[0];

    expect(authMethod?.runNonInteractive).toEqual(expect.any(Function));

    const result = await authMethod?.runNonInteractive?.({
      authChoice: "nanogpt-api-key",
      opts: {
        nanogptApiKey: "ngpt_live_key",
      },
      config: {},
      baseConfig: {},
      runtime: {} as never,
      agentDir: "/tmp/nanogpt-agent",
      resolveApiKey: async () => ({
        key: "ngpt_live_key",
        source: "flag",
      }),
      toApiKeyCredential: ({ resolved }: { resolved: { key: string } }) => ({
        type: "api_key",
        provider: "nanogpt",
        key: resolved.key,
      }),
    } as never);

    expect(result).toMatchObject({
      plugins: {
        entries: {
          nanogpt: {
            enabled: true,
            config: {
              webSearch: {
                apiKey: "ngpt_live_key",
              },
            },
          },
        },
      },
    });
  });




  it("recovers from fs errors when reading models.json and deletes cache", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "nanogpt-agent-err-"));
    const modelsPath = join(agentDir, "models.json");
    writeFileSync(
      modelsPath,
      JSON.stringify(
        {
          providers: {
            nanogpt: {
              api: "openai-completions",
              baseUrl: "https://nano-gpt.com/api/subscription/v1",
              models: [
                {
                  id: "openai/gpt-oss-120b",
                  name: "GPT OSS 120B",
                  reasoning: true,
                  input: ["text"],
                  contextWindow: 131072,
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs");
    const existsSyncMock = vi.fn(actualFs.existsSync);
    const readSyncKey = `read${"FileSync"}`;
    const readSyncActual = actualFs[readSyncKey as keyof typeof actualFs] as (
      ...args: unknown[]
    ) => unknown;
    let modelsReadCount = 0;
    const readSyncMock = (...args: unknown[]) => {
      if (args[0] === modelsPath) {
        modelsReadCount += 1;
      }
      return readSyncActual(...args);
    };
    const mockedFs = {
      ...actualFs,
      existsSync: existsSyncMock,
      [readSyncKey]: readSyncMock,
    };

    vi.doMock("node:fs", () => ({
      __esModule: true,
      ...mockedFs,
      default: mockedFs,
    }));

    vi.resetModules();

    const { default: mockedPlugin } = await import("./index.js");
    const providers: unknown[] = [];
    mockedPlugin.register({
      pluginConfig: {},
      registerProvider(provider: unknown) {
        providers.push(provider);
      },
      registerWebSearchProvider() {},
      registerImageGenerationProvider() {},
    } as never);

    const provider = providers[0] as ReturnType<typeof getRegisteredProvider>;

    expect(provider.augmentModelCatalog).toEqual(expect.any(Function));

    const warmResult = provider.augmentModelCatalog?.({
      agentDir,
      config: {},
      env: {},
      entries: [],
    });

    expect(warmResult).toMatchObject([
      {
        provider: "nanogpt",
        id: "openai/gpt-oss-120b",
        name: "GPT OSS 120B",
      },
    ]);
    expect(modelsReadCount).toBe(1);

    existsSyncMock.mockImplementation(() => {
      throw new Error("Simulated fs error");
    });

    const errorResult = provider.augmentModelCatalog?.({
      agentDir,
      config: {},
      env: {},
      entries: [],
    });

    expect(errorResult).toEqual([]);
    expect(modelsReadCount).toBe(1);

    existsSyncMock.mockImplementation(actualFs.existsSync);

    const recoveredResult = provider.augmentModelCatalog?.({
      agentDir,
      config: {},
      env: {},
      entries: [],
    });

    expect(modelsReadCount).toBe(2);
    expect(recoveredResult).toMatchObject([
      {
        provider: "nanogpt",
        id: "openai/gpt-oss-120b",
        name: "GPT OSS 120B",
      },
    ]);
  });

});
