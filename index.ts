import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildNanoGptImageGenerationProvider } from "./image-generation-provider.js";
import { NANOGPT_PROVIDER_ID, NANOGPT_PROVIDER_LABEL, NANOGPT_DOCS_PATH } from "./models.js";
import {
  nanoGptProviderCatalog,
  readNanoGptUnifiedLiveCatalog,
} from "./provider-catalog.js";
import { getNanoGptConfig } from "./runtime/config.js";
import {
  fetchNanoGptUsageSnapshot,
  resolveNanoGptUsageAuth,
} from "./runtime/usage.js";
import { createNanoGptWebSearchProvider } from "./web-search.js";
import { createNanoGptApiKeyAuthMethod, NANOGPT_API_KEY_ENV_VAR } from "./provider/auth.js";
import {
  applyNanoGptNativeStreamingUsageCompat,
  normalizeNanoGptResolvedModel,
  resolveNanoGptDynamicModelWithSnapshot,
  readNanoGptUnifiedStaticCatalog,
} from "./provider/catalog-hooks.js";
import { scheduleNanogptProviderCatalogPersistence } from "./provider/discovery-persistence.js";
import { createNanoGptErrorSurfaceHooks } from "./provider/error-hooks.js";
import { createNanoGptReplayHooks } from "./provider/replay-hooks.js";
import {
  inspectNanoGptToolSchemas,
  normalizeNanoGptToolSchemas,
} from "./provider/tool-schema-hooks.js";
import { wrapNanoGptStreamFn } from "./provider/stream-hooks.js";
import { createNanoGptLogger } from "./provider/nanogpt-logger.js";

export default definePluginEntry({
  id: NANOGPT_PROVIDER_ID,
  name: "NanoGPT Provider",
  description: "NanoGPT provider plugin for OpenClaw",
  register(api) {
    const pluginConfig = api.pluginConfig;
    const resolvedNanoGptConfig = getNanoGptConfig(pluginConfig);
    const logger = api.logger;

    createNanoGptLogger("plugin")
      .then((log) => {
        log.info("NanoGPT plugin registered", {
          version: process.env.npm_package_version ?? "unknown",
        });
        log.info("config resolved", {
          routingMode: resolvedNanoGptConfig.routingMode,
          enableWebSearchProvider: resolvedNanoGptConfig.enableWebSearchProvider,
          bridgeMode: resolvedNanoGptConfig.bridgeMode,
          bridgeProtocol: resolvedNanoGptConfig.bridgeProtocol,
        });
      })
      .catch((error: unknown) => {
        logger.debug?.(
          `[nanogpt] log file initialization skipped: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
    const { matchesContextOverflowError: matchesContextOverflowErrorHook, classifyFailoverReason: classifyFailoverReasonHook } =
      createNanoGptErrorSurfaceHooks({
        logger,
        resolvedNanoGptConfig,
      });
    const replayHooks = createNanoGptReplayHooks({ logger });

    api.registerProvider({
      id: NANOGPT_PROVIDER_ID,
      label: NANOGPT_PROVIDER_LABEL,
      docsPath: NANOGPT_DOCS_PATH,
      envVars: ["NANOGPT_API_KEY"],
      auth: [createNanoGptApiKeyAuthMethod()],
      catalog: nanoGptProviderCatalog,
      normalizeResolvedModel: (ctx) =>
        normalizeNanoGptResolvedModel({
          agentDir: ctx.agentDir,
          model: ctx.model,
        }),
      normalizeToolSchemas: (ctx) => normalizeNanoGptToolSchemas(ctx, logger, resolvedNanoGptConfig),
      inspectToolSchemas: (ctx) => inspectNanoGptToolSchemas(ctx, resolvedNanoGptConfig),
      resolveDynamicModel: (ctx) => resolveNanoGptDynamicModelWithSnapshot(ctx),
      applyNativeStreamingUsageCompat: ({ providerConfig }) =>
        applyNanoGptNativeStreamingUsageCompat(providerConfig),
      resolveUsageAuth: async (ctx) => await resolveNanoGptUsageAuth(ctx),
      fetchUsageSnapshot: async (ctx) => await fetchNanoGptUsageSnapshot(ctx),
      buildReplayPolicy: replayHooks.buildReplayPolicy,
      sanitizeReplayHistory: replayHooks.sanitizeReplayHistory,
      validateReplayTurns: replayHooks.validateReplayTurns,
      resolveReasoningOutputMode: replayHooks.resolveReasoningOutputMode,
      wrapStreamFn: (ctx) => wrapNanoGptStreamFn(ctx, logger, resolvedNanoGptConfig),
      matchesContextOverflowError: (ctx) => matchesContextOverflowErrorHook(ctx),
      classifyFailoverReason: (ctx) => classifyFailoverReasonHook(ctx),
    });

    api.registerModelCatalogProvider({
      provider: NANOGPT_PROVIDER_ID,
      kinds: ["text"],
      liveCatalog: (ctx) => readNanoGptUnifiedLiveCatalog(ctx),
      staticCatalog: (ctx) => readNanoGptUnifiedStaticCatalog(ctx),
    });

    if (
      resolvedNanoGptConfig.routingMode === "paygo" ||
      resolvedNanoGptConfig.enableWebSearchProvider === true
    ) {
      api.registerWebSearchProvider(createNanoGptWebSearchProvider());
    }
    api.registerImageGenerationProvider(buildNanoGptImageGenerationProvider());

    // Opt-in: persist the live NanoGPT provider catalog into the agent's
    // `models.json` so `session_status` reads the correct context window
    // (e.g. 1 048 576 for `deepseek/deepseek-v4-flash`) instead of falling
    // back to the bundled 200k default. Off by default; users must set
    // `persistDiscoveredCatalog: true` in plugin config to enable it.
    // Fire-and-forget; never blocks plugin load.
    if (resolvedNanoGptConfig.persistDiscoveredCatalog === true) {
      scheduleNanogptProviderCatalogPersistence({
        apiKey: process.env[NANOGPT_API_KEY_ENV_VAR],
        pluginConfig,
        env: process.env as Record<string, string | undefined>,
        logger,
      });
    }
  },
});
