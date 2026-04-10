import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";

export const NANOGPT_PROVIDER_ID = "nanogpt";
export const NANOGPT_BASE_URL = "https://nano-gpt.com/api/v1";
export const NANOGPT_SUBSCRIPTION_BASE_URL = "https://nano-gpt.com/api/subscription/v1";
export const NANOGPT_PAID_BASE_URL = "https://nano-gpt.com/api/paid/v1";
export const NANOGPT_PERSONALIZED_BASE_URL = "https://nano-gpt.com/api/personalized/v1";
export const NANOGPT_DEFAULT_MODEL_ID = "gpt-5.4-mini";
export const NANOGPT_DEFAULT_MODEL_REF = `${NANOGPT_PROVIDER_ID}/${NANOGPT_DEFAULT_MODEL_ID}`;

export type NanoGptRoutingMode = "auto" | "subscription" | "paygo";
export type NanoGptCatalogSource =
  | "auto"
  | "canonical"
  | "subscription"
  | "paid"
  | "personalized";

export interface NanoGptPluginConfig {
  routingMode?: NanoGptRoutingMode;
  catalogSource?: NanoGptCatalogSource;
  provider?: string;
}

export interface NanoGptModelCapabilities {
  reasoning?: boolean;
  vision?: boolean;
  tool_calling?: boolean;
  parallel_tool_calls?: boolean;
  structured_output?: boolean;
  pdf_upload?: boolean;
}

export interface NanoGptModelPricing {
  inputPer1kTokens?: number;
  outputPer1kTokens?: number;
  prompt?: number;
  completion?: number;
  currency?: string;
  unit?: string;
}

export interface NanoGptModelEntry {
  id?: string;
  canonicalId?: string;
  name?: string;
  displayName?: string;
  reasoning?: boolean;
  vision?: boolean;
  capabilities?: NanoGptModelCapabilities;
  contextWindow?: number;
  context_length?: number;
  maxTokens?: number;
  max_output_tokens?: number;
  pricing?: NanoGptModelPricing;
}

export const NANOGPT_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
} as const;

export const NANOGPT_FALLBACK_MODELS: ModelDefinitionConfig[] = [
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    reasoning: true,
    input: ["text", "image"],
    cost: NANOGPT_DEFAULT_COST,
    contextWindow: 200000,
    maxTokens: 32768,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    reasoning: true,
    input: ["text", "image"],
    cost: NANOGPT_DEFAULT_COST,
    contextWindow: 200000,
    maxTokens: 32768,
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    reasoning: true,
    input: ["text", "image"],
    cost: NANOGPT_DEFAULT_COST,
    contextWindow: 200000,
    maxTokens: 32768,
  },
];

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toPerMillion(value: number | undefined, unit?: string): number {
  if (!isPositiveNumber(value)) {
    return 0;
  }

  return unit === "per_1k_tokens" ? value * 1000 : value;
}

export function buildNanoGptModelDefinition(entry: NanoGptModelEntry): ModelDefinitionConfig | null {
  const id = String(entry.canonicalId ?? entry.id ?? "").trim();
  if (!id) {
    return null;
  }

  const capabilities = entry.capabilities ?? {};
  const pricing = entry.pricing ?? {};
  const pricingUnit =
    pricing.unit ?? (pricing.inputPer1kTokens !== undefined || pricing.outputPer1kTokens !== undefined ? "per_1k_tokens" : "per_million_tokens");
  const hasVision = Boolean(capabilities.vision ?? entry.vision);
  const hasReasoning = Boolean(capabilities.reasoning ?? entry.reasoning);
  const contextWindow = entry.context_length ?? entry.contextWindow;
  const maxTokens = entry.max_output_tokens ?? entry.maxTokens;

  return {
    id,
    name: String(entry.displayName ?? entry.name ?? id),
    reasoning: hasReasoning,
    input: hasVision ? ["text", "image"] : ["text"],
    cost: {
      input: toPerMillion(pricing.inputPer1kTokens ?? pricing.prompt, pricingUnit),
      output: toPerMillion(pricing.outputPer1kTokens ?? pricing.completion, pricingUnit),
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: isPositiveNumber(contextWindow) ? contextWindow : 200000,
    maxTokens: isPositiveNumber(maxTokens) ? maxTokens : 32768,
  };
}
