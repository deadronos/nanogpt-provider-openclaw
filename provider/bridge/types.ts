import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { isRecord } from "../../shared/guards.js";

export interface NanoGptBridgeToolArg {
  name: string;
  type: string;
  description: string;
  schema: Record<string, unknown>;
}

export interface NanoGptBridgeTool {
  name: string;
  description: string;
  args: NanoGptBridgeToolArg[];
  required: string[];
}

export interface NanoGptBridgeToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export type NanoGptBridgeParseResult =
  | {
      kind: "tool_calls";
      content: string;
      toolCalls: NanoGptBridgeToolCall[];
    }
  | {
      kind: "final";
      content: string;
    }
  | {
      kind: "invalid";
      error: {
        code: string;
        message: string;
      };
    };

export function normalizeNanoGptBridgeTools(
  tools: readonly AnyAgentTool[] | undefined,
): NanoGptBridgeTool[] {
  const normalized: NanoGptBridgeTool[] = [];

  for (const tool of tools ?? []) {
    if (typeof tool?.name !== "string") {
      continue;
    }

    const name = tool.name.trim();
    if (!name) {
      continue;
    }

    const parameters = isRecord(tool.parameters) ? tool.parameters : undefined;
    const properties = isRecord(parameters?.properties) ? parameters.properties : undefined;
    const required = Array.isArray(parameters?.required)
      ? parameters.required.filter(
          (value): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [];

    const args = Object.entries(properties ?? {}).map(([argName, schemaValue]) => {
      const schema = isRecord(schemaValue) ? { ...schemaValue } : {};
      const type =
        typeof schema.type === "string" && schema.type.trim().length > 0 ? schema.type : "string";
      const description = typeof schema.description === "string" ? schema.description : "";
      return {
        name: argName,
        type,
        description,
        schema,
      } satisfies NanoGptBridgeToolArg;
    });

    normalized.push({
      name,
      description: typeof tool.description === "string" ? tool.description.trim() : "",
      args,
      required,
    });
  }

  return normalized;
}
