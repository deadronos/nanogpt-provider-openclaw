import { describe, expect, it } from "vitest";
import { getRegisteredProvider } from "./test-harness.js";

describe("provider tool schema hooks", () => {
  it("keeps web_fetch untouched on Kimi models because aliasing is disabled", () => {
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
      modelId: "moonshotai/kimi-k2.5:thinking",
      model: {
        id: "moonshotai/kimi-k2.5:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [fetchTool],
    }) as Array<{ name: string }> | null;

    expect(normalized).toBeNull();
  });

  it("adds GLM schema hints without renaming web_fetch", () => {
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
      modelId: "zai-org/glm-5:thinking",
      model: {
        id: "zai-org/glm-5:thinking",
        provider: "nanogpt",
        api: "openai-completions",
      },
      tools: [fetchTool],
    }) as Array<{ name: string; description?: string }> | null;

    expect(normalized).toHaveLength(1);
    expect(normalized?.[0]).toMatchObject({
      name: "web_fetch",
      description: expect.stringContaining("NanoGPT GLM tip:"),
    });
    expect(normalized?.[0]?.name).not.toBe("fetch_web_page");
    expect(normalized?.[0]?.description).toContain(
      "include required ref/selector/fields arguments explicitly when the tool needs them.",
    );
    expect(fetchTool.description).toBe("Fetch and extract readable content from a URL");
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
});
