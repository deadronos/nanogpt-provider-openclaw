import fs from "node:fs";
import path from "node:path";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import { NANOGPT_PROVIDER_ID, resolveNanoGptAgentDir } from "../models.js";
import { isRecord } from "../shared/guards.js";
import { parseFinitePositiveNumber } from "../shared/parse.js";

export type NanoGptCatalogEntry = {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image" | "document">;
};

export type NanoGptModelsJsonSnapshot = {
  catalogEntries: NanoGptCatalogEntry[];
  modelDefinitions: Map<string, ModelProviderConfig["models"][number]>;
};

const emptyNanoGptModelsJsonSnapshot: NanoGptModelsJsonSnapshot = {
  catalogEntries: [],
  modelDefinitions: new Map<string, ModelProviderConfig["models"][number]>(),
};

const nanoGptModelsJsonCache = new Map<
  string,
  {
    mtimeMs: number;
    snapshot: NanoGptModelsJsonSnapshot;
  }
>();

function normalizeNanoGptCatalogInput(value: unknown): Array<"text" | "image" | "document"> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => {
      if (typeof entry !== "string") {
        return undefined;
      }

      if (entry === "image" || entry === "document" || entry === "text") {
        return entry;
      }

      return undefined;
    })
    .filter((entry): entry is "text" | "image" | "document" => typeof entry === "string");

  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNanoGptProviderModelInput(value: unknown): Array<"text" | "image"> | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => {
      if (typeof entry !== "string") {
        return undefined;
      }

      if (entry === "image" || entry === "text") {
        return entry;
      }

      return undefined;
    })
    .filter((entry): entry is "text" | "image" => typeof entry === "string");

  return normalized.length > 0 ? normalized : undefined;
}

function buildNanoGptModelsJsonCost(value: unknown): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
} {
  if (!isRecord(value)) {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  }

  return {
    input: parseFinitePositiveNumber(value.input) ?? 0,
    output: parseFinitePositiveNumber(value.output) ?? 0,
    cacheRead: parseFinitePositiveNumber(value.cacheRead) ?? 0,
    cacheWrite: parseFinitePositiveNumber(value.cacheWrite) ?? 0,
  };
}

export function readNanoGptModelsJsonSnapshot(
  agentDir?: string,
  env?: Record<string, string | undefined>,
): NanoGptModelsJsonSnapshot {
  const resolvedAgentDir = resolveNanoGptAgentDir(agentDir, env);
  if (!resolvedAgentDir) {
    return emptyNanoGptModelsJsonSnapshot;
  }

  const modelsPath = path.join(resolvedAgentDir, "models.json");
  try {
    if (!fs.existsSync(modelsPath)) {
      nanoGptModelsJsonCache.delete(modelsPath);
      return emptyNanoGptModelsJsonSnapshot;
    }

    const stats = fs.statSync(modelsPath);
    const cached = nanoGptModelsJsonCache.get(modelsPath);
    if (cached && cached.mtimeMs === stats.mtimeMs) {
      return cached.snapshot;
    }

    const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf8")) as unknown;
    const providers = isRecord(parsed) && isRecord(parsed.providers) ? parsed.providers : undefined;
    const provider = providers && isRecord(providers[NANOGPT_PROVIDER_ID])
      ? providers[NANOGPT_PROVIDER_ID]
      : undefined;
    const models = provider && Array.isArray(provider.models) ? provider.models : [];

    const catalogEntries: NanoGptCatalogEntry[] = [];
    const modelDefinitions = new Map<string, ModelProviderConfig["models"][number]>();
    for (const model of models) {
      if (!isRecord(model)) {
        continue;
      }

      const id = typeof model.id === "string" ? model.id.trim() : "";
      if (!id) {
        continue;
      }

      const name = (typeof model.name === "string" ? model.name : id).trim() || id;
      const contextWindow = parseFinitePositiveNumber(model.contextWindow) ?? 200000;
      const contextTokens = parseFinitePositiveNumber(model.contextTokens);
      const maxTokens = parseFinitePositiveNumber(model.maxTokens) ?? 32768;
      const reasoning = typeof model.reasoning === "boolean" ? model.reasoning : false;
      const catalogInput = normalizeNanoGptCatalogInput(model.input);
      const providerModelInput = normalizeNanoGptProviderModelInput(model.input);
      const rawCompat = isRecord(model.compat)
        ? {
            ...(model.compat as NonNullable<ModelProviderConfig["models"][number]["compat"]>),
          }
        : undefined;
      const compat = rawCompat ? { ...rawCompat } : undefined;

      const definition: ModelProviderConfig["models"][number] = {
        id,
        name,
        reasoning,
        input: providerModelInput ? [...providerModelInput] : ["text"],
        cost: buildNanoGptModelsJsonCost(model.cost),
        contextWindow,
        ...(contextTokens ? { contextTokens } : {}),
        maxTokens,
        ...(compat ? { compat } : {}),
        ...(typeof model.api === "string"
          ? { api: model.api as ModelProviderConfig["models"][number]["api"] }
          : {}),
      };

      catalogEntries.push({
        provider: NANOGPT_PROVIDER_ID,
        id,
        name,
        ...(contextWindow ? { contextWindow } : {}),
        ...(typeof reasoning === "boolean" ? { reasoning } : {}),
        ...(catalogInput ? { input: [...catalogInput] } : {}),
      });
      modelDefinitions.set(id, definition);
    }

    const snapshot: NanoGptModelsJsonSnapshot = { catalogEntries, modelDefinitions };
    nanoGptModelsJsonCache.set(modelsPath, {
      mtimeMs: stats.mtimeMs,
      snapshot,
    });
    return snapshot;
  } catch {
    nanoGptModelsJsonCache.delete(modelsPath);
    return emptyNanoGptModelsJsonSnapshot;
  }
}
