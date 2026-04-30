import type {
  AnyAgentTool,
  ProviderNormalizeToolSchemasContext,
  ProviderToolSchemaDiagnostic,
} from "openclaw/plugin-sdk/plugin-entry";
import { isRecord } from "../shared/guards.js";
import { resolveNanoGptModelIdentity } from "./anomaly-types.js";

const NANOGPT_GLM_TOOL_SCHEMA_HINT_MARKER = "NanoGPT GLM tip:";
const NANOGPT_GLM_TOOL_SCHEMA_HINT =
  "NanoGPT GLM tip: include required ref/selector/fields arguments explicitly when the tool needs them.";
const NANOGPT_QWEN_TOOL_SCHEMA_HINT_MARKER = "NanoGPT Qwen tip:";

/**
 * NanoGPT family-specific tool schema guidance:
 * - Kimi: keep untouched. Alias-heavy rewrites have been flaky and are intentionally disabled.
 * - GLM: improves tool-call reliability when required/named args are made explicit in descriptions.
 * - Qwen: steers models away from leaked XML-like wrappers toward direct JSON object arguments.
 */

function getNanoGptToolSchemaSummary(tool: AnyAgentTool): {
  parameters?: Record<string, unknown>;
  required: string[];
  properties: string[];
} {
  const parameters = isRecord(tool.parameters) ? tool.parameters : undefined;
  const required = Array.isArray(parameters?.required)
    ? parameters.required.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  const properties = isRecord(parameters?.properties) ? Object.keys(parameters.properties) : [];

  return { parameters, required, properties };
}

function shouldAnnotateNanoGptGlmToolSchema(tool: AnyAgentTool): boolean {
  const { parameters, required, properties } = getNanoGptToolSchemaSummary(tool);
  if (!parameters) {
    return /web[_-]?fetch|fetch[_-]?web|browser|page|extract|search/i.test(tool.name);
  }

  const fields = new Set([...required, ...properties]);
  if (
    [...fields].some((field) =>
      ["ref", "selector", "fields", "inputRef", "element"].includes(field),
    )
  ) {
    return true;
  }

  if (required.length > 0) {
    return true;
  }

  return /web[_-]?fetch|fetch[_-]?web|browser|page|extract|search/i.test(tool.name);
}

function appendNanoGptGlmToolSchemaHint(description: string | undefined): string {
  if (
    typeof description === "string" &&
    description.includes(NANOGPT_GLM_TOOL_SCHEMA_HINT_MARKER)
  ) {
    return description;
  }

  if (typeof description === "string" && description.trim().length > 0) {
    return `${description} ${NANOGPT_GLM_TOOL_SCHEMA_HINT}`;
  }

  return NANOGPT_GLM_TOOL_SCHEMA_HINT;
}

function resolveNanoGptQwenPrimarySchemaField(tool: AnyAgentTool): string | undefined {
  const { required, properties } = getNanoGptToolSchemaSummary(tool);
  if (required.length === 1) {
    return required[0];
  }
  if (properties.length === 1) {
    return properties[0];
  }
  return undefined;
}

function appendNanoGptQwenToolSchemaHint(tool: AnyAgentTool): string {
  if (
    typeof tool.description === "string" &&
    tool.description.includes(NANOGPT_QWEN_TOOL_SCHEMA_HINT_MARKER)
  ) {
    return tool.description;
  }

  const primaryField = resolveNanoGptQwenPrimarySchemaField(tool);
  const { required, properties } = getNanoGptToolSchemaSummary(tool);
  const hintedKeys = [...new Set([...(required.length > 0 ? required : []), ...properties])].slice(
    0,
    4,
  );
  const argumentHint = primaryField
    ? ` Pass a JSON object like {"${primaryField}":"..."} when calling it.`
    : hintedKeys.length > 0
      ? ` Include JSON object arguments using keys like ${hintedKeys.join(", ")}.`
      : " Pass a JSON object with named arguments instead of plain text.";
  const qwenHint =
    `${NANOGPT_QWEN_TOOL_SCHEMA_HINT_MARKER} emit a direct tool call with JSON object arguments that match this schema; do not write plain text or XML-like wrappers such as ` +
    `<${tool.name}>...</${tool.name}> or <function=${tool.name}>.${argumentHint}`;

  if (typeof tool.description === "string" && tool.description.trim().length > 0) {
    return `${tool.description} ${qwenHint}`;
  }

  return qwenHint;
}

function inspectNanoGptQwenToolSchema(
  tool: AnyAgentTool,
  toolIndex: number,
): ProviderToolSchemaDiagnostic | null {
  const violations: string[] = [];
  const { parameters, properties } = getNanoGptToolSchemaSummary(tool);

  if (typeof tool.description !== "string" || tool.description.trim().length === 0) {
    violations.push(
      "missing description; Qwen tool calling is more reliable when each tool has a short explicit one-line description",
    );
  }

  if (!parameters || parameters.type !== "object") {
    violations.push(
      "parameters should be a JSON object schema so NanoGPT can revalidate leaked tool text against named arguments",
    );
  } else if (properties.length === 0) {
    violations.push(
      "schema exposes no named properties; generic plain-text wrappers like <tool>...</tool> cannot be mapped back to arguments reliably",
    );
  }

  return violations.length > 0
    ? {
        toolName: tool.name,
        toolIndex,
        violations,
      }
    : null;
}

export function normalizeNanoGptToolSchemas(
  ctx: ProviderNormalizeToolSchemasContext,
): AnyAgentTool[] | null {
  const { modelFamily: family } = resolveNanoGptModelIdentity(ctx);
  // Only normalize for families that currently need schema nudges.
  // Kimi intentionally stays passthrough to avoid reintroducing aliasing debt.
  if (family !== "glm" && family !== "qwen") {
    return null;
  }

  let changed = false;
  const tools = ctx.tools.map((tool) => {
    if (family === "glm" && !shouldAnnotateNanoGptGlmToolSchema(tool)) {
      return tool;
    }
    const nextDescription =
      family === "glm"
        ? appendNanoGptGlmToolSchemaHint(tool.description)
        : appendNanoGptQwenToolSchemaHint(tool);
    if (nextDescription === tool.description) {
      return tool;
    }
    changed = true;
    return {
      ...tool,
      description: nextDescription,
    } as AnyAgentTool;
  });

  return changed ? tools : null;
}

export function inspectNanoGptToolSchemas(
  ctx: ProviderNormalizeToolSchemasContext,
): ProviderToolSchemaDiagnostic[] | null {
  const { modelFamily: family } = resolveNanoGptModelIdentity(ctx);
  if (family !== "qwen") {
    return null;
  }

  const diagnostics = ctx.tools
    .map((tool, toolIndex) => inspectNanoGptQwenToolSchema(tool, toolIndex))
    .filter((diagnostic): diagnostic is ProviderToolSchemaDiagnostic => diagnostic !== null);

  return diagnostics.length > 0 ? diagnostics : null;
}

export { detectNanoGptModelFamily } from "./anomaly-types.js";
