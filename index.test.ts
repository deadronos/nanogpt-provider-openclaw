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
      resolveUsageAuth?: unknown;
      fetchUsageSnapshot?: unknown;
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
});
