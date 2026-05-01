import type { ProviderCatalogContext } from "openclaw/plugin-sdk/plugin-entry";
import type { NanoGptProviderCatalog } from "../provider-catalog.js";

type NativeStreamingUsageCompatConfig = {
  api: string;
  baseUrl?: string;
  models?: Array<Record<string, unknown>>;
};

export interface NanoGptProviderRegistration {
  id: string;
  label: string;
  docsPath?: string;
  envVars?: string[];
  auth?: Array<{
    runNonInteractive?: (ctx: {
      opts?: Record<string, unknown>;
      config: Record<string, unknown>;
      env: Record<string, string | undefined>;
      agentDir: string;
      resolveApiKey: () => Promise<{ source: string } | null>;
      toApiKeyCredential: (params: { resolved: { key: string } }) => unknown;
    }) => Promise<Record<string, unknown> | null>;
    run?: (ctx: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }>;
  catalog: NanoGptProviderCatalog;
  augmentModelCatalog?: (ctx: {
    agentDir?: string;
    config?: Record<string, unknown>;
    env?: Record<string, string | undefined>;
    entries: Array<Record<string, unknown>>;
  }) => unknown;
  normalizeResolvedModel?: (ctx: Record<string, unknown>) => unknown;
  normalizeToolSchemas?: (ctx: Record<string, unknown>) => unknown;
  inspectToolSchemas?: (ctx: Record<string, unknown>) => unknown;
  resolveDynamicModel?: (ctx: Record<string, unknown>) => unknown;
  applyNativeStreamingUsageCompat?: (ctx: {
    providerConfig: NativeStreamingUsageCompatConfig;
  }) => NativeStreamingUsageCompatConfig | null;
  resolveUsageAuth?: (ctx: ProviderCatalogContext) => Promise<unknown>;
  fetchUsageSnapshot?: (ctx: ProviderCatalogContext) => Promise<unknown>;
  buildReplayPolicy?: (context: Record<string, unknown>) => unknown;
  sanitizeReplayHistory?: (context: Record<string, unknown>) => unknown;
  validateReplayTurns?: (context: Record<string, unknown>) => unknown;
  resolveReasoningOutputMode?: (context: Record<string, unknown>) => unknown;
  wrapStreamFn?: (ctx: {
    streamFn: (...args: any[]) => any;
    modelId: string;
    model?: { id?: string };
  }) => (...args: any[]) => any;
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
}
