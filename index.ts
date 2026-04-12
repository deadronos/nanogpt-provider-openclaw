import fs from "node:fs";
import path from "node:path";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { readConfiguredProviderCatalogEntries } from "openclaw/plugin-sdk/provider-catalog-shared";
import { buildNanoGptImageGenerationProvider } from "./image-generation-provider.js";
import { applyNanoGptProviderConfig } from "./onboard.js";
import { NANOGPT_DEFAULT_MODEL_REF, NANOGPT_PROVIDER_ID } from "./models.js";
import { buildNanoGptProvider } from "./provider-catalog.js";
import {
  fetchNanoGptUsageSnapshot,
  resolveNanoGptDynamicModel,
  resolveNanoGptUsageAuth,
} from "./runtime.js";
import { createNanoGptWebSearchProvider } from "./web-search.js";
import type { ProviderCatalogContext } from "openclaw/plugin-sdk/plugin-entry";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";

type NanoGptCatalogEntry = {
  provider: string;
  id: string;
  name: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<"text" | "image" | "document">;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNanoGptCatalogInput(
  input: unknown,
): NanoGptCatalogEntry["input"] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const normalized = input.filter(
    (item): item is "text" | "image" | "document" =>
      item === "text" || item === "image" || item === "document",
  );
  return normalized.length > 0 ? normalized : undefined;
}

function readNanoGptModelsJsonCatalogEntries(agentDir?: string): NanoGptCatalogEntry[] {
  if (!agentDir) {
    return [];
  }

  const modelsPath = path.join(agentDir, "models.json");
  try {
    if (!fs.existsSync(modelsPath)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(modelsPath, "utf8")) as unknown;
    const providers = isRecord(parsed) && isRecord(parsed.providers) ? parsed.providers : undefined;
    const provider = providers && isRecord(providers[NANOGPT_PROVIDER_ID])
      ? providers[NANOGPT_PROVIDER_ID]
      : undefined;
    const models = provider && Array.isArray(provider.models) ? provider.models : [];

    const entries: NanoGptCatalogEntry[] = [];
    for (const model of models) {
      if (!isRecord(model)) {
        continue;
      }

      const id = typeof model.id === "string" ? model.id.trim() : "";
      if (!id) {
        continue;
      }

      const name = (typeof model.name === "string" ? model.name : id).trim() || id;
      const contextWindow =
        typeof model.contextWindow === "number" && Number.isFinite(model.contextWindow) && model.contextWindow > 0
          ? model.contextWindow
          : undefined;
      const reasoning = typeof model.reasoning === "boolean" ? model.reasoning : undefined;
      const input = normalizeNanoGptCatalogInput(model.input);

      entries.push({
        provider: NANOGPT_PROVIDER_ID,
        id,
        name,
        ...(contextWindow ? { contextWindow } : {}),
        ...(reasoning !== undefined ? { reasoning } : {}),
        ...(input ? { input } : {}),
      });
    }

    return entries;
  } catch {
    return [];
  }
}

function mergeNanoGptCatalogEntries(...groups: NanoGptCatalogEntry[][]): NanoGptCatalogEntry[] {
  const seen = new Set<string>();
  const merged: NanoGptCatalogEntry[] = [];

  for (const group of groups) {
    for (const entry of group) {
      const key = `${entry.provider}::${entry.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(entry);
    }
  }

  return merged;
}

function readNanoGptAugmentedCatalogEntries(params: {
  agentDir?: string;
  config?: unknown;
}): NanoGptCatalogEntry[] {
  return mergeNanoGptCatalogEntries(
    readNanoGptModelsJsonCatalogEntries(params.agentDir),
    readConfiguredProviderCatalogEntries({
      config: params.config as import("openclaw/plugin-sdk/provider-onboard").OpenClawConfig | undefined,
      providerId: NANOGPT_PROVIDER_ID,
    }),
  );
}

function applyNanoGptNativeStreamingUsageCompat(
  providerConfig: ModelProviderConfig,
): ModelProviderConfig | null {
  if (providerConfig.api !== "openai-completions") {
    return null;
  }
  if (!Array.isArray(providerConfig.models) || providerConfig.models.length === 0) {
    return null;
  }

  let changed = false;
  const models = providerConfig.models.map((model) => {
    if (model.compat?.supportsUsageInStreaming === true) {
      return model;
    }
    changed = true;
    return {
      ...model,
      compat: {
        ...model.compat,
        supportsUsageInStreaming: true,
      },
    };
  });

  return changed ? { ...providerConfig, models } : null;
}

export default definePluginEntry({
  id: NANOGPT_PROVIDER_ID,
  name: "NanoGPT Provider",
  description: "NanoGPT provider plugin for OpenClaw",
  register(api) {
    const pluginConfig = api.pluginConfig;

    api.registerProvider({
      id: NANOGPT_PROVIDER_ID,
      label: "NanoGPT",
      docsPath: "/providers/models",
      envVars: ["NANOGPT_API_KEY"],
      auth: [
        createProviderApiKeyAuthMethod({
          providerId: NANOGPT_PROVIDER_ID,
          methodId: "api-key",
          label: "NanoGPT API key",
          hint: "Subscription or pay-as-you-go",
          optionKey: "nanogptApiKey",
          flagName: "--nanogpt-api-key",
          envVar: "NANOGPT_API_KEY",
          promptMessage: "Enter NanoGPT API key",
          expectedProviders: [NANOGPT_PROVIDER_ID],
          applyConfig: (cfg) => applyNanoGptProviderConfig(cfg),
          wizard: {
            choiceId: "nanogpt-api-key",
            choiceLabel: "NanoGPT API key",
            groupId: "nanogpt",
            groupLabel: "NanoGPT",
            groupHint: "Subscription or pay-as-you-go",
          },
        }),
      ],
      catalog: {
        order: "simple",
        run: async (ctx: ProviderCatalogContext) => {
          const apiKey = ctx.resolveProviderApiKey(NANOGPT_PROVIDER_ID).apiKey;
          if (!apiKey) {
            return null;
          }

          return {
            provider: await buildNanoGptProvider({
              apiKey,
              pluginConfig,
            }),
          };
        },
      },
      augmentModelCatalog: (ctx) =>
        readNanoGptAugmentedCatalogEntries({
          agentDir: ctx.agentDir,
          config: ctx.config,
        }),
      resolveDynamicModel: (ctx) => resolveNanoGptDynamicModel(ctx),
      applyNativeStreamingUsageCompat: ({ providerConfig }) =>
        applyNanoGptNativeStreamingUsageCompat(providerConfig),
      resolveUsageAuth: async (ctx) => await resolveNanoGptUsageAuth(ctx),
      fetchUsageSnapshot: async (ctx) => await fetchNanoGptUsageSnapshot(ctx),
    });

    api.registerWebSearchProvider(createNanoGptWebSearchProvider());
    api.registerImageGenerationProvider(buildNanoGptImageGenerationProvider());
  },
});
