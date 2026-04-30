import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildNanoGptImageGenerationProvider } from "./image-generation-provider.js";
import { NANOGPT_PROVIDER_ID } from "./models.js";
import { buildNanoGptProvider } from "./catalog/build-provider.js";
import { resolveNanoGptPluginConfigFromProviderCatalogContext } from "./provider-catalog.js";
import { getNanoGptConfig } from "./runtime/config.js";
import { fetchNanoGptUsageSnapshot, resolveNanoGptUsageAuth } from "./runtime/usage.js";
import { createNanoGptWebSearchProvider } from "./web-search.js";
import { createNanoGptApiKeyAuthMethod } from "./provider/auth.js";
import {
  applyNanoGptNativeStreamingUsageCompat,
  normalizeNanoGptResolvedModel,
  readNanoGptAugmentedCatalogEntries,
  resolveNanoGptDynamicModelWithSnapshot,
} from "./provider/catalog-hooks.js";
import { createNanoGptErrorSurfaceHooks } from "./provider/error-hooks.js";
import { createNanoGptReplayHooks } from "./provider/replay-hooks.js";
import {
  inspectNanoGptToolSchemas,
  normalizeNanoGptToolSchemas,
} from "./provider/tool-schema-hooks.js";
import { wrapNanoGptStreamFn } from "./provider/stream-hooks.js";
import { createNanoGptLogger } from "./provider/nanogpt-logger.js";
import type { ProviderCatalogContext } from "openclaw/plugin-sdk/plugin-entry";

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
    const {
      matchesContextOverflowError: matchesContextOverflowErrorHook,
      classifyFailoverReason: classifyFailoverReasonHook,
    } = createNanoGptErrorSurfaceHooks({
      logger,
      resolvedNanoGptConfig,
    });
    const replayHooks = createNanoGptReplayHooks({ logger });

    api.registerProvider({
      id: NANOGPT_PROVIDER_ID,
      label: "NanoGPT",
      docsPath: "/providers/models",
      envVars: ["NANOGPT_API_KEY"],
      auth: [createNanoGptApiKeyAuthMethod()],
      catalog: {
        order: "simple",
        run: async (ctx: ProviderCatalogContext) => {
          const apiKey = ctx.resolveProviderApiKey(NANOGPT_PROVIDER_ID).apiKey;
          if (!apiKey) {
            return null;
          }

          return {
            provider: await buildNanoGptProvider({
              apiKey,
              pluginConfig: resolveNanoGptPluginConfigFromProviderCatalogContext(ctx),
            }),
          };
        },
      },
      augmentModelCatalog: (ctx) =>
        readNanoGptAugmentedCatalogEntries({
          agentDir: ctx.agentDir,
          config: ctx.config,
          env: ctx.env,
        }),
      normalizeResolvedModel: (ctx) =>
        normalizeNanoGptResolvedModel({
          agentDir: ctx.agentDir,
          model: ctx.model,
        }),
      normalizeToolSchemas: (ctx) => normalizeNanoGptToolSchemas(ctx),
      inspectToolSchemas: (ctx) => inspectNanoGptToolSchemas(ctx),
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

    api.registerWebSearchProvider(createNanoGptWebSearchProvider());
    api.registerImageGenerationProvider(buildNanoGptImageGenerationProvider());
  },
});
