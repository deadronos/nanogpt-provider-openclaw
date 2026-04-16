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

    return wrapToolCallRepairStream(stream, modelId, logger) as any;
  };
}

function wrapToolCallRepairStream<TStream extends AsyncIterable<AssistantMessageEvent>>(
  stream: TStream,
  modelId: string,
  logger: RepairLogger,
): TStream {
  const toolCallArgBuffers = new Map<number, string>();
  const wrappedStream = stream as TStream & {
    result?: () => Promise<AssistantMessage>;
    [Symbol.asyncIterator]: () => AsyncIterator<AssistantMessageEvent>;
  };

  const originalAsyncIterator = wrappedStream[Symbol.asyncIterator].bind(wrappedStream);
  wrappedStream[Symbol.asyncIterator] = function () {
    const iterator = originalAsyncIterator();
    return {
      async next() {
        const result = await iterator.next();
        if (result.done) {
          return result;
        }

        return {
          done: false as const,
          value: repairAssistantMessageEvent(result.value, toolCallArgBuffers, modelId, logger),
        };
      },
      async return(value?: unknown) {
        return iterator.return?.(value) ?? { done: true as const, value: undefined };
      },
      async throw(error?: unknown) {
        return iterator.throw?.(error) ?? Promise.reject(error);
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };

  if (typeof wrappedStream.result === "function") {
    const originalResult = wrappedStream.result.bind(wrappedStream);
    wrappedStream.result = async () => {
      const message = await originalResult();
      return repairAssistantMessage(message, toolCallArgBuffers, modelId, logger);
    };
  }

  return wrappedStream;
}

function repairAssistantMessageEvent(
  event: AssistantMessageEvent,
  toolCallArgBuffers: Map<number, string>,
  modelId: string,
  logger: RepairLogger,
): AssistantMessageEvent {
  if (event.type === "toolcall_delta") {
    const current = toolCallArgBuffers.get(event.contentIndex) || "";
    toolCallArgBuffers.set(event.contentIndex, current + event.delta);
    return event;
  }

  if (event.type === "toolcall_end") {
    const rawArgs = toolCallArgBuffers.get(event.contentIndex);
    return rawArgs !== undefined ? repairToolCallEndEvent(event, rawArgs, modelId, logger) : event;
  }

  if (event.type === "done") {
    return {
      ...event,
      message: repairAssistantMessage(event.message, toolCallArgBuffers, modelId, logger),
    };
  }

  if (event.type === "error") {
    return {
      ...event,
      error: repairAssistantMessage(event.error, toolCallArgBuffers, modelId, logger),
    };
  }

  return event;
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
