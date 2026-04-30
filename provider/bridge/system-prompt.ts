import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { normalizeNanoGptBridgeTools, type NanoGptBridgeTool } from "./types.js";

function buildObjectToolManifest(normalizedTools: readonly NanoGptBridgeTool[]) {
  return normalizedTools.map((tool) => {
    const argumentsSchema: Record<string, unknown> = {};
    for (const arg of tool.args) {
      const schema = { ...arg.schema };
      if (!schema.type && arg.type) {
        schema.type = arg.type;
      }
      if (!schema.description && arg.description) {
        schema.description = arg.description;
      }
      argumentsSchema[arg.name] = schema;
    }
    return {
      name: tool.name,
      description: tool.description,
      arguments: argumentsSchema,
      required: tool.required,
    };
  });
}

function canonicalizeToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function toolExists(normalizedTools: readonly NanoGptBridgeTool[], name: string): boolean {
  const target = canonicalizeToolName(name);
  return normalizedTools.some((tool) => canonicalizeToolName(tool.name) === target);
}

function buildToolDescription(tool: NanoGptBridgeTool): string {
  const lines: string[] = [];
  lines.push(`## ${tool.name}`);
  if (tool.description) {
    lines.push(`Description: ${tool.description}`);
  }
  if (tool.args.length > 0) {
    lines.push("Parameters:");
    for (const arg of tool.args) {
      const required = tool.required.includes(arg.name) ? " (required)" : "";
      const description = arg.description ? ` - ${arg.description}` : "";
      lines.push(`- ${arg.name}: ${arg.type}${required}${description}`);
      if (arg.type === "object" || arg.type === "array") {
        lines.push(`  Schema: ${JSON.stringify(arg.schema)}`);
      }
    }
  }
  lines.push("");
  lines.push("Usage:");
  lines.push(`<${tool.name}>`);
  for (const arg of tool.args) {
    lines.push(`<${arg.name}>${arg.type === "string" ? "value" : `{${arg.type}}`}</${arg.name}>`);
  }
  lines.push(`</${tool.name}>`);
  return lines.join("\n");
}

function buildXmlExampleForTool(tool: NanoGptBridgeTool, index: number, introText: string): string {
  let out = `\n## Example ${index}: Using the "${tool.name}" tool\n`;
  out += `<open>${introText}</open>\n`;
  out += `<${tool.name}>\n`;
  for (const arg of tool.args) {
    if (arg.type === "object" || arg.type === "array") {
      out += `<${arg.name}>{"key":"value"}</${arg.name}>\n`;
    } else {
      out += `<${arg.name}>example_value</${arg.name}>\n`;
    }
  }
  out += `</${tool.name}>\n`;
  return out;
}

function selectToolsForBatchedExample(tools: readonly NanoGptBridgeTool[]): NanoGptBridgeTool[] {
  const lightweight = tools.filter((tool) =>
    /read|glob|grep|search|find|list|ls|fetch|web|open/i.test(tool.name),
  );
  if (lightweight.length >= 2) {
    return lightweight.slice(0, 2);
  }
  return tools.slice(0, 2);
}

function buildBatchedXmlExample(tools: readonly NanoGptBridgeTool[], startIndex: number): string {
  if (tools.length < 2) {
    return "";
  }
  let out = `\n## Example ${startIndex}: Batching a small independent check\n`;
  out += `<open>I will check both items now, then continue after the results.</open>\n`;
  for (const tool of tools.slice(0, 2)) {
    out += `<${tool.name}>\n`;
    for (const arg of tool.args) {
      if (arg.type === "object" || arg.type === "array") {
        out += `<${arg.name}>{"key":"value"}</${arg.name}>\n`;
      } else {
        out += `<${arg.name}>example_value</${arg.name}>\n`;
      }
    }
    out += `</${tool.name}>\n`;
  }
  return out;
}

