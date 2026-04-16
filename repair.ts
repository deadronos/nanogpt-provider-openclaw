import { jsonrepair } from "jsonrepair";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  ToolCall,
} from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

export type RepairLogger = {
  warn: (message: string) => void;
  info: (message: string) => void;
};

/**
 * Wraps an OpenClaw model stream to automatically repair malformed JSON in tool call arguments.
 * This is particularly useful for "thinking" models or models that may truncate output.
 */
export function wrapStreamWithToolCallRepair(
  streamFn: StreamFn,
  logger: RepairLogger,
): StreamFn {
  return async (...args) => {
    const stream = await streamFn(...args);
    const modelId = args[0]?.id || "unknown";

    return (async function* () {
      const toolCallArgBuffers = new Map<number, string>();

      for await (const event of stream) {
        if (event.type === "toolcall_delta") {
          const current = toolCallArgBuffers.get(event.contentIndex) || "";
          toolCallArgBuffers.set(event.contentIndex, current + event.delta);
          yield event;
        } else if (event.type === "toolcall_end") {
          const rawArgs = toolCallArgBuffers.get(event.contentIndex);
          if (rawArgs !== undefined) {
            const repairedEvent = repairToolCallEndEvent(event, rawArgs, modelId, logger);
            yield repairedEvent;
          } else {
            yield event;
          }
        } else if (event.type === "done") {
          const repairedMessage = repairAssistantMessage(event.message, toolCallArgBuffers, modelId, logger);
          yield { ...event, message: repairedMessage };
        } else if (event.type === "error") {
          const repairedError = repairAssistantMessage(event.error, toolCallArgBuffers, modelId, logger);
          yield { ...event, error: repairedError };
        } else {
          yield event;
        }
      }
    })() as any;
  };
}

function repairToolCallEndEvent(
  event: Extract<AssistantMessageEvent, { type: "toolcall_end" }>,
  rawArgs: string,
  modelId: string,
  logger: RepairLogger,
): AssistantMessageEvent {
  try {
    // Try standard parse first to see if it's already okay
    JSON.parse(rawArgs);
    return event;
  } catch {
    try {
      const repairedJson = jsonrepair(rawArgs);
      const parsed = JSON.parse(repairedJson);

      logger.warn(
        `[nanogpt] Repaired malformed tool call arguments from model ${modelId} for tool "${event.toolCall.name}"`,
      );

      return {
        ...event,
        toolCall: {
          ...event.toolCall,
          arguments: parsed,
        },
        partial: repairAssistantMessage(event.partial, new Map([[event.contentIndex, rawArgs]]), modelId, logger, true),
      };
    } catch (e) {
      // If even jsonrepair fails, we just pass through and let the core handle the error
      return event;
    }
  }
}

function repairAssistantMessage(
  message: AssistantMessage,
  buffers: Map<number, string>,
  modelId: string,
  logger: RepairLogger,
  silent = false,
): AssistantMessage {
  if (!message.content) return message;

  let changed = false;
  const newContent = message.content.map((block, index) => {
    if (block.type === "toolCall") {
      const rawArgs = buffers.get(index);
      if (rawArgs === undefined) return block;

      try {
        JSON.parse(rawArgs);
        return block;
      } catch {
        try {
          const repairedJson = jsonrepair(rawArgs);
          const parsed = JSON.parse(repairedJson);
          if (!silent) {
            logger.warn(
              `[nanogpt] Repaired malformed tool call arguments in final message from model ${modelId} for tool "${block.name}"`,
            );
          }
          changed = true;
          return { ...block, arguments: parsed };
        } catch {
          return block;
        }
      }
    }
    return block;
  });

  return changed ? { ...message, content: newContent as any } : message;
}
