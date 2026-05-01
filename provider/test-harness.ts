import { vi } from "vitest";
import plugin from "../index.js";
import type { NanoGptProviderRegistration } from "./types.js";

export function getRegisteredProviderHarness(overrideConfig: Record<string, unknown> = {}) {
  const providers: unknown[] = [];
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
      registerWebSearchProvider() {},
      registerImageGenerationProvider() {},
    } as never,
  );

  return {
    warn,
    info,
    provider: providers[0] as NanoGptProviderRegistration,
  };
}

export function getRegisteredProvider(overrideConfig: Record<string, unknown> = {}) {
  return getRegisteredProviderHarness(overrideConfig).provider;
}

export function getRegisteredProviderWithAuth(overrideConfig: Record<string, unknown> = {}) {
  return getRegisteredProvider(overrideConfig);
}
