import { describe, expect, it } from "vitest";
import plugin from "./index.js";

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
  });
});
