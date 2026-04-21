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
});
