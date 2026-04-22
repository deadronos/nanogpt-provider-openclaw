import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readNanoGptModelsJsonSnapshot } from "./models-json-snapshot.js";
import { NANOGPT_PROVIDER_ID } from "../models.js";

const tempPaths: string[] = [];

function makeTempDir() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nanogpt-models-json-snapshot-"));
  tempPaths.push(tempDir);
  return tempDir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempPaths.length > 0) {
    const tempPath = tempPaths.pop();
    if (!tempPath) {
      continue;
    }
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("readNanoGptModelsJsonSnapshot", () => {
  it("returns the empty snapshot when models.json is missing", () => {
    const snapshot = readNanoGptModelsJsonSnapshot(makeTempDir());

    expect(snapshot.catalogEntries).toEqual([]);
    expect(snapshot.modelDefinitions.size).toBe(0);
  });

  it("parses NanoGPT models.json entries into catalog metadata and model definitions", () => {
    const repoRoot = makeTempDir();
    const agentDir = path.join(repoRoot, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify(
        {
          providers: {
            [NANOGPT_PROVIDER_ID]: {
              models: [
                {
                  id: "gpt-5.4-mini",
                  name: "GPT-5.4 Mini",
                  contextWindow: 200000,
                  contextTokens: 4096,
                  maxTokens: 32768,
                  reasoning: true,
                  input: ["text", "image", "document", "ignored"],
                  cost: {
                    input: 1.5,
                    output: 2,
                    cacheRead: 0.25,
                    cacheWrite: 0.5,
                  },
                  compat: {
                    supportsTools: true,
                  },
                  api: "openai-responses",
                },
              ],
            },
          },
        },
        null,
        2,
      ),
    );

    const snapshot = readNanoGptModelsJsonSnapshot(agentDir);
    const model = snapshot.modelDefinitions.get("gpt-5.4-mini");

    expect(snapshot.catalogEntries).toEqual([
      {
        provider: NANOGPT_PROVIDER_ID,
        id: "gpt-5.4-mini",
        name: "GPT-5.4 Mini",
        contextWindow: 200000,
        reasoning: true,
        input: ["text", "image", "document"],
      },
    ]);
    expect(model).toMatchObject({
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 200000,
      contextTokens: 4096,
      maxTokens: 32768,
      cost: {
        input: 1.5,
        output: 2,
        cacheRead: 0.25,
        cacheWrite: 0.5,
      },
      compat: {
        supportsTools: true,
      },
      api: "openai-responses",
    });
  });

  it("reuses cached snapshots when the file mtime stays the same", () => {
    const repoRoot = makeTempDir();
    const agentDir = path.join(repoRoot, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "models.json"),
      JSON.stringify({
        providers: {
          [NANOGPT_PROVIDER_ID]: {
            models: [{ id: "cached-model" }],
          },
        },
      }),
    );

    const readFileSpy = vi.spyOn(fs, "readFileSync");

    const firstSnapshot = readNanoGptModelsJsonSnapshot(agentDir);
    const secondSnapshot = readNanoGptModelsJsonSnapshot(agentDir);

    expect(firstSnapshot).toBe(secondSnapshot);
    expect(readFileSpy).toHaveBeenCalledTimes(1);
  });

  it("refreshes the cached snapshot after TTL even when mtime stays unchanged", () => {
    const repoRoot = makeTempDir();
    const agentDir = path.join(repoRoot, "agent");
    fs.mkdirSync(agentDir, { recursive: true });
    const modelsPath = path.join(agentDir, "models.json");

    fs.writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          [NANOGPT_PROVIDER_ID]: {
            models: [{ id: "cached-model" }],
          },
        },
      }),
    );
    const fixedMtime = new Date(1_700_000_000_000);
    fs.utimesSync(modelsPath, fixedMtime, fixedMtime);

    const readFileSpy = vi.spyOn(fs, "readFileSync");
    let nowMs = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => nowMs);

    const firstSnapshot = readNanoGptModelsJsonSnapshot(agentDir, {
      NANOGPT_MODELS_JSON_CACHE_TTL_MS: "1000",
    });
    expect(firstSnapshot.modelDefinitions.has("cached-model")).toBe(true);

    nowMs = 1_500;
    const secondSnapshot = readNanoGptModelsJsonSnapshot(agentDir, {
      NANOGPT_MODELS_JSON_CACHE_TTL_MS: "1000",
    });
    expect(secondSnapshot).toBe(firstSnapshot);

    fs.writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          [NANOGPT_PROVIDER_ID]: {
            models: [{ id: "refreshed-model" }],
          },
        },
      }),
    );
    fs.utimesSync(modelsPath, fixedMtime, fixedMtime);

    nowMs = 1_900;
    const staleSnapshot = readNanoGptModelsJsonSnapshot(agentDir, {
      NANOGPT_MODELS_JSON_CACHE_TTL_MS: "1000",
    });
    expect(staleSnapshot).toBe(firstSnapshot);
    expect(staleSnapshot.modelDefinitions.has("cached-model")).toBe(true);

    nowMs = 2_100;
    const refreshedSnapshot = readNanoGptModelsJsonSnapshot(agentDir, {
      NANOGPT_MODELS_JSON_CACHE_TTL_MS: "1000",
    });

    expect(refreshedSnapshot).not.toBe(firstSnapshot);
    expect(refreshedSnapshot.modelDefinitions.has("refreshed-model")).toBe(true);
    expect(refreshedSnapshot.modelDefinitions.has("cached-model")).toBe(false);
    expect(readFileSpy).toHaveBeenCalledTimes(2);
  });
});
