import os from "node:os";
import path from "node:path";
import type { ModelDefinitionConfig } from "openclaw/plugin-sdk/provider-model-shared";

export const NANOGPT_PROVIDER_ID = "nanogpt";
export const NANOGPT_BASE_URL = "https://nano-gpt.com/api/v1";
export const NANOGPT_SUBSCRIPTION_BASE_URL = "https://nano-gpt.com/api/subscription/v1";
export const NANOGPT_PAID_BASE_URL = "https://nano-gpt.com/api/paid/v1";
export const NANOGPT_PERSONALIZED_BASE_URL = "https://nano-gpt.com/api/personalized/v1";
export const NANOGPT_DEFAULT_MODEL_ID = "gpt-5.4-mini";
export const NANOGPT_DEFAULT_MODEL_REF = `${NANOGPT_PROVIDER_ID}/${NANOGPT_DEFAULT_MODEL_ID}`;

export type NanoGptRoutingMode = "auto" | "subscription" | "paygo";
export type NanoGptCatalogSource = "auto" | "canonical" | "subscription" | "paid" | "personalized";

export interface NanoGptRepairConfig {
  kimiRepair?: boolean;
  glmRepair?: boolean;
  qwenRepair?: boolean;
  otherRepair?: boolean;
}

export type NanoGptBridgeMode = "never" | "always";
export type NanoGptBridgeProtocol = "object" | "xml";

export type NanoGptResponseFormat =
  | false
  | "json_object"
  | { type: "json_schema"; schema?: Record<string, unknown> };

export interface NanoGptPluginConfig {
  routingMode?: NanoGptRoutingMode;
  catalogSource?: NanoGptCatalogSource;
  requestApi?: "completions" | "responses" | "auto";
  provider?: string;
  enableRepair?: boolean | NanoGptRepairConfig;
  responseFormat?: NanoGptResponseFormat;
  bridgeMode?: NanoGptBridgeMode;
  bridgeProtocol?: NanoGptBridgeProtocol;
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
  tool_calling?: boolean;
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
    cost: { input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32768,
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 2.5, output: 10.0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32768,
  },
  {
    id: "claude-sonnet-4.6",
    name: "Claude Sonnet 4.6",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3.0, output: 15.0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 32768,
  },
];

const NANOGPT_WEB_FETCH_ALIAS_MODEL_IDS = new Set<string>([]);

export const NANOGPT_WEB_FETCH_TOOL_ALIAS = "fetch_web_page";

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function normalizeNanoGptComparableModelId(id: string): string {
  const normalized = id.trim().toLowerCase();
  const providerPrefix = `${NANOGPT_PROVIDER_ID}/`;
  return normalized.startsWith(providerPrefix)
    ? normalized.slice(providerPrefix.length)
    : normalized;
}

export function resolveNanoGptAgentDir(
  agentDir?: string,
  env?: Record<string, string | undefined>,
): string | undefined {
  const explicit = typeof agentDir === "string" && agentDir.trim() ? agentDir.trim() : undefined;
  if (explicit) {
    return explicit;
  }

  const resolvedEnv = env ?? process.env;

  const envAgentDir =
    resolvedEnv.OPENCLAW_AGENT_DIR?.trim() || resolvedEnv.PI_CODING_AGENT_DIR?.trim();
  if (envAgentDir) {
    return envAgentDir;
  }

  const stateDir = resolvedEnv.OPENCLAW_STATE_DIR?.trim();
  if (stateDir) {
    return path.join(stateDir, "agents", "default", "agent");
  }

  const homeDir = resolvedEnv.OPENCLAW_HOME?.trim() || resolvedEnv.HOME?.trim() || os.homedir();
  return homeDir ? path.join(homeDir, ".openclaw", "agents", "default", "agent") : undefined;
}

export function shouldAliasNanoGptWebFetchTool(modelId: string): boolean {
  return NANOGPT_WEB_FETCH_ALIAS_MODEL_IDS.has(normalizeNanoGptComparableModelId(modelId));
}

function resolveNanoGptPricingUnit(pricing: NanoGptModelPricing): string {
  return (
    pricing.unit ??
    (pricing.inputPer1kTokens !== undefined || pricing.outputPer1kTokens !== undefined
      ? "per_1k_tokens"
      : "per_million_tokens")
  );
}

function resolveNanoGptPricePerMillion(params: {
  pricing: NanoGptModelPricing;
  kind: "input" | "output";
}): number | undefined {
  const value =
    params.kind === "input"
      ? (params.pricing.inputPer1kTokens ?? params.pricing.prompt)
      : (params.pricing.outputPer1kTokens ?? params.pricing.completion);
  if (!isNonNegativeNumber(value)) {
    return undefined;
  }

  return resolveNanoGptPricingUnit(params.pricing) === "per_1k_tokens" ? value * 1000 : value;
}

export function buildNanoGptModelDefinition(
  entry: NanoGptModelEntry,
): ModelDefinitionConfig | null {
  const id = String(entry.canonicalId ?? entry.id ?? "").trim();
  if (!id) {
    return null;
  }

  const capabilities = entry.capabilities ?? {};
  const pricing = entry.pricing ?? {};
  const hasVision = Boolean(capabilities.vision ?? entry.vision);
  const hasReasoning = Boolean(capabilities.reasoning ?? entry.reasoning);
  const supportsTools = capabilities.tool_calling ?? entry.tool_calling;
  const contextWindow = entry.context_length ?? entry.contextWindow;
  const maxTokens = entry.max_output_tokens ?? entry.maxTokens;

  return {
    id,
    name: String(entry.displayName ?? entry.name ?? id),
    reasoning: hasReasoning,
    input: hasVision ? ["text", "image"] : ["text"],
    ...(supportsTools === undefined
      ? {}
      : {
          compat: {
            supportsTools,
          },
        }),
    cost: {
      input: resolveNanoGptPricePerMillion({ pricing, kind: "input" }) ?? 0,
      output: resolveNanoGptPricePerMillion({ pricing, kind: "output" }) ?? 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: isPositiveNumber(contextWindow) ? contextWindow : 200000,
    maxTokens: isPositiveNumber(maxTokens) ? maxTokens : 32768,
  };
}

export function applyNanoGptProviderPricing(
  model: ModelDefinitionConfig,
  pricing?: NanoGptModelPricing | null,
): ModelDefinitionConfig {
  if (!pricing) {
    return model;
  }

  const input = resolveNanoGptPricePerMillion({ pricing, kind: "input" });
  const output = resolveNanoGptPricePerMillion({ pricing, kind: "output" });
  if (input === undefined && output === undefined) {
    return model;
  }

  const nextCost = {
    ...model.cost,
    ...(input === undefined ? {} : { input }),
    ...(output === undefined ? {} : { output }),
  };

  if (
    nextCost.input === model.cost.input &&
    nextCost.output === model.cost.output &&
    nextCost.cacheRead === model.cost.cacheRead &&
    nextCost.cacheWrite === model.cost.cacheWrite
  ) {
    return model;
  }

  return {
    ...model,
    cost: nextCost,
  };
}
