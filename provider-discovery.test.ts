import { describe, expect, it, vi, beforeEach } from "vitest";
import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
import nanoGptProviderDiscovery from "./provider-discovery.js";
import { buildNanoGptProvider } from "./provider-catalog.js";
import { NANOGPT_PROVIDER_ID } from "./models.js";

vi.mock("./provider-catalog.js", () => ({
  buildNanoGptProvider: vi.fn(),
}));

describe("nanoGptProviderDiscovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exports correct provider metadata", () => {
    expect(nanoGptProviderDiscovery.id).toBe(NANOGPT_PROVIDER_ID);
    expect(nanoGptProviderDiscovery.label).toBe("NanoGPT");
    expect(nanoGptProviderDiscovery.docsPath).toBe("/providers/models");
    expect(nanoGptProviderDiscovery.auth).toEqual([]);
    expect(nanoGptProviderDiscovery.catalog.order).toBe("simple");
  });

  describe("catalog.run", () => {
    it("returns null when API key is missing", async () => {
      const ctx = {
        config: {},
        resolveProviderApiKey: vi.fn().mockReturnValue({ apiKey: undefined }),
      } as unknown as ProviderCatalogContext;

      const result = await nanoGptProviderDiscovery.catalog.run(ctx);

      expect(result).toBeNull();
      expect(ctx.resolveProviderApiKey).toHaveBeenCalledWith(NANOGPT_PROVIDER_ID);
      expect(buildNanoGptProvider).not.toHaveBeenCalled();
    });

    it("returns provider when API key is present", async () => {
      const mockProvider = { models: [] };
      vi.mocked(buildNanoGptProvider).mockResolvedValue(mockProvider as any);

      const ctx = {
        config: {},
        resolveProviderApiKey: vi.fn().mockReturnValue({ apiKey: "test-key" }),
      } as unknown as ProviderCatalogContext;

      const result = await nanoGptProviderDiscovery.catalog.run(ctx);

      expect(result).toEqual({ provider: mockProvider });
      expect(buildNanoGptProvider).toHaveBeenCalledWith({
        apiKey: "test-key",
        pluginConfig: undefined,
      });
    });

    it("extracts and passes plugin config correctly", async () => {
      const mockProvider = { models: [] };
      const pluginConfig = { routingMode: "paygo" };
      vi.mocked(buildNanoGptProvider).mockResolvedValue(mockProvider as any);

      const ctx = {
        config: {
          plugins: {
            entries: {
              [NANOGPT_PROVIDER_ID]: {
                config: pluginConfig,
              },
            },
          },
        },
        resolveProviderApiKey: vi.fn().mockReturnValue({ apiKey: "test-key" }),
      } as unknown as ProviderCatalogContext;

      const result = await nanoGptProviderDiscovery.catalog.run(ctx);

      expect(result).toEqual({ provider: mockProvider });
      expect(buildNanoGptProvider).toHaveBeenCalledWith({
        apiKey: "test-key",
        pluginConfig,
      });
    });

    it("handles missing plugin config gracefully", async () => {
      const mockProvider = { models: [] };
      vi.mocked(buildNanoGptProvider).mockResolvedValue(mockProvider as any);

      const ctx = {
        config: {
          plugins: {
            entries: {
              other_provider: {
                config: { foo: "bar" },
              },
            },
          },
        },
        resolveProviderApiKey: vi.fn().mockReturnValue({ apiKey: "test-key" }),
      } as unknown as ProviderCatalogContext;

      const result = await nanoGptProviderDiscovery.catalog.run(ctx);

      expect(result).toEqual({ provider: mockProvider });
      expect(buildNanoGptProvider).toHaveBeenCalledWith({
        apiKey: "test-key",
        pluginConfig: undefined,
      });
    });
  });
});
