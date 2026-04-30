import { resetNanoGptProviderPricingState } from "./runtime/provider-pricing.js";
import { resetNanoGptRoutingState } from "./runtime/routing.js";

export const NANOGPT_WEB_SEARCH_TIMEOUT_MS = 30_000;
export const NANOGPT_IMAGE_GENERATION_TIMEOUT_MS = 60_000;

export { getNanoGptConfig, resolveNanoGptRequestApi } from "./runtime/config.js";
export { resolveNanoGptDynamicModel } from "./runtime/dynamic-models.js";
export {
  buildNanoGptRequestHeaders,
  probeNanoGptSubscription,
  resolveCatalogBaseUrl,
  resolveCatalogSource,
  resolveNanoGptRoutingMode,
  resolveNanoGptSelectedProvider,
  resolveRequestBaseUrl,
  NANOGPT_SUBSCRIPTION_PROBE_TIMEOUT_MS,
} from "./runtime/routing.js";
export { discoverNanoGptModels, NANOGPT_MODEL_DISCOVERY_TIMEOUT_MS } from "./runtime/discovery.js";
export {
  applyNanoGptSelectedProviderPricing,
  fetchNanoGptSelectedProviderPricing,
  NANOGPT_PROVIDER_PRICING_TIMEOUT_MS,
} from "./runtime/provider-pricing.js";
export { fetchNanoGptUsageSnapshot, resolveNanoGptUsageAuth } from "./runtime/usage.js";

export function resetNanoGptRuntimeState(): void {
  resetNanoGptRoutingState();
  resetNanoGptProviderPricingState();
}
