import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import {
  buildNanogptProvidersBlock,
  mergeModelsJsonProvidersNanogpt,
  scheduleNanogptProviderCatalogPersistence,
  writeNanogptProviderCatalogToModelsJson,
} from "./discovery-persistence.js";
import { NANOGPT_PROVIDER_ID } from "../models.js";
import { buildNanoGptProvider } from "../catalog/build-provider.js";

vi.mock("../catalog/build-provider.js", () => ({
  buildNanoGptProvider: vi.fn(),
}));

/**
 * Cast arbitrary shapes to `ModelProviderConfig` for defensive-input tests.
 * `buildNanogptProvidersBlock` is supposed to return `null` for any malformed
 * config, so the cast keeps the test focused on the defensive behavior
 * rather than the type contract.
 */
function asConfig(value: unknown): ModelProviderConfig {
  return value as ModelProviderConfig;
}

const mockedBuild = vi.mocked(buildNanoGptProvider);

const tempPaths: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nanogpt-persistence-"));
  tempPaths.push(dir);
  return dir;
}

afterEach(() => {
  while (tempPaths.length > 0) {
    const p = tempPaths.pop();
    if (p) {
      fs.rmSync(p, { recursive: true, force: true });
    }
  }
  vi.clearAllMocks();
});

describe("buildNanogptProvidersBlock", () => {
  it("returns null when config is null", () => {
    expect(buildNanogptProvidersBlock({ config: null })).toBeNull();
  });

  it("returns null when config is undefined", () => {
    expect(buildNanogptProvidersBlock({ config: undefined })).toBeNull();
  });

  it("returns null when config.models is empty", () => {
    expect(
      buildNanogptProvidersBlock({ config: asConfig({ models: [] }) }),
    ).toBeNull();
  });

  it("returns null when config.models is missing", () => {
    expect(buildNanogptProvidersBlock({ config: asConfig({}) })).toBeNull();
  });

  it("builds a providers.nanogpt block from a real discovery result", () => {
    const block = buildNanogptProvidersBlock({
      config: {
        api: "openai-completions",
        baseUrl: "https://nano-gpt.com/api/subscription/v1",
        models: [
          {
            id: "deepseek/deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 1048576,
            maxTokens: 32768,
          },
          {
            id: "gpt-5.4-mini",
            name: "GPT-5.4 Mini",
            reasoning: true,
            input: ["text", "image"],
            cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            contextTokens: 4096,
            maxTokens: 32768,
            compat: { supportsTools: true },
            api: "openai-completions",
          },
        ],
      },
    });

    expect(block).toEqual({
      api: "openai-completions",
      baseUrl: "https://nano-gpt.com/api/subscription/v1",
      source: "live",
      schemaVersion: 1,
      models: [
        {
          id: "deepseek/deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1048576,
          maxTokens: 32768,
        },
        {
          id: "gpt-5.4-mini",
          name: "GPT-5.4 Mini",
          reasoning: true,
          input: ["text", "image"],
          cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 200000,
          contextTokens: 4096,
          maxTokens: 32768,
          compat: { supportsTools: true },
          api: "openai-completions",
        },
      ],
    });
  });
});

describe("mergeModelsJsonProvidersNanogpt", () => {
  it("preserves other providers when overwriting nanogpt", () => {
    const result = mergeModelsJsonProvidersNanogpt({
      existing: {
        providers: {
          anthropic: { models: [{ id: "claude-sonnet-4.6" }] },
          [NANOGPT_PROVIDER_ID]: { models: [{ id: "stale" }] },
        },
      },
      block: { source: "live", models: [{ id: "fresh" }] },
    });

    expect(result.changed).toBe(true);
    expect(result.providers).toEqual({
      anthropic: { models: [{ id: "claude-sonnet-4.6" }] },
      [NANOGPT_PROVIDER_ID]: { source: "live", models: [{ id: "fresh" }] },
    });
  });

  it("always reflects the new nanogpt block (no merge of model arrays)", () => {
    const result = mergeModelsJsonProvidersNanogpt({
      existing: {
        providers: {
          [NANOGPT_PROVIDER_ID]: {
            models: [{ id: "old-1" }, { id: "old-2" }],
          },
        },
      },
      block: { models: [{ id: "new-1" }] },
    });

    expect(result.providers[NANOGPT_PROVIDER_ID]).toEqual({
      models: [{ id: "new-1" }],
    });
  });

  it("removes nanogpt when block is null", () => {
    const result = mergeModelsJsonProvidersNanogpt({
      existing: {
        providers: {
          [NANOGPT_PROVIDER_ID]: { models: [{ id: "old" }] },
        },
      },
      block: null,
    });

    expect(result.changed).toBe(true);
    expect(result.providers[NANOGPT_PROVIDER_ID]).toBeUndefined();
  });

  it("reports unchanged when existing is already the same block", () => {
    const block = { models: [{ id: "x" }] };
    const result = mergeModelsJsonProvidersNanogpt({
      existing: { providers: { [NANOGPT_PROVIDER_ID]: block } },
      block,
    });

    expect(result.changed).toBe(false);
    expect(result.providers[NANOGPT_PROVIDER_ID]).toBe(block);
  });

  it("treats non-object existing as empty providers", () => {
    const result = mergeModelsJsonProvidersNanogpt({
      existing: null,
      block: { models: [{ id: "x" }] },
    });

    expect(result.providers).toEqual({
      [NANOGPT_PROVIDER_ID]: { models: [{ id: "x" }] },
    });
  });

  it("treats non-object providers as empty providers", () => {
    const result = mergeModelsJsonProvidersNanogpt({
      existing: { providers: "broken" },
      block: { models: [{ id: "x" }] },
    });

    expect(result.providers).toEqual({
      [NANOGPT_PROVIDER_ID]: { models: [{ id: "x" }] },
    });
  });
});

