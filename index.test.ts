import { describe, expect, it } from "vitest";
import plugin from "./index.js";

describe("nanogpt plugin entry", () => {
  function getRegisteredProvider() {
    const providers: unknown[] = [];
    plugin.register(
      {
        pluginConfig: {},
        registerProvider(provider: unknown) {
          providers.push(provider);
        },
        registerWebSearchProvider() {},
        registerImageGenerationProvider() {},
      } as never,
    );
    return providers[0] as {
      applyNativeStreamingUsageCompat?: (ctx: {
        providerConfig: {
          api: string;
          baseUrl?: string;
          models?: Array<Record<string, unknown>>;
        };
      }) => unknown;
      normalizeModelId?: (ctx: { modelId: string }) => string;
      resolveUsageAuth?: unknown;
      fetchUsageSnapshot?: unknown;
    };
  }

  function getRegisteredProviderWithAuth() {
    const providers: unknown[] = [];
    plugin.register(
      {
        pluginConfig: {},
        registerProvider(provider: unknown) {
          providers.push(provider);
        },
        registerWebSearchProvider() {},
        registerImageGenerationProvider() {},
      } as never,
    );
    return providers[0] as {
      auth?: Array<{
        runNonInteractive?: (ctx: {
          opts?: Record<string, unknown>;
          config: Record<string, unknown>;
          env: Record<string, string | undefined>;
          agentDir: string;
          resolveApiKey: () => Promise<{ source: string } | null>;
          toApiKeyCredential: () => unknown;
        }) => Promise<Record<string, unknown> | null>;
      }>;
    };
  }

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
    expect((providers[0] as { applyNativeStreamingUsageCompat?: unknown }).applyNativeStreamingUsageCompat).toEqual(
      expect.any(Function),
    );
  });

  it("opts NanoGPT completions models into streaming usage compatibility", () => {
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
    expect(result?.models[1]?.compat?.supportsUsageInStreaming).toBe(true);
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

  it("normalizes known NanoGPT website aliases to live API catalog ids", () => {
    const provider = getRegisteredProvider();

    expect(provider.normalizeModelId).toEqual(expect.any(Function));
    expect(provider.normalizeModelId?.({ modelId: "moonshotai/kimi-k2.5:thinking" })).toBe(
      "moonshotai/Kimi-K2-Instruct-0905",
    );
    expect(provider.normalizeModelId?.({ modelId: "moonshotai/kimi-k2-instruct-0905" })).toBe(
      "moonshotai/Kimi-K2-Instruct-0905",
    );
    expect(provider.normalizeModelId?.({ modelId: "gpt-5.4-mini" })).toBe("gpt-5.4-mini");
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
});
