import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import { isRecord } from "../shared/guards.js";
import { NANOGPT_PROVIDER_ID, resolveNanoGptAgentDir } from "../models.js";
import { buildNanoGptProvider } from "../catalog/build-provider.js";

/**
 * Bumped whenever the on-disk shape of the persisted `providers.nanogpt`
 * block changes. Consumers should be defensive when reading older snapshots;
 * this is purely an additive signal for forward compatibility.
 */
export const NANOGPT_PERSISTENCE_SCHEMA_VERSION = 1 as const;

export interface BuildNanogptProvidersBlockParams {
  config: ModelProviderConfig | null | undefined;
}

/**
 * Project a `ModelProviderConfig` (as produced by `buildNanoGptProvider`)
 * into the JSON shape stored under `providers.nanogpt` inside the agent's
 * `models.json`. Returns `null` when there is nothing to persist.
 */
export function buildNanogptProvidersBlock(
  params: BuildNanogptProvidersBlockParams,
): Record<string, unknown> | null {
  const config = params.config;
  if (!config || !Array.isArray(config.models) || config.models.length === 0) {
    return null;
  }

  return {
    api: config.api,
    baseUrl: config.baseUrl,
    source: "live",
    schemaVersion: NANOGPT_PERSISTENCE_SCHEMA_VERSION,
    models: config.models.map((model) => {
      const entry: Record<string, unknown> = {
        id: model.id,
        name: model.name,
        reasoning: model.reasoning,
        input: model.input,
        cost: model.cost,
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
      };
      if (model.contextTokens !== undefined) {
        entry.contextTokens = model.contextTokens;
      }
      if (model.compat) {
        entry.compat = model.compat;
      }
      if (model.api) {
        entry.api = model.api;
      }
      return entry;
    }),
  };
}

export interface MergeModelsJsonProvidersNanogptParams {
  existing: unknown;
  block: Record<string, unknown> | null;
}

export interface MergeModelsJsonProvidersNanogptResult {
  providers: Record<string, unknown>;
  changed: boolean;
}

/**
 * Replace the `providers.nanogpt` key in a parsed `models.json` value with
 * the new block. Every other provider entry is preserved verbatim. When
 * `block` is `null`, the `nanogpt` key is removed.
 */
export function mergeModelsJsonProvidersNanogpt(
  params: MergeModelsJsonProvidersNanogptParams,
): MergeModelsJsonProvidersNanogptResult {
  const existingRecord = isRecord(params.existing) ? params.existing : {};
  const existingProviders = isRecord(existingRecord.providers)
    ? (existingRecord.providers as Record<string, unknown>)
    : {};

  const nextProviders: Record<string, unknown> = { ...existingProviders };
  if (params.block === null) {
    delete nextProviders[NANOGPT_PROVIDER_ID];
  } else {
    nextProviders[NANOGPT_PROVIDER_ID] = params.block;
  }

  return {
    providers: nextProviders,
    changed: existingProviders[NANOGPT_PROVIDER_ID] !== nextProviders[NANOGPT_PROVIDER_ID],
  };
}

export interface WriteNanogptModelsJsonParams {
  agentDir: string;
  block: Record<string, unknown> | null;
}

export interface WriteNanogptModelsJsonResult {
  ok: boolean;
  changed: boolean;
  path: string;
  reason?: string;
}

/**
 * Atomically replace the `providers.nanogpt` block in `<agentDir>/models.json`
 * using a temp file + rename. Returns a structured result so the caller can
 * log warnings without throwing. The function never throws.
 */
export function writeNanogptProviderCatalogToModelsJson(
  params: WriteNanogptModelsJsonParams,
): WriteNanogptModelsJsonResult {
  const modelsPath = path.join(params.agentDir, "models.json");

  let parsed: unknown = {};
  try {
    if (fs.existsSync(modelsPath)) {
      const raw = fs.readFileSync(modelsPath, "utf8");
      if (raw.trim().length > 0) {
        parsed = JSON.parse(raw);
      }
    }
  } catch (err) {
    return {
      ok: false,
      changed: false,
      path: modelsPath,
      reason: `failed to read existing models.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const { providers, changed } = mergeModelsJsonProvidersNanogpt({
    existing: parsed,
    block: params.block,
  });

  try {
    fs.mkdirSync(params.agentDir, { recursive: true });
    const tmpPath = `${modelsPath}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
    fs.writeFileSync(tmpPath, `${JSON.stringify({ providers }, null, 2)}\n`);
    fs.renameSync(tmpPath, modelsPath);
    return { ok: true, changed, path: modelsPath };
  } catch (err) {
    return {
      ok: false,
      changed,
      path: modelsPath,
      reason: `failed to write models.json: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface NanoGptPersistenceLogger {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
}

export interface ScheduleNanogptProviderCatalogPersistenceParams {
  apiKey: string | undefined;
  pluginConfig: unknown;
  agentDir?: string;
  env?: Record<string, string | undefined>;
  logger: NanoGptPersistenceLogger;
}

/**
 * Resolve the live NanoGPT provider catalog and persist it under
 * `providers.nanogpt` in `<agentDir>/models.json` so OpenClaw core's
 * `session_status` reads the correct context window for every model.
 *
 * Fire-and-forget: returns synchronously after kicking off the async
 * pipeline. All failure modes (missing key, discovery error, read error,
 * write error) are reported via the supplied logger and never thrown.
 * Designed to be called once at the end of `register(api)`.
 */
export function scheduleNanogptProviderCatalogPersistence(
  params: ScheduleNanogptProviderCatalogPersistenceParams,
): void {
  void (async () => {
    try {
      if (!params.apiKey) {
        return;
      }

      let providerConfig: ModelProviderConfig;
      try {
        providerConfig = await buildNanoGptProvider({
          apiKey: params.apiKey,
          pluginConfig: params.pluginConfig,
        });
      } catch (err) {
        params.logger.warn("NanoGPT discovery failed while persisting catalog", {
          error: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      const block = buildNanogptProvidersBlock({ config: providerConfig });
      if (!block) {
        return;
      }

      const agentDir = params.agentDir ?? resolveNanoGptAgentDir(undefined, params.env);
      if (!agentDir) {
        return;
      }

      const write = writeNanogptProviderCatalogToModelsJson({
        agentDir,
        block,
      });

      if (!write.ok) {
        params.logger.warn("Failed to persist NanoGPT provider catalog to models.json", {
          path: write.path,
          reason: write.reason,
        });
        return;
      }

      if (write.changed) {
        const modelCount = Array.isArray(block.models) ? block.models.length : 0;
        params.logger.info("Persisted NanoGPT provider catalog to models.json", {
          path: write.path,
          modelCount,
        });
      }
    } catch (err) {
      try {
        params.logger.warn("Unhandled error persisting NanoGPT provider catalog", {
          error: err instanceof Error ? err.message : String(err),
        });
      } catch {
        // Logging is best-effort; never throw.
      }
    }
  })();
}
