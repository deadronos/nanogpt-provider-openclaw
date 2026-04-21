import { createProviderApiKeyAuthMethod } from "openclaw/plugin-sdk/provider-auth-api-key";
import { applyNanoGptProviderAuthConfig, applyNanoGptProviderConfig } from "../onboard.js";
import { NANOGPT_PROVIDER_ID } from "../models.js";

export const NANOGPT_API_KEY_FLAG_NAME = "--nanogpt-api-key" as const;
export const NANOGPT_API_KEY_ENV_VAR = "NANOGPT_API_KEY" as const;
export const NANOGPT_API_KEY_OPTION_KEY = "nanogptApiKey" as const;

type NanoGptApiKeyAuthMethod = ReturnType<typeof createProviderApiKeyAuthMethod>;
type NanoGptApiKeyAuthContext = Parameters<NanoGptApiKeyAuthMethod["run"]>[0];
type NanoGptApiKeyNonInteractiveContext = Parameters<
  NonNullable<NanoGptApiKeyAuthMethod["runNonInteractive"]>
>[0];

function resolveNanoGptApiKeyOptionValue(ctx: NanoGptApiKeyNonInteractiveContext): string | undefined {
  const opts = ctx.opts as Record<string, unknown> | undefined;
  return typeof opts?.[NANOGPT_API_KEY_OPTION_KEY] === "string"
    ? opts[NANOGPT_API_KEY_OPTION_KEY]
    : undefined;
}

export function createNanoGptApiKeyAuthMethod(): NanoGptApiKeyAuthMethod {
  const baseMethod = createProviderApiKeyAuthMethod({
    providerId: NANOGPT_PROVIDER_ID,
    methodId: "api-key",
    label: "NanoGPT API key",
    hint: "Subscription or pay-as-you-go",
    optionKey: NANOGPT_API_KEY_OPTION_KEY,
    flagName: NANOGPT_API_KEY_FLAG_NAME,
    envVar: NANOGPT_API_KEY_ENV_VAR,
    promptMessage: "Enter NanoGPT API key",
    expectedProviders: [NANOGPT_PROVIDER_ID],
    applyConfig: (cfg) => applyNanoGptProviderConfig(cfg),
    wizard: {
      choiceId: "nanogpt-api-key",
      choiceLabel: "NanoGPT API key",
      groupId: "nanogpt",
      groupLabel: "NanoGPT",
      groupHint: "Subscription or pay-as-you-go",
    },
  });
  const runNonInteractive = baseMethod.runNonInteractive;

  return {
    ...baseMethod,
    run: async (ctx: NanoGptApiKeyAuthContext) => {
      const result = await baseMethod.run(ctx);
      return {
        ...result,
        configPatch: applyNanoGptProviderAuthConfig(
          result.configPatch ?? ctx.config,
          result.profiles[0]?.credential,
        ),
      };
    },
    runNonInteractive: runNonInteractive
      ? async (ctx: NanoGptApiKeyNonInteractiveContext) => {
          const next = await runNonInteractive(ctx);
          if (!next) {
            return next;
          }

          const resolved = await ctx.resolveApiKey({
            provider: NANOGPT_PROVIDER_ID,
            flagValue: resolveNanoGptApiKeyOptionValue(ctx),
            flagName: NANOGPT_API_KEY_FLAG_NAME,
            envVar: NANOGPT_API_KEY_ENV_VAR,
          });
          if (!resolved || resolved.source === "profile") {
            return next;
          }

          const credential = ctx.toApiKeyCredential({
            provider: NANOGPT_PROVIDER_ID,
            resolved,
          });
          return credential ? applyNanoGptProviderAuthConfig(next, credential) : next;
        }
      : undefined,
  };
}
