import type { NanoGptPluginConfig } from "../models.js";

export function getNanoGptConfig(config: unknown): NanoGptPluginConfig {
  if (!config || typeof config !== "object") {
    return {};
  }

  const candidate = config as Record<string, unknown>;
  const provider =
    typeof candidate.provider === "string" && candidate.provider.trim()
      ? candidate.provider.trim()
      : undefined;

  return {
    routingMode:
      candidate.routingMode === "auto" ||
      candidate.routingMode === "subscription" ||
      candidate.routingMode === "paygo"
        ? candidate.routingMode
        : undefined,
    catalogSource:
      candidate.catalogSource === "auto" ||
      candidate.catalogSource === "canonical" ||
      candidate.catalogSource === "subscription" ||
      candidate.catalogSource === "paid" ||
      candidate.catalogSource === "personalized"
        ? candidate.catalogSource
        : undefined,
    requestApi:
      candidate.requestApi === "auto" ||
      candidate.requestApi === "completions" ||
      candidate.requestApi === "responses"
        ? candidate.requestApi
        : undefined,
    ...(provider ? { provider } : {}),
    ...(candidate.enableRepair !== undefined && candidate.enableRepair !== null
      ? { enableRepair: candidate.enableRepair }
      : {}),
  };
}

export function resolveNanoGptRequestApi(
  config: NanoGptPluginConfig,
): "openai-completions" | "openai-responses" {
  return config.requestApi === "responses" ? "openai-responses" : "openai-completions";
}
