import { describe, expect, it } from "vitest";
import { getRegisteredProvider, getRegisteredProviderHarness } from "./test-harness.js";

describe("provider tool schema hooks", () => {
  it("rewrites web_fetch by default on non-MiniMax models", () => {
    const { provider, warn } = getRegisteredProviderHarness();
    const normalizeToolSchemas = provider.normalizeToolSchemas;
    expect(normalizeToolSchemas).toEqual(expect.any(Function));

    const fetchTool = {
      name: "web_fetch",
      description: "Fetch and extract readable content from a URL",
      parameters: { type: "object" },
      execute: async () => ({ ok: true }),
    };

    const execTool = {
      name: "exec",
      description: "Execute a shell command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
      execute: async () => ({ ok: true }),
    };

    const normalized = normalizeToolSchemas?.({
      provider: "nanogpt",
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: {
        id: "moonshotai/kimi-k2.5:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [fetchTool, execTool],
    }) as Array<{ name: string; description?: string }> | null;

    const normalizedAgain = normalizeToolSchemas?.({
      provider: "nanogpt",
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: {
        id: "moonshotai/kimi-k2.5:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [fetchTool, execTool],
    }) as Array<{ name: string; description?: string }> | null;

    expect(normalized).toHaveLength(2);
    expect(normalized?.[0]).toMatchObject({
      name: "openclaw_web_fetch",
      description: expect.stringContaining("call this tool as openclaw_web_fetch"),
    });
    expect(normalizedAgain).toHaveLength(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it("rewrites web_fetch by default on minimax models", () => {
    const provider = getRegisteredProvider();
    const normalizeToolSchemas = provider.normalizeToolSchemas;
    expect(normalizeToolSchemas).toEqual(expect.any(Function));

    const fetchTool = {
      name: "web_fetch",
      description: "Fetch and extract readable content from a URL",
      parameters: { type: "object" },
      execute: async () => ({ ok: true }),
    };

    const normalized = normalizeToolSchemas?.({
      provider: "nanogpt",
      modelId: "minimax/minimax-m2.7",
      model: {
        id: "minimax/minimax-m2.7",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [fetchTool],
    }) as Array<{ name: string; description?: string }> | null;

    expect(normalized).toEqual([
      expect.objectContaining({
        name: "openclaw_web_fetch",
        description: expect.stringContaining("call this tool as openclaw_web_fetch"),
      }),
    ]);
  });

  it("keeps original web_fetch name when rewrite is disabled and strip fallback stays off", () => {
    const provider = getRegisteredProvider({
      enableWebFetchToolNameRewrite: false,
      enableWebFetchFallbackStrip: false,
    });
    const normalizeToolSchemas = provider.normalizeToolSchemas;
    expect(normalizeToolSchemas).toEqual(expect.any(Function));

    const fetchTool = {
      name: "web_fetch",
      description: "Fetch and extract readable content from a URL",
      parameters: { type: "object" },
      execute: async () => ({ ok: true }),
    };

    const normalized = normalizeToolSchemas?.({
      provider: "nanogpt",
      modelId: "deepseek/deepseek-v4-flash:thinking",
      model: {
        id: "deepseek/deepseek-v4-flash:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [fetchTool],
    }) as Array<{ name: string }> | null;

    expect(normalized).toBeNull();
  });

  it("strips web_fetch on non-MiniMax models when stripping is explicitly enabled and rewrite is disabled", () => {
    const { provider, warn } = getRegisteredProviderHarness({
      enableWebFetchToolNameRewrite: false,
      enableWebFetchFallbackStrip: true,
    });
    const normalizeToolSchemas = provider.normalizeToolSchemas;
    expect(normalizeToolSchemas).toEqual(expect.any(Function));

    const fetchTool = {
      name: "web_fetch",
      description: "Fetch and extract readable content from a URL",
      parameters: { type: "object" },
      execute: async () => ({ ok: true }),
    };

    const execTool = {
      name: "exec",
      description: "Execute a shell command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
      execute: async () => ({ ok: true }),
    };

    const normalized = normalizeToolSchemas?.({
      provider: "nanogpt",
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: {
        id: "moonshotai/kimi-k2.5:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [fetchTool, execTool],
    }) as Array<{ name: string; description?: string }> | null;

    expect(normalized).toHaveLength(1);
    expect(normalized?.[0]).toMatchObject({
      name: "exec",
      description: expect.stringContaining("curl -L <url>"),
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("rewrites web_fetch tool name when enabled and overrides fallback stripping", () => {
    const { provider, warn } = getRegisteredProviderHarness({
      enableWebFetchToolNameRewrite: true,
      enableWebFetchFallbackStrip: true,
    });
    const normalizeToolSchemas = provider.normalizeToolSchemas;
    const inspectToolSchemas = provider.inspectToolSchemas;
    expect(normalizeToolSchemas).toEqual(expect.any(Function));
    expect(inspectToolSchemas).toEqual(expect.any(Function));

    const fetchTool = {
      name: "web_fetch",
      description: "Fetch and extract readable content from a URL",
      parameters: { type: "object" },
      execute: async () => ({ ok: true }),
    };

    const normalized = normalizeToolSchemas?.({
      provider: "nanogpt",
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: {
        id: "moonshotai/kimi-k2.5:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [fetchTool],
    }) as Array<{ name: string; description?: string }> | null;

    const diagnostics = inspectToolSchemas?.({
      provider: "nanogpt",
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: {
        id: "moonshotai/kimi-k2.5:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [fetchTool],
    }) as Array<{ toolName: string; toolIndex?: number; violations: string[] }> | null;

    expect(normalized).toEqual([
      expect.objectContaining({
        name: "openclaw_web_fetch",
        description: expect.stringContaining("call this tool as openclaw_web_fetch"),
      }),
    ]);
    expect(diagnostics).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("adds GLM schema hints on non-web_fetch tools", () => {
    const provider = getRegisteredProvider();
    const normalizeToolSchemas = provider.normalizeToolSchemas;
    expect(normalizeToolSchemas).toEqual(expect.any(Function));

    const extractTool = {
      name: "extract_fields",
      description: "Extract selected fields from an existing page reference",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string" },
          selector: { type: "string" },
          fields: {
            type: "array",
            items: { type: "string" },
          },
        },
        required: ["ref", "selector"],
      },
      execute: async () => ({ ok: true }),
    };

    const normalized = normalizeToolSchemas?.({
      provider: "nanogpt",
      modelId: "zai-org/glm-5:thinking",
      model: {
        id: "zai-org/glm-5:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [extractTool],
    }) as Array<{ name: string; description?: string }> | null;

    expect(normalized).toHaveLength(1);
    expect(normalized?.[0]).toMatchObject({
      name: "extract_fields",
      description: expect.stringContaining("NanoGPT GLM tip:"),
    });
    expect(normalized?.[0]?.description).toContain(
      "include required ref/selector/fields arguments explicitly when the tool needs them.",
    );
    expect(extractTool.description).toBe("Extract selected fields from an existing page reference");
  });

  it("adds Qwen schema hints that steer models away from leaked XML-like tool text", () => {
    const provider = getRegisteredProvider();
    const normalizeToolSchemas = provider.normalizeToolSchemas;
    expect(normalizeToolSchemas).toEqual(expect.any(Function));

    const execTool = {
      name: "exec",
      description: "Execute a shell command",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
        },
        required: ["command"],
      },
      execute: async () => ({ ok: true }),
    };

    const normalized = normalizeToolSchemas?.({
      provider: "nanogpt",
      modelId: "qwen/Qwen3.6-35B-A3B:thinking",
      model: {
        id: "qwen/Qwen3.6-35B-A3B:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [execTool],
    }) as Array<{ name: string; description?: string }> | null;

    expect(normalized).toHaveLength(1);
    expect(normalized?.[0]).toMatchObject({
      name: "exec",
      description: expect.stringContaining("NanoGPT Qwen tip:"),
    });
    expect(normalized?.[0]?.description).toContain('{"command":"..."}');
    expect(normalized?.[0]?.description).toContain("<exec>...</exec>");
    expect(execTool.description).toBe("Execute a shell command");
  });

  it("surfaces Qwen schema diagnostics for tools that are hard to revalidate", () => {
    const provider = getRegisteredProvider();
    const inspectToolSchemas = provider.inspectToolSchemas;
    expect(inspectToolSchemas).toEqual(expect.any(Function));

    const diagnostics = inspectToolSchemas?.({
      provider: "nanogpt",
      modelId: "qwen/Qwen3.6-35B-A3B",
      model: {
        id: "qwen/Qwen3.6-35B-A3B",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [
        {
          name: "exec",
          parameters: { type: "object" },
          execute: async () => ({ ok: true }),
        },
      ],
    }) as Array<{ toolName: string; toolIndex?: number; violations: string[] }> | null;

    expect(diagnostics).toEqual([
      {
        toolName: "exec",
        toolIndex: 0,
        violations: expect.arrayContaining([
          expect.stringContaining("missing description"),
          expect.stringContaining("no named properties"),
        ]),
      },
    ]);
  });

  it("surfaces a diagnostic when web_fetch is stripped on non-MiniMax models", () => {
    const provider = getRegisteredProvider({
      enableWebFetchToolNameRewrite: false,
      enableWebFetchFallbackStrip: true,
    });
    const inspectToolSchemas = provider.inspectToolSchemas;
    expect(inspectToolSchemas).toEqual(expect.any(Function));

    const diagnostics = inspectToolSchemas?.({
      provider: "nanogpt",
      modelId: "deepseek/deepseek-v4-flash:thinking",
      model: {
        id: "deepseek/deepseek-v4-flash:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [
        {
          name: "web_fetch",
          description: "Fetch a web page",
          parameters: { type: "object" },
          execute: async () => ({ ok: true }),
        },
      ],
    }) as Array<{ toolName: string; toolIndex?: number; violations: string[] }> | null;

    expect(diagnostics).toEqual([
      {
        toolName: "web_fetch",
        toolIndex: 0,
        violations: expect.arrayContaining([
          expect.stringContaining("deepseek/deepseek-v4-flash:thinking hangs on web_fetch"),
          expect.stringContaining("curl -L <url>"),
        ]),
      },
    ]);
  });
});
