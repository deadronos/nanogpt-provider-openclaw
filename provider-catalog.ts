import type { ProviderCatalogContext } from "openclaw/plugin-sdk/provider-catalog-shared";
export {
  readNanoGptModelsJsonSnapshot,
  type NanoGptCatalogEntry,
  type NanoGptModelsJsonSnapshot,
} from "./catalog/models-json-snapshot.js";
export { buildNanoGptProvider } from "./catalog/build-provider.js";
import { NANOGPT_PROVIDER_ID } from "./models.js";

export function resolveNanoGptPluginConfigFromProviderCatalogContext(
  ctx: ProviderCatalogContext,
): unknown {
  const entries = (ctx.config.plugins?.entries ?? {}) as Record<string, { config?: unknown }>;
  return entries[NANOGPT_PROVIDER_ID]?.config;
}
