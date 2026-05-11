import { isRecord } from "../shared/guards.js";
import { NANOGPT_PROVIDER_ID } from "../models.js";
import {
  mergeScopedSearchConfig,
  readProviderEnvValue,
  resolveProviderWebSearchPluginConfig,
  resolveWebSearchProviderCredential,
} from "openclaw/plugin-sdk/provider-web-search";

const NANOGPT_WEB_SEARCH_CREDENTIAL_PATH = "plugins.entries.nanogpt.config.webSearch.apiKey";
const NANOGPT_API_KEY_ENV_VAR = "NANOGPT_API_KEY";
const NANOGPT_ENV_REF_PATTERN = /^\$\{(NANOGPT_API_KEY)\}$/;
const ANY_BRACED_ENV_REF_PATTERN = /^\$\{[^}]*\}$/;
const ANY_UNBRACED_ENV_REF_PATTERN = /^\$[A-Za-z_][A-Za-z0-9_]*$/;

function isEnvSecretRef(value: unknown): value is {
  source: "env";
  id: string;
  provider?: string;
} {
  if (!isRecord(value) || value.source !== "env" || typeof value.id !== "string") {
    return false;
  }

  return value.provider === undefined || typeof value.provider === "string";
}

function resolveNanoGptWebSearchConfig(ctx: {
  config?: Record<string, unknown>;
  searchConfig?: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  return mergeScopedSearchConfig(
    ctx.searchConfig,
    NANOGPT_PROVIDER_ID,
    resolveProviderWebSearchPluginConfig(
      ctx.config as Parameters<typeof resolveProviderWebSearchPluginConfig>[0],
      NANOGPT_PROVIDER_ID,
    ),
    { mirrorApiKeyToTopLevel: true },
  );
}

function resolveNanoGptWebSearchApiKey(searchConfig?: Record<string, unknown>): string | undefined {
  const rawCredentialValue = searchConfig?.apiKey;

  // Keep compatibility with the ${ENV_VAR} string form provisioned by NanoGPT
  // onboarding/auth setup. The generic helper handles direct strings and
  // structured secret refs, but this legacy env-template form still needs to
  // be collapsed before handing off to the normal provider credential path.
  const inlineEnvRef =
    typeof rawCredentialValue === "string"
      ? NANOGPT_ENV_REF_PATTERN.exec(rawCredentialValue.trim())?.[1]
      : undefined;

  if (inlineEnvRef) {
    return resolveWebSearchProviderCredential({
      credentialValue: readProviderEnvValue([inlineEnvRef]),
      path: "tools.web.search.apiKey",
      envVars: [NANOGPT_API_KEY_ENV_VAR],
    });
  }

  if (typeof rawCredentialValue === "string") {
    const trimmedCredentialValue = rawCredentialValue.trim();
    if (
      ANY_BRACED_ENV_REF_PATTERN.test(trimmedCredentialValue) ||
      ANY_UNBRACED_ENV_REF_PATTERN.test(trimmedCredentialValue)
    ) {
      return undefined;
    }
  }

  if (isEnvSecretRef(rawCredentialValue) && rawCredentialValue.id.trim() !== NANOGPT_API_KEY_ENV_VAR) {
    return undefined;
  }

  return resolveWebSearchProviderCredential({
    credentialValue: rawCredentialValue,
    path: "tools.web.search.apiKey",
    envVars: [NANOGPT_API_KEY_ENV_VAR],
  });
}

export {
  NANOGPT_WEB_SEARCH_CREDENTIAL_PATH,
  resolveNanoGptWebSearchConfig,
  resolveNanoGptWebSearchApiKey,
};
