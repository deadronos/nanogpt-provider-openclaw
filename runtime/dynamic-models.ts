import { NANOGPT_BASE_URL, NANOGPT_DEFAULT_COST } from "../models.js";
import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";
import type {
  ProviderResolveDynamicModelContext,
  ProviderRuntimeModel,
} from "openclaw/plugin-sdk/plugin-entry";

function normalizeComparableModelId(value: string): string {
  return value.trim().toLowerCase();
}

function stripNanoGptThinkingSuffix(value: string): string {
  return value.replace(/:(thinking|reasoning)$/i, "");
}

function resolveNanoGptDynamicModelTemplate(
  modelId: string,
  providerModels?: readonly ModelDefinitionConfig[],
) {
  const models = Array.isArray(providerModels) ? providerModels : [];
  if (models.length === 0) {
    return undefined;
  }

  const targetId = normalizeComparableModelId(modelId);
  const strippedTargetId = normalizeComparableModelId(stripNanoGptThinkingSuffix(modelId));

  return models.find((model) => {
    const candidateId = typeof model.id === "string" ? normalizeComparableModelId(model.id) : "";
    if (!candidateId) {
      return false;
    }
    return candidateId === targetId || candidateId === strippedTargetId;
  });
}

function buildNanoGptDynamicModelName(modelId: string, templateName?: string): string {
  if (templateName && /:(thinking|reasoning)$/i.test(modelId)) {
    return `${templateName} Thinking`;
  }
  return templateName ?? modelId;
}

export function resolveNanoGptDynamicModel(
  ctx: ProviderResolveDynamicModelContext,
): ProviderRuntimeModel | undefined {
  const modelId = ctx.modelId.trim();
  if (!modelId) {
    return undefined;
  }

  const template = resolveNanoGptDynamicModelTemplate(modelId, ctx.providerConfig?.models);
  const reasoning = /:(thinking|reasoning)$/i.test(modelId) || template?.reasoning === true;
  const input =
    Array.isArray(template?.input) && template.input.length > 0 ? [...template.input] : ["text"];
  const compat = template?.compat ? { ...template.compat } : undefined;
  const supportsTools = compat?.supportsTools;

  return {
    id: modelId,
    name: buildNanoGptDynamicModelName(modelId, template?.name),
    api: ctx.providerConfig?.api ?? "openai-completions",
    provider: "nanogpt",
    baseUrl: ctx.providerConfig?.baseUrl ?? NANOGPT_BASE_URL,
    reasoning,
    input,
    cost: template?.cost ?? { ...NANOGPT_DEFAULT_COST },
    contextWindow: template?.contextWindow ?? 200000,
    maxTokens: template?.maxTokens ?? 32768,
    ...(compat || supportsTools !== undefined
      ? {
          compat: {
            ...compat,
            ...(supportsTools === undefined ? {} : { supportsTools }),
          },
        }
      : {}),
  } as ProviderRuntimeModel;
}
