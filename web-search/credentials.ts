import { NANOGPT_PROVIDER_ID } from "../models.js";
import {
  mergeScopedSearchConfig,
  readProviderEnvValue,
  resolveProviderWebSearchPluginConfig,
  resolveWebSearchProviderCredential,
} from "openclaw/plugin-sdk/provider-web-search";

const NANOGPT_WEB_SEARCH_CREDENTIAL_PATH = "plugins.entries.nanogpt.config.webSearch.apiKey";
const NANOGPT_ENV_REF_PATTERN = /^\$\{(NANOGPT_API_KEY)\}$/;

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
  // Keep compatibility with the ${ENV_VAR} string form provisioned by NanoGPT
  // onboarding/auth setup. The generic helper handles direct strings and
  // structured secret refs, but this legacy env-template form still needs to
  // be collapsed before handing off to the normal provider credential path.
  const inlineEnvRef =
    typeof searchConfig?.apiKey === "string"
      ? NANOGPT_ENV_REF_PATTERN.exec(searchConfig.apiKey.trim())?.[1]
      : undefined;

  const rawCredentialValue = searchConfig?.apiKey;
  // If it looks like an environment variable but didn't match the safe pattern, don't pass it through
  const isUnsafeEnvRef = typeof rawCredentialValue === "string" && /^\$\{([^}]+)\}$/.test(rawCredentialValue.trim());

  return resolveWebSearchProviderCredential({
    credentialValue:
      (inlineEnvRef ? readProviderEnvValue([inlineEnvRef]) : undefined) ??
      (isUnsafeEnvRef ? undefined : rawCredentialValue),
    path: "tools.web.search.apiKey",
    envVars: ["NANOGPT_API_KEY"],
  });
}

export {
  NANOGPT_WEB_SEARCH_CREDENTIAL_PATH,
  resolveNanoGptWebSearchConfig,
  resolveNanoGptWebSearchApiKey,
};
