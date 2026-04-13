import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveApiKeyForProviderMock } = vi.hoisted(() => ({
  resolveApiKeyForProviderMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/provider-auth-runtime", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/provider-auth-runtime")>(
    "openclaw/plugin-sdk/provider-auth-runtime",
  );

  return {
    ...actual,
    resolveApiKeyForProvider: resolveApiKeyForProviderMock,
  };
});

import { buildNanoGptImageGenerationProvider } from "./image-generation-provider.js";
import plugin from "./index.js";

afterEach(() => {
  resolveApiKeyForProviderMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function mockNanoGptApiKey(): void {
  resolveApiKeyForProviderMock.mockResolvedValue({
    apiKey: "test-key",
    source: "env",
    mode: "api_key",
  });
}

describe("nanogpt image-generation provider", () => {
  it("registers the nanogpt image generation provider", () => {
    const imageProviders: unknown[] = [];

    plugin.register({
      pluginConfig: {},
      registerProvider() {},
      registerWebSearchProvider() {},
      registerImageGenerationProvider(provider: unknown) {
        imageProviders.push(provider);
      },
    } as never);

    expect(imageProviders).toHaveLength(1);
    expect(imageProviders[0]).toMatchObject({
      id: "nanogpt",
      label: "NanoGPT",
      defaultModel: "hidream",
    });
  });

  it("generates image buffers from NanoGPT's OpenAI-compatible endpoint", async () => {
    mockNanoGptApiKey();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          created: 123,
          data: [
            {
              b64_json: Buffer.from("png-data").toString("base64"),
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const provider = buildNanoGptImageGenerationProvider();
    const result = await provider.generateImage({
      provider: "nanogpt",
      model: "hidream",
      prompt: "draw a cat",
      cfg: {},
      count: 2,
      size: "1024x1024",
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://nano-gpt.com/v1/images/generations",
      expect.objectContaining({
        method: "POST",
        headers: {
          Authorization: "Bearer test-key",
          "Content-Type": "application/json",
        },
      }),
    );
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      model: "hidream",
      prompt: "draw a cat",
      n: 2,
      response_format: "b64_json",
      size: "1024x1024",
    });
    expect(result).toEqual({
      images: [
        {
          buffer: Buffer.from("png-data"),
          mimeType: "image/png",
          fileName: "image-1.png",
        },
      ],
      model: "hidream",
    });
  });

  it("maps input images to NanoGPT imageDataUrl for edit flows", async () => {
    mockNanoGptApiKey();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          created: 123,
          data: [
            {
              b64_json: Buffer.from("edited-data").toString("base64"),
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const provider = buildNanoGptImageGenerationProvider();
    await provider.generateImage({
      provider: "nanogpt",
      model: "hidream",
      prompt: "turn this into a watercolor poster",
      cfg: {},
      inputImages: [
        {
          buffer: Buffer.from("source-image"),
          mimeType: "image/jpeg",
          fileName: "source.jpg",
        },
      ],
    });

    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "hidream",
      prompt: "turn this into a watercolor poster",
      n: 1,
      response_format: "b64_json",
      imageDataUrl: `data:image/jpeg;base64,${Buffer.from("source-image").toString("base64")}`,
    });
  });

  it("normalizes friendly subscription model aliases to curated NanoGPT ids", async () => {
    mockNanoGptApiKey();
    const fetchSpy = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              b64_json: Buffer.from("alias-data").toString("base64"),
            },
          ],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const provider = buildNanoGptImageGenerationProvider();
    const result = await provider.generateImage({
      provider: "nanogpt",
      model: "QWEN IMAGE",
      prompt: "cinematic skyline",
      cfg: {},
    });

    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "qwen-image-2512",
      prompt: "cinematic skyline",
    });
    expect(result.model).toBe("qwen-image-2512");
  });

  it("surfaces curated model guidance when NanoGPT rejects an image model id", async () => {
    mockNanoGptApiKey();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Unknown model", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const provider = buildNanoGptImageGenerationProvider();

    await expect(
      provider.generateImage({
        provider: "nanogpt",
        model: "qwen-image",
        prompt: "test prompt",
        cfg: {},
      }),
    ).rejects.toThrow(
      /Try one of: hidream, chroma, z-image-turbo, qwen-image-2512/i,
    );
  });

  it("throws an error when an invalid image size is provided", async () => {
    mockNanoGptApiKey();

    const provider = buildNanoGptImageGenerationProvider();

    await expect(
      provider.generateImage({
        provider: "nanogpt",
        model: "hidream",
        prompt: "test prompt",
        cfg: {},
        size: "9999x9999" as any,
      }),
    ).rejects.toThrow(/Invalid image size "9999x9999"/);
  });
});
