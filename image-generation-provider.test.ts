import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveApiKeyForProviderMock } = vi.hoisted(() => ({
  resolveApiKeyForProviderMock: vi.fn(),
}));

const { postJsonRequestMock, assertOkOrThrowHttpErrorMock } = vi.hoisted(() => ({
  postJsonRequestMock: vi.fn(),
  assertOkOrThrowHttpErrorMock: vi.fn(),
}));

const { isProviderApiKeyConfiguredMock } = vi.hoisted(() => ({
  isProviderApiKeyConfiguredMock: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/provider-auth", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/provider-auth")>(
    "openclaw/plugin-sdk/provider-auth",
  );

  return {
    ...actual,
    isProviderApiKeyConfigured: isProviderApiKeyConfiguredMock,
    resolveApiKeyForProvider: resolveApiKeyForProviderMock,
  };
});

vi.mock("openclaw/plugin-sdk/provider-http", async () => {
  const actual = await vi.importActual<typeof import("openclaw/plugin-sdk/provider-http")>(
    "openclaw/plugin-sdk/provider-http",
  );

  return {
    ...actual,
    postJsonRequest: postJsonRequestMock,
    assertOkOrThrowHttpError: assertOkOrThrowHttpErrorMock,
  };
});

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
  postJsonRequestMock.mockReset();
  assertOkOrThrowHttpErrorMock.mockReset();
  isProviderApiKeyConfiguredMock.mockReset();
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

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      clone: vi.fn().mockReturnThis(),
      text: vi.fn().mockResolvedValue(""),
      json: vi.fn().mockResolvedValue({
        created: 123,
        data: [{ b64_json: Buffer.from("png-data").toString("base64") }],
      }),
    } as unknown as Response;

    postJsonRequestMock.mockResolvedValue({
      response: mockResponse,
      release: vi.fn(),
    });

    const provider = buildNanoGptImageGenerationProvider();
    const result = await provider.generateImage({
      provider: "nanogpt",
      model: "hidream",
      prompt: "draw a cat",
      cfg: {},
      count: 2,
      size: "1024x1024",
    });

    expect(postJsonRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://nano-gpt.com/v1/images/generations",
        body: {
          model: "hidream",
          prompt: "draw a cat",
          n: 2,
          response_format: "b64_json",
          size: "1024x1024",
        },
      }),
    );
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

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      clone: vi.fn().mockReturnThis(),
      text: vi.fn().mockResolvedValue(""),
      json: vi.fn().mockResolvedValue({
        data: [{ b64_json: Buffer.from("edited-data").toString("base64") }],
      }),
    } as unknown as Response;

    postJsonRequestMock.mockResolvedValue({
      response: mockResponse,
      release: vi.fn(),
    });

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

    expect(postJsonRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          model: "hidream",
          prompt: "turn this into a watercolor poster",
          n: 1,
          response_format: "b64_json",
          imageDataUrl: `data:image/jpeg;base64,${Buffer.from("source-image").toString("base64")}`,
        }),
      }),
    );
  });

  it("normalizes friendly subscription model aliases to curated NanoGPT ids", async () => {
    mockNanoGptApiKey();

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      clone: vi.fn().mockReturnThis(),
      text: vi.fn().mockResolvedValue(""),
      json: vi.fn().mockResolvedValue({
        data: [{ b64_json: Buffer.from("alias-data").toString("base64") }],
      }),
    } as unknown as Response;

    postJsonRequestMock.mockResolvedValue({
      response: mockResponse,
      release: vi.fn(),
    });

    const provider = buildNanoGptImageGenerationProvider();
    const result = await provider.generateImage({
      provider: "nanogpt",
      model: "QWEN IMAGE",
      prompt: "cinematic skyline",
      cfg: {},
    });

    expect(postJsonRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          model: "qwen-image-2512",
          prompt: "cinematic skyline",
        }),
      }),
    );
    expect(result.model).toBe("qwen-image-2512");
  });

  it("accepts provider-prefixed model overrides like nanogpt/chroma", async () => {
    mockNanoGptApiKey();

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      clone: vi.fn().mockReturnThis(),
      text: vi.fn().mockResolvedValue(""),
      json: vi.fn().mockResolvedValue({
        data: [{ b64_json: Buffer.from("chroma-data").toString("base64") }],
      }),
    } as unknown as Response;

    postJsonRequestMock.mockResolvedValue({
      response: mockResponse,
      release: vi.fn(),
    });

    const provider = buildNanoGptImageGenerationProvider();
    const result = await provider.generateImage({
      provider: "nanogpt",
      model: "nanogpt/chroma",
      prompt: "debugging in neon rain",
      cfg: {},
    });

    expect(postJsonRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          model: "chroma",
          prompt: "debugging in neon rain",
        }),
      }),
    );
    expect(result.model).toBe("chroma");
  });

  it("surfaces curated model guidance when NanoGPT rejects an image model id", async () => {
    mockNanoGptApiKey();

    const mockResponse = {
      ok: false,
      status: 400,
      statusText: "Bad Request",
      clone: vi.fn().mockReturnThis(),
      text: vi.fn().mockResolvedValue("Unknown model"),
      json: vi.fn().mockRejectedValue(new Error("not json")),
    } as unknown as Response;

    postJsonRequestMock.mockResolvedValue({
      response: mockResponse,
      release: vi.fn(),
    });

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

  it("reports configured when API key is available", async () => {
    isProviderApiKeyConfiguredMock.mockResolvedValue(true);
    mockNanoGptApiKey();
    const provider = buildNanoGptImageGenerationProvider();
    expect(typeof provider.isConfigured).toBe("function");
    const result = await provider.isConfigured!({ agentDir: "/test/agent" } as any);
    expect(result).toBe(true);
  });

  it("reports not configured when API key is unavailable", async () => {
    isProviderApiKeyConfiguredMock.mockResolvedValue(false);
    resolveApiKeyForProviderMock.mockResolvedValue({ apiKey: undefined });
    const provider = buildNanoGptImageGenerationProvider();
    const result = await provider.isConfigured!({ agentDir: "/test/agent" } as any);
    expect(result).toBe(false);
  });

  it("honors req.timeoutMs when set", async () => {
    mockNanoGptApiKey();

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      clone: vi.fn().mockReturnThis(),
      text: vi.fn().mockResolvedValue(""),
      json: vi.fn().mockResolvedValue({
        data: [{ b64_json: Buffer.from("png-data").toString("base64") }],
      }),
    } as unknown as Response;

    postJsonRequestMock.mockResolvedValue({
      response: mockResponse,
      release: vi.fn(),
    });

    const provider = buildNanoGptImageGenerationProvider();
    await provider.generateImage({
      provider: "nanogpt",
      model: "hidream",
      prompt: "draw a cat",
      cfg: {},
      timeoutMs: 5000,
    } as any);

    expect(postJsonRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 5000,
      }),
    );
  });

  it("throws an error when the prompt is too long", async () => {
    mockNanoGptApiKey();

    const provider = buildNanoGptImageGenerationProvider();

    await expect(async () => {
      await provider.generateImage({
        provider: "nanogpt",
        model: "hidream",
        prompt: "a".repeat(4001),
        cfg: {},
      });
    }).rejects.toThrow("Image prompt is too long (maximum 4000 characters).");
  });

  it("falls back to default timeout when req.timeoutMs is not set", async () => {
    mockNanoGptApiKey();

    const mockResponse = {
      ok: true,
      status: 200,
      statusText: "OK",
      clone: vi.fn().mockReturnThis(),
      text: vi.fn().mockResolvedValue(""),
      json: vi.fn().mockResolvedValue({
        data: [{ b64_json: Buffer.from("png-data").toString("base64") }],
      }),
    } as unknown as Response;

    postJsonRequestMock.mockResolvedValue({
      response: mockResponse,
      release: vi.fn(),
    });

    const provider = buildNanoGptImageGenerationProvider();
    await provider.generateImage({
      provider: "nanogpt",
      model: "hidream",
      prompt: "draw a cat",
      cfg: {},
    } as any);

    expect(postJsonRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 60_000,
      }),
    );
  });
});
