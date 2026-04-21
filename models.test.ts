import { describe, expect, it, afterEach, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { snapshotEnv, restoreEnv, setEnvValue } from "./test-env.js";
import {
  NANOGPT_DEFAULT_MODEL_REF,
  NANOGPT_FALLBACK_MODELS,
  NANOGPT_WEB_FETCH_TOOL_ALIAS,
  applyNanoGptProviderPricing,
  buildNanoGptModelDefinition,
  shouldAliasNanoGptWebFetchTool,
  resolveNanoGptAgentDir,
} from "./models.js";

describe("model constants", () => {
  it("exposes the default NanoGPT model ref", () => {
    expect(NANOGPT_DEFAULT_MODEL_REF).toBe("nanogpt/gpt-5.4-mini");
  });

  it("ships a non-empty fallback catalog", () => {
    expect(NANOGPT_FALLBACK_MODELS.length).toBeGreaterThan(0);
  });
});

describe("buildNanoGptModelDefinition", () => {
  it("maps detailed capability and pricing metadata into an OpenClaw model definition", () => {
    expect(
      buildNanoGptModelDefinition({
        id: "gpt-5.4-mini",
        displayName: "GPT-5.4 Mini",
        capabilities: {
          reasoning: true,
          vision: true,
          tool_calling: true,
        },
        context_length: 1234,
        max_output_tokens: 567,
        pricing: {
          prompt: 2.5,
          completion: 7.5,
          unit: "per_million_tokens",
        },
      }),
    ).toMatchObject({
      id: "gpt-5.4-mini",
      name: "GPT-5.4 Mini",
      reasoning: true,
      input: ["text", "image"],
      compat: {
        supportsTools: true,
      },
      contextWindow: 1234,
      maxTokens: 567,
      cost: {
        input: 2.5,
        output: 7.5,
        cacheRead: 0,
        cacheWrite: 0,
      },
    });
  });

  it("keeps backward compatibility with top-level vision metadata", () => {
    expect(
      buildNanoGptModelDefinition({
        id: "legacy-vision-model",
        vision: true,
      }),
    ).toMatchObject({
      id: "legacy-vision-model",
      input: ["text", "image"],
    });
  });

  it.each([
    {
      id: "glm-5",
      capabilities: { tool_calling: true },
      expected: true,
    },
    {
      id: "moonshotai/kimi-k2.5",
      capabilities: { tool_calling: true },
      expected: true,
    },
    {
      id: "moonshotai/kimi-k2.5:thinking",
      capabilities: { tool_calling: true },
      expected: true,
    },
    {
      id: "minimax-m2.7",
      capabilities: { tool_calling: false },
      expected: false,
    },
  ] as const)("derives tool compatibility for $id", ({ id, capabilities, expected }) => {
    expect(
      buildNanoGptModelDefinition({
        id,
        capabilities,
      }),
    ).toMatchObject({
      id,
      compat: {
        supportsTools: expected,
      },
    });
  });

  it("overrides model cost with provider-specific per-1k pricing when available", () => {
    const model = buildNanoGptModelDefinition({
      id: "provider-priced-model",
      pricing: {
        prompt: 2.5,
        completion: 10,
        unit: "per_million_tokens",
      },
    });

    expect(model).not.toBeNull();
    const priced = applyNanoGptProviderPricing(model!, {
      inputPer1kTokens: 0.00042,
      outputPer1kTokens: 0.0018375,
      unit: "per_1k_tokens",
    });

    expect(priced.cost.input).toBeCloseTo(0.42, 10);
    expect(priced.cost.output).toBeCloseTo(1.8375, 10);
    expect(priced.cost.cacheRead).toBe(0);
    expect(priced.cost.cacheWrite).toBe(0);
  });
});

describe("shouldAliasNanoGptWebFetchTool", () => {
  it("does not alias anything currently", () => {
    expect(NANOGPT_WEB_FETCH_TOOL_ALIAS).toBe("fetch_web_page");
    expect(shouldAliasNanoGptWebFetchTool("moonshotai/kimi-k2.5")).toBe(false);
    expect(shouldAliasNanoGptWebFetchTool("moonshotai/kimi-k2.5:thinking")).toBe(false);
    expect(shouldAliasNanoGptWebFetchTool("nanogpt/moonshotai/kimi-k2.5:thinking")).toBe(false);
    expect(shouldAliasNanoGptWebFetchTool("gpt-5.4-mini")).toBe(false);
  });
});

describe("resolveNanoGptAgentDir", () => {
  let envSnapshot: Record<string, string | undefined>;

  beforeEach(() => {
    envSnapshot = snapshotEnv(["OPENCLAW_AGENT_DIR", "PI_CODING_AGENT_DIR", "OPENCLAW_STATE_DIR", "OPENCLAW_HOME", "HOME"]);
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
    vi.restoreAllMocks();
  });

  it("returns explicit agentDir if provided and not empty", () => {
    expect(resolveNanoGptAgentDir("/custom/agent/dir")).toBe("/custom/agent/dir");
    expect(resolveNanoGptAgentDir("  /custom/agent/dir  ")).toBe("/custom/agent/dir");
  });

  it("prefers OPENCLAW_AGENT_DIR from env over other options", () => {
    expect(resolveNanoGptAgentDir(undefined, { OPENCLAW_AGENT_DIR: "/env/agent/dir" })).toBe("/env/agent/dir");
  });

  it("falls back to PI_CODING_AGENT_DIR if OPENCLAW_AGENT_DIR is missing", () => {
    expect(resolveNanoGptAgentDir(undefined, { PI_CODING_AGENT_DIR: "/pi/agent/dir" })).toBe("/pi/agent/dir");
  });

  it("uses OPENCLAW_STATE_DIR to build path if agent dirs are missing", () => {
    expect(resolveNanoGptAgentDir(undefined, { OPENCLAW_STATE_DIR: "/state/dir" })).toBe(path.join("/state/dir", "agents", "default", "agent"));
  });

  it("uses OPENCLAW_HOME to build path if state dir is missing", () => {
    expect(resolveNanoGptAgentDir(undefined, { OPENCLAW_HOME: "/claw/home" })).toBe(path.join("/claw/home", ".openclaw", "agents", "default", "agent"));
  });

  it("uses HOME to build path if OPENCLAW_HOME is missing", () => {
    expect(resolveNanoGptAgentDir(undefined, { HOME: "/user/home" })).toBe(path.join("/user/home", ".openclaw", "agents", "default", "agent"));
  });

  it("uses os.homedir() to build path if HOME is missing", () => {
    vi.spyOn(os, 'homedir').mockReturnValue('/mock/os/home');
    expect(resolveNanoGptAgentDir(undefined, {})).toBe(path.join("/mock/os/home", ".openclaw", "agents", "default", "agent"));
  });

  it("uses process.env by default if env is not provided", () => {
    setEnvValue("OPENCLAW_AGENT_DIR", "/global/agent/dir");
    expect(resolveNanoGptAgentDir()).toBe("/global/agent/dir");
  });
});
