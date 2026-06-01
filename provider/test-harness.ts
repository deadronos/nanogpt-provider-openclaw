import { vi } from "vitest";
import plugin from "../index.js";
import type { UnifiedModelCatalogEntry, UnifiedModelCatalogProviderContext } from "openclaw/plugin-sdk/provider-model-shared";
import type { NanoGptProviderRegistration } from "./types.js";

/**
 * Test-only mirror of the shape returned by `api.registerModelCatalogProvider`.
 * Kept here instead of `types.ts` to avoid widening the public type surface
 * with a test-only concern.
 */
export interface NanoGptModelCatalogProviderRegistration {
  provider: string;
  kinds: readonly string[];
  liveCatalog?: (
    ctx: UnifiedModelCatalogProviderContext,
  ) => Promise<readonly UnifiedModelCatalogEntry[]> | readonly UnifiedModelCatalogEntry[];
  staticCatalog?: (
    ctx: UnifiedModelCatalogProviderContext,
  ) => Promise<readonly UnifiedModelCatalogEntry[]> | readonly UnifiedModelCatalogEntry[];
}

export function getRegisteredProviderHarness(overrideConfig: Record<string, unknown> = {}) {
  const providers: unknown[] = [];
  const modelCatalogProviders: unknown[] = [];
  const warn = vi.fn();
  const info = vi.fn();

  plugin.register(
    {
      pluginConfig: { enableRepair: false, ...overrideConfig },
      runtime: {
        logging: {
          shouldLogVerbose() {
            return false;
          },
        },
      },
      logger: {
        warn,
        info,
      },
      registerProvider(provider: unknown) {
        providers.push(provider);
      },
      registerModelCatalogProvider(provider: unknown) {
        modelCatalogProviders.push(provider);
      },
      registerWebSearchProvider() {},
      registerImageGenerationProvider() {},
    } as never,
  );

  return {
    warn,
    info,
    provider: providers[0] as NanoGptProviderRegistration,
    modelCatalogProviders: modelCatalogProviders as NanoGptModelCatalogProviderRegistration[],
  };
}

export function getRegisteredProvider(overrideConfig: Record<string, unknown> = {}) {
  return getRegisteredProviderHarness(overrideConfig).provider;
}

export function getRegisteredProviderWithAuth(overrideConfig: Record<string, unknown> = {}) {
  return getRegisteredProvider(overrideConfig);
}
