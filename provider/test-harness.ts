import { vi } from "vitest";
import plugin from "../index.js";

export type RegisteredNanoGptProvider = {
  applyNativeStreamingUsageCompat?: (ctx: {
    providerConfig: {
      api: string;
      baseUrl?: string;
      models?: Array<Record<string, unknown>>;
    };
  }) => unknown;
  buildReplayPolicy?: (ctx: {
    provider?: string;
    modelId?: string;
    modelApi?: string;
    model?: {
      id?: string;
      api?: string;
      compat?: Record<string, unknown>;
    };
  }) => unknown;
  sanitizeReplayHistory?: (ctx: {
    provider?: string;
    modelId?: string;
    modelApi?: string;
    model?: {
      id?: string;
      api?: string;
      compat?: Record<string, unknown>;
    };
    messages: Array<Record<string, unknown>>;
  }) => unknown;
  validateReplayTurns?: (ctx: {
    provider?: string;
    modelId?: string;
    modelApi?: string;
    model?: {
      id?: string;
      api?: string;
      compat?: Record<string, unknown>;
    };
    messages: Array<Record<string, unknown>>;
  }) => unknown;
  resolveReasoningOutputMode?: (ctx: {
    provider?: string;
    modelId?: string;
    modelApi?: string;
    model?: {
      id?: string;
      api?: string;
      compat?: Record<string, unknown>;
    };
  }) => unknown;
  wrapStreamFn?: (ctx: {
    streamFn?: (...args: unknown[]) => unknown;
    modelId: string;
    model?: {
      id?: string;
    };
  }) => unknown;
  normalizeToolSchemas?: (ctx: {
    provider: string;
    modelId?: string;
    model?: {
      id: string;
      provider?: string;
      api?: string;
      baseUrl?: string;
    };
    tools: Array<Record<string, unknown>>;
  }) => unknown;
  inspectToolSchemas?: (ctx: {
    provider: string;
    modelId?: string;
    model?: {
      id: string;
      provider?: string;
      api?: string;
      baseUrl?: string;
    };
    tools: Array<Record<string, unknown>>;
  }) => unknown;
  augmentModelCatalog?: (ctx: {
    agentDir?: string;
    config?: Record<string, unknown>;
    env?: Record<string, string | undefined>;
    entries: Array<Record<string, unknown>>;
  }) => unknown;
  normalizeResolvedModel?: (ctx: {
    agentDir?: string;
    provider: string;
    modelId: string;
    model: {
      id: string;
      name: string;
      provider: string;
      api: string;
      baseUrl?: string;
      reasoning: boolean;
      input: Array<"text" | "image" | "document">;
      cost: {
        input: number;
        output: number;
        cacheRead: number;
        cacheWrite: number;
      };
      contextWindow: number;
      maxTokens: number;
      compat?: Record<string, unknown>;
    };
  }) => unknown;
  resolveDynamicModel?: (ctx: {
    agentDir?: string;
    env?: Record<string, string | undefined>;
    provider: string;
    modelId: string;
    modelRegistry: unknown;
    providerConfig?: {
      api?: string;
      baseUrl?: string;
      models?: Array<Record<string, unknown>>;
    };
  }) => unknown;
  resolveUsageAuth?: unknown;
  fetchUsageSnapshot?: unknown;
  matchesContextOverflowError?: (ctx: {
    provider?: string;
    modelId?: string;
    errorMessage: string;
  }) => boolean | undefined;
  classifyFailoverReason?: (ctx: {
    provider?: string;
    modelId?: string;
    errorMessage: string;
  }) => string | null | undefined;
  auth?: Array<{
    runNonInteractive?: (ctx: {
      opts?: Record<string, unknown>;
      config: Record<string, unknown>;
      env: Record<string, string | undefined>;
      agentDir: string;
      resolveApiKey: () => Promise<{ source: string } | null>;
      toApiKeyCredential: () => unknown;
    }) => Promise<Record<string, unknown> | null>;
    run?: (ctx: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }>;
};

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
    provider: providers[0] as RegisteredNanoGptProvider,
  };
}

export function getRegisteredProvider(overrideConfig: Record<string, unknown> = {}) {
  return getRegisteredProviderHarness(overrideConfig).provider;
}

export function getRegisteredProviderWithAuth(overrideConfig: Record<string, unknown> = {}) {
  return getRegisteredProviderHarness(overrideConfig).provider;
}
