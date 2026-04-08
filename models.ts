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

export interface NanoGptModelEntry {
  id?: string;
  canonicalId?: string;
  name?: string;
  displayName?: string;
  reasoning?: boolean;
  vision?: boolean;
  contextWindow?: number;
  maxTokens?: number;
  pricing?: {
    inputPer1kTokens?: number;
    outputPer1kTokens?: number;
  };
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

function toPerMillion(value: number | undefined): number {
  if (!Number.isFinite(value) || (value ?? 0) < 0) {
    return 0;
  }
  return (value ?? 0) * 1000;
}

export function buildNanoGptModelDefinition(entry: NanoGptModelEntry): ModelDefinitionConfig | null {
  const id = String(entry.canonicalId ?? entry.id ?? "").trim();
  if (!id) {
    return null;
  }

  return {
    id,
    name: String(entry.displayName ?? entry.name ?? id),
    reasoning: Boolean(entry.reasoning),
    input: entry.vision ? ["text", "image"] : ["text"],
    cost: {
      input: toPerMillion(entry.pricing?.inputPer1kTokens),
      output: toPerMillion(entry.pricing?.outputPer1kTokens),
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow:
      typeof entry.contextWindow === "number" && entry.contextWindow > 0
        ? entry.contextWindow
        : 200000,
    maxTokens:
      typeof entry.maxTokens === "number" && entry.maxTokens > 0 ? entry.maxTokens : 32768,
  };
}