describe("writeNanogptProviderCatalogToModelsJson", () => {
  it("writes a new models.json when one does not exist", () => {
    const agentDir = makeTempDir();
    const write = writeNanogptProviderCatalogToModelsJson({
      agentDir,
      block: { models: [{ id: "fresh", contextWindow: 1048576 }] },
    });

    expect(write.ok).toBe(true);
    expect(write.changed).toBe(true);
    const written = JSON.parse(
      fs.readFileSync(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(written.providers[NANOGPT_PROVIDER_ID]).toEqual({
      models: [{ id: "fresh", contextWindow: 1048576 }],
    });
  });

  it("preserves other providers when overwriting nanogpt", () => {
    const agentDir = makeTempDir();
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          anthropic: { models: [{ id: "claude-sonnet-4.6" }] },
          [NANOGPT_PROVIDER_ID]: { models: [{ id: "stale" }] },
        },
      }),
    );

    const write = writeNanogptProviderCatalogToModelsJson({
      agentDir,
      block: { models: [{ id: "fresh", contextWindow: 1048576 }] },
    });

    expect(write.ok).toBe(true);
    const written = JSON.parse(
      fs.readFileSync(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(written.providers.anthropic).toEqual({
      models: [{ id: "claude-sonnet-4.6" }],
    });
    expect(written.providers[NANOGPT_PROVIDER_ID]).toEqual({
      models: [{ id: "fresh", contextWindow: 1048576 }],
    });
  });

  it("returns ok:false and a reason when the existing file is malformed", () => {
    const agentDir = makeTempDir();
    fs.writeFileSync(path.join(agentDir, "models.json"), "{ not json");

    const write = writeNanogptProviderCatalogToModelsJson({
      agentDir,
      block: { models: [{ id: "fresh" }] },
    });

    expect(write.ok).toBe(false);
    expect(write.reason).toMatch(/failed to read existing models.json/);
  });

  it("creates the agent directory if it does not exist", () => {
    const root = makeTempDir();
    const agentDir = path.join(root, "agent");

    const write = writeNanogptProviderCatalogToModelsJson({
      agentDir,
      block: { models: [{ id: "fresh" }] },
    });

    expect(write.ok).toBe(true);
    expect(fs.existsSync(path.join(agentDir, "models.json"))).toBe(true);
  });
});

describe("scheduleNanogptProviderCatalogPersistence", () => {
  it("calls buildNanoGptProvider, writes to models.json, and reports success", async () => {
    const root = makeTempDir();
    tempPaths.push(root);
    const agentDir = path.join(root, "agent");

    mockedBuild.mockResolvedValueOnce({
      api: "openai-completions",
      baseUrl: "https://nano-gpt.com/api/subscription/v1",
      models: [
        {
          id: "deepseek/deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          reasoning: true,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 1048576,
          maxTokens: 32768,
        },
      ],
    });

    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    scheduleNanogptProviderCatalogPersistence({
      apiKey: "test-key",
      pluginConfig: {},
      agentDir,
      env: {},
      logger,
    });

    await new Promise((r) => setTimeout(r, 25));

    expect(mockedBuild).toHaveBeenCalledWith({
      apiKey: "test-key",
      pluginConfig: {},
    });
    const written = JSON.parse(
      fs.readFileSync(path.join(agentDir, "models.json"), "utf8"),
    );
    expect(written.providers.nanogpt.models[0].contextWindow).toBe(1048576);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("skips silently when the API key is missing", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

    scheduleNanogptProviderCatalogPersistence({
      apiKey: undefined,
      pluginConfig: {},
      agentDir: makeTempDir(),
      env: {},
      logger,
    });

    await new Promise((r) => setTimeout(r, 25));

    expect(mockedBuild).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs a warning when buildNanoGptProvider throws and does not throw itself", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockedBuild.mockRejectedValueOnce(new Error("network down"));

    expect(() =>
      scheduleNanogptProviderCatalogPersistence({
        apiKey: "test-key",
        pluginConfig: {},
        agentDir: makeTempDir(),
        env: {},
        logger,
      }),
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 25));
    expect(logger.warn).toHaveBeenCalled();
  });

  it("logs a warning when the write step fails and does not throw itself", async () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    mockedBuild.mockResolvedValueOnce({
      api: "openai-completions",
      baseUrl: "x",
      models: [
        {
          id: "m",
          name: "M",
          input: ["text"],
          contextWindow: 1,
          maxTokens: 1,
          reasoning: false,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
    });

    const root = makeTempDir();
    const blocker = path.join(root, "blocker");
    fs.writeFileSync(blocker, "not a dir");
    const agentDir = path.join(blocker, "agent");

    expect(() =>
      scheduleNanogptProviderCatalogPersistence({
        apiKey: "test-key",
        pluginConfig: {},
        agentDir,
        env: {},
        logger,
      }),
    ).not.toThrow();

    await new Promise((r) => setTimeout(r, 25));
    expect(logger.warn).toHaveBeenCalled();
  });
});