export function buildNanoGptObjectBridgeSystemMessage(
  tools: readonly AnyAgentTool[],
  parallelAllowed = true,
  inheritedSystemText = "",
): string {
  const normalizedTools = normalizeNanoGptBridgeTools(tools);
  const manifest = JSON.stringify(buildObjectToolManifest(normalizedTools), null, 2);
  const exampleTool = normalizedTools[0];
  const completionToolRequired = toolExists(normalizedTools, "attempt_completion");
  const exampleArgs: Record<string, unknown> = {};
  for (const arg of exampleTool?.args ?? []) {
    exampleArgs[arg.name] = arg.type === "string" ? "example" : {};
  }

  return [
    "# Structured Turn Contract (v1)",
    "",
    "THIS OUTPUT CONTRACT IS THE MOST IMPORTANT INSTRUCTION IN THIS MESSAGE.",
    "DO NOT IGNORE IT. DO NOT FALL BACK TO NORMAL PROSE.",
    "Return EXACTLY one JSON object and nothing else.",
    "If you reply with plain prose, markdown, or any text outside the JSON object, the response is invalid and unusable.",
    "No markdown fences. No prose before or after the JSON object.",
    "Do not start with an explanation, plan, or status update outside the JSON object.",
    "Even a single sentence before the JSON object makes the response invalid.",
    "",
    "Required field order:",
    '1. "v"',
    '2. "mode"',
    '3. "message"',
    '4. "tool_calls" (only when mode is "tool")',
    "",
    "Rules:",
    '- "v" must be 1.',
    '- "mode" must be "tool", "final", or "clarify".',
    '- "message" must always be a user-facing string.',
    '- When mode is "tool", "tool_calls" must be a non-empty array.',
    '- When mode is "final" or "clarify", do not include "tool_calls".',
    completionToolRequired
      ? '- IMPORTANT: The tool "attempt_completion" is available in this session. When you have finished successfully, do NOT use mode "final". Use mode "tool" and call "attempt_completion" for the completion turn.'
      : '- Use mode "final" for a plain successful completion when no more tools are needed.',
    '- Prefer each tool call object to use "name" and an "arguments" object. Flattened argument fields are also accepted when needed.',
    parallelAllowed
      ? "- You may batch multiple tool calls only when they are clearly independent. Keep batches sensible; do not try to complete an entire task in one oversized turn."
      : '- Emit exactly one tool call when mode is "tool".',
    "",
    "Examples:",
    JSON.stringify(
      {
        v: 1,
        mode: "tool",
        message: "I will inspect the file now.",
        tool_calls: exampleTool
          ? [{ name: exampleTool.name, arguments: exampleArgs }]
          : [{ name: "read", arguments: { path: "example" } }],
      },
      null,
      2,
    ),
    completionToolRequired
      ? JSON.stringify(
          {
            v: 1,
            mode: "tool",
            message: "The task is complete. I will submit the final result now.",
            tool_calls: [
              { name: "attempt_completion", arguments: { result: "Done. The task is complete." } },
            ],
          },
          null,
          2,
        )
      : JSON.stringify({ v: 1, mode: "final", message: "Done. The task is complete." }, null, 2),
    JSON.stringify(
      { v: 1, mode: "clarify", message: "Which file do you want me to update?" },
      null,
      2,
    ),
    "",
    "Tool manifest:",
    manifest,
    inheritedSystemText
      ? "Additional system instructions to follow while still obeying the JSON-only output contract:"
      : "",
    inheritedSystemText,
  ].join("\n");
}

export function buildNanoGptXmlBridgeSystemMessage(
  tools: readonly AnyAgentTool[],
  parallelAllowed = true,
): string {
  const normalizedTools = normalizeNanoGptBridgeTools(tools);
  const toolDescriptions = normalizedTools.map(buildToolDescription).join("\n\n");

  let examples = "";
  if (normalizedTools.length > 0) {
    let exampleIndex = 1;
    if (parallelAllowed && normalizedTools.length >= 2) {
      examples += buildBatchedXmlExample(
        selectToolsForBatchedExample(normalizedTools),
        exampleIndex++,
      );
    }
    for (const tool of normalizedTools.slice(0, Math.min(3, normalizedTools.length))) {
      examples += buildXmlExampleForTool(tool, exampleIndex++, `I will use ${tool.name} now.`);
    }
  }

  return [
    "# Tool Use Instructions",
    "",
    "You have access to a set of tools to interact with the system.",
    "Whenever you need to take an action, you must use one of these tools by writing an XML tool call in your response.",
    "",
    "The format for calling a tool is to use an XML tag matching the tool's name, and place each parameter inside its own child XML tag. For example:",
    "",
    "<tool_name>",
    "<parameter_name>value</parameter_name>",
    "<another_parameter>value</another_parameter>",
    "</tool_name>",
    examples,
    "",
    "CRITICAL RULES:",
    "1. You MUST use the exact XML format shown above. No other format is acceptable.",
    "2. EVERY parameter must be a child XML tag inside the main tool tag.",
    "3. When your response includes one or more tool calls, begin with a brief user-facing line inside <open>...</open> before the first tool call.",
    "4. For tools expecting objects or arrays, place JSON formatted text inside the parameter tag.",
    "5. Do NOT use JSON tool calls, Markdown code blocks for tool calls, or generic <invoke> tags.",
    parallelAllowed
      ? "6. You may call MULTIPLE tools in a single response, but keep batches small and clearly independent."
      : "6. Use exactly ONE tool call per response. Do not batch multiple tool calls.",
    "7. If you intend to take an action, do NOT just describe it and then stop.",
    "8. Never return an empty tool-enabled response. If you need to act, emit the XML tool call now.",
    "",
    "# Available Tools",
    "",
    toolDescriptions,
  ].join("\n");
}
