import {
  applyAgentDefaultModelPrimary,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/provider-onboard";
import { NANOGPT_DEFAULT_MODEL_REF } from "./models.js";

export function applyNanoGptProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  const models = { ...cfg.agents?.defaults?.models };
  models[NANOGPT_DEFAULT_MODEL_REF] = {
    ...models[NANOGPT_DEFAULT_MODEL_REF],
    alias: models[NANOGPT_DEFAULT_MODEL_REF]?.alias ?? "NanoGPT",
  };

  return {
    ...cfg,
    agents: {
      ...cfg.agents,
      defaults: {
        ...cfg.agents?.defaults,
        models,
      },
    },
  };
}

export function applyNanoGptConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyAgentDefaultModelPrimary(applyNanoGptProviderConfig(cfg), NANOGPT_DEFAULT_MODEL_REF);
}
