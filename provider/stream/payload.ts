import type { NanoGptPluginConfig, NanoGptResponseFormat } from "../../models.js";
import type { AnyAgentTool } from "openclaw/plugin-sdk/plugin-entry";
import { isRecord } from "../../shared/guards.js";
import {
  buildNanoGptObjectBridgeSystemMessage,
  buildNanoGptXmlBridgeSystemMessage,
} from "../bridge/system-prompt.js";
import type { NanoGptRequestToolMetadata } from "./types.js";

export function ensureIncludeUsageInStreamingPayload(
  payload: unknown,
  forceIncludeUsage = true,
): { payload?: unknown; requested: boolean } {
  if (!isRecord(payload)) {
    return { requested: false };
  }

  const streamValue = payload.stream;
  const isStreaming = streamValue === true || streamValue === "true";
  const hasStreamOptionsKey = "stream_options" in payload;
  if (!isStreaming && !hasStreamOptionsKey) {
    return { requested: false };
  }

  const existingStreamOptions = isRecord(payload.stream_options)
    ? payload.stream_options
    : undefined;
  const existingIncludeUsage = existingStreamOptions?.include_usage;
  if (existingIncludeUsage === true) {
    return { requested: true };
  }

  if (!forceIncludeUsage) {
    return {
      requested: false,
      payload,
    };
  }

  return {
    requested: true,
    payload: {
      ...payload,
      stream_options: {
        ...(existingStreamOptions ? existingStreamOptions : {}),
        include_usage: true,
      },
    },
  };
}

export function resolveNanoGptBridgeProtocol(
  config: NanoGptPluginConfig | undefined,
): "object" | "xml" {
  return config?.bridgeProtocol === "xml" ? "xml" : "object";
}

export function shouldApplyNanoGptBridge(
  config: NanoGptPluginConfig | undefined,
  requestToolMetadata: NanoGptRequestToolMetadata,
): boolean {
  return config?.bridgeMode === "always" && requestToolMetadata.toolEnabled;
}

export function maybeInjectNanoGptResponseFormat(
  payload: unknown,
  responseFormat?: NanoGptResponseFormat,
): unknown {
  if (!responseFormat || !isRecord(payload)) {
    return payload;
  }

  const existing = payload.response_format;
  if (existing) {
    return payload;
  }

  if (responseFormat === "json_object") {
    return { ...payload, response_format: { type: "json_object" } };
  }
  if (typeof responseFormat === "object" && responseFormat.type === "json_schema") {
    return {
      ...payload,
      response_format: responseFormat.schema
        ? { type: "json_schema", json_schema: { schema: responseFormat.schema } }
        : { type: "json_schema" },
    };
  }
  return payload;
}

export function injectNanoGptBridgePayload(params: {
  payload: unknown;
  tools: readonly AnyAgentTool[];
  protocol: "object" | "xml";
  retryMessage?: string;
}): unknown {
  if (!isRecord(params.payload)) {
    return params.payload;
  }

  const messages = Array.isArray(params.payload.messages)
    ? [...params.payload.messages]
    : [];
  const parallelAllowed = params.payload.parallel_tool_calls !== false;
  const bridgeSystemMessage =
    params.protocol === "xml"
      ? buildNanoGptXmlBridgeSystemMessage(params.tools, parallelAllowed)
      : buildNanoGptObjectBridgeSystemMessage(params.tools, parallelAllowed);

  return {
    ...params.payload,
    messages: [
      { role: "system", content: bridgeSystemMessage },
      ...messages,
      ...(params.retryMessage ? [{ role: "system", content: params.retryMessage }] : []),
    ],
  };
}