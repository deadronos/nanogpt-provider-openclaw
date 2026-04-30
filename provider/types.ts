import type {
  AnyAgentTool,
  ProviderCatalogContext,
  ProviderNormalizeToolSchemasContext,
  ProviderReasoningOutputMode,
  ProviderReasoningOutputModeContext,
  ProviderReplayPolicy,
  ProviderReplayPolicyContext,
  ProviderResolveDynamicModelContext,
  ProviderRuntimeModel,
  ProviderSanitizeReplayHistoryContext,
  ProviderToolSchemaDiagnostic,
  ProviderValidateReplayTurnsContext,
} from "openclaw/plugin-sdk/plugin-entry";
import type { ModelProviderConfig } from "openclaw/plugin-sdk/provider-model-shared";
import type { NanoGptProviderCatalog } from "../provider-catalog.js";

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
  normalizeResolvedModel?: (ctx: {
    agentDir?: string;
    model: ProviderRuntimeModel;
  }) => ProviderRuntimeModel | undefined;
  normalizeToolSchemas?: (ctx: ProviderNormalizeToolSchemasContext) => AnyAgentTool[] | null;
  inspectToolSchemas?: (ctx: ProviderNormalizeToolSchemasContext) => ProviderToolSchemaDiagnostic[] | null;
  resolveDynamicModel?: (
    ctx: ProviderResolveDynamicModelContext & { env?: Record<string, string | undefined> },
  ) => ProviderRuntimeModel | undefined;
  applyNativeStreamingUsageCompat?: (providerConfig: ModelProviderConfig) => ModelProviderConfig | null;
  resolveUsageAuth?: (ctx: ProviderCatalogContext) => Promise<unknown>;
  fetchUsageSnapshot?: (ctx: ProviderCatalogContext) => Promise<unknown>;
  buildReplayPolicy?: (context: ProviderReplayPolicyContext) => ProviderReplayPolicy | undefined;
  sanitizeReplayHistory?: (
    context: ProviderSanitizeReplayHistoryContext,
  ) => ProviderSanitizeReplayHistoryContext["messages"] | null | undefined;
  validateReplayTurns?: (
    context: ProviderValidateReplayTurnsContext,
  ) => ProviderValidateReplayTurnsContext["messages"] | null | undefined;
  resolveReasoningOutputMode?: (context: ProviderReasoningOutputModeContext) => ProviderReasoningOutputMode;
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
