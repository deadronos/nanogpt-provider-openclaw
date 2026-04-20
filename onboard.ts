import {
  applyAgentDefaultModelPrimary,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/provider-onboard";
import { setProviderWebSearchPluginConfigValue } from "openclaw/plugin-sdk/provider-web-search";
import { NANOGPT_DEFAULT_MODEL_REF, NANOGPT_PROVIDER_ID } from "./models.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNanoGptConfiguredCredentialValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : undefined;
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const source = typeof value.source === "string" ? value.source.trim().toLowerCase() : "";
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (source === "env" && id) {
    return `\${${id}}`;
  }

  return value;
}

function cloneNanoGptPluginEntry(cfg: OpenClawConfig): OpenClawConfig {
  const existingEntry = cfg.plugins?.entries?.[NANOGPT_PROVIDER_ID];
  const entry = isRecord(existingEntry) ? existingEntry : undefined;
  const entryConfig = isRecord(entry?.config) ? entry.config : undefined;
  const webSearchConfig = isRecord(entryConfig?.webSearch) ? entryConfig.webSearch : undefined;

  return {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      entries: {
        ...cfg.plugins?.entries,
        ...(entry
          ? {
              [NANOGPT_PROVIDER_ID]: {
                ...entry,
                ...(entryConfig
                  ? {
                      config: {
                        ...entryConfig,
                        ...(webSearchConfig ? { webSearch: { ...webSearchConfig } } : {}),
                      },
                    }
                  : {}),
              },
            }
          : {}),
      },
    },
  };
}

export function resolveNanoGptWebSearchCredentialValue(credential: unknown): unknown {
  if (!isRecord(credential)) {
    return undefined;
  }

  const key = normalizeNanoGptConfiguredCredentialValue(credential.key);
  if (key !== undefined) {
    return key;
  }

  return normalizeNanoGptConfiguredCredentialValue(credential.keyRef);
}

export function applyNanoGptProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[NANOGPT_DEFAULT_MODEL_REF] = {
    ...models[NANOGPT_DEFAULT_MODEL_REF],
    alias: models[NANOGPT_DEFAULT_MODEL_REF]?.alias ?? "NanoGPT",
  };

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models,
      },
    },
  };
}

export function applyNanoGptProviderAuthConfig(
  cfg: OpenClawConfig,
  credential?: unknown,
): OpenClawConfig {
  const next = applyNanoGptProviderConfig(cfg);
  const value = resolveNanoGptWebSearchCredentialValue(credential);
  if (value === undefined) {
    return next;
  }

  const configWithClonedPluginEntry = cloneNanoGptPluginEntry(next);
  setProviderWebSearchPluginConfigValue(
    configWithClonedPluginEntry,
    NANOGPT_PROVIDER_ID,
    "apiKey",
    value,
  );
  return configWithClonedPluginEntry;
}

export function applyNanoGptConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyAgentDefaultModelPrimary(applyNanoGptProviderConfig(cfg), NANOGPT_DEFAULT_MODEL_REF);
}
