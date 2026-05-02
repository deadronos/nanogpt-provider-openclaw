import { isRecord } from "../../shared/guards.js";
import type {
  NanoGptAssistantMessage,
  NanoGptReplayEvent,
  NanoGptReplayStream,
  NanoGptStreamResult,
} from "./types.js";

function resolveNanoGptReplayStopReason(
  stopReason: NanoGptAssistantMessage["stopReason"],
): "stop" | "length" | "toolUse" {
  if (stopReason === "toolUse") {
    return "toolUse";
  }
  if (stopReason === "length") {
    return "length";
  }
  return "stop";
}

function createNanoGptReplayStream(): NanoGptReplayStream {
  const queuedEvents: NanoGptReplayEvent[] = [];
  const iteratorWaiters: Array<(entry: IteratorResult<NanoGptReplayEvent>) => void> = [];
  let streamClosed = false;
  let finalMessage: NanoGptAssistantMessage | undefined;

  let resolveResult!: (message: NanoGptAssistantMessage) => void;
  let rejectResult!: (error: Error) => void;
  let resultSettled = false;

  const resultPromise = new Promise<NanoGptAssistantMessage>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const settleResult = (message: NanoGptAssistantMessage) => {
    if (resultSettled) {
      return;
    }
    resultSettled = true;
    resolveResult(message);
  };

  return {
    push(event) {
      if (streamClosed) {
        return;
      }

      if (event.type === "done") {
        finalMessage = event.message;
        settleResult(event.message);
      }

      const waiter = iteratorWaiters.shift();
      if (waiter) {
        waiter({ value: event, done: false });
        return;
      }

      queuedEvents.push(event);
    },
    end(message) {
      if (streamClosed) {
        return;
      }

      streamClosed = true;
      if (message) {
        finalMessage = message;
        settleResult(message);
      } else if (finalMessage) {
        settleResult(finalMessage);
      } else if (!resultSettled) {
        resultSettled = true;
        rejectResult(new Error("Replay stream ended without a final assistant message."));
      }

      while (iteratorWaiters.length > 0) {
        const waiter = iteratorWaiters.shift();
        waiter?.({ value: undefined, done: true });
      }
    },
    result() {
      return resultPromise;
    },
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (queuedEvents.length > 0) {
            const event = queuedEvents.shift();
            if (!event) {
              return { value: undefined, done: true };
            }
            return { value: event, done: false };
          }

          if (streamClosed) {
            return { value: undefined, done: true };
          }

          return await new Promise<IteratorResult<NanoGptReplayEvent>>((resolve) => {
            iteratorWaiters.push(resolve);
          });
        },
      };
    },
  };
}

export function replayNanoGptAssistantMessage(
  message: NanoGptAssistantMessage,
): NanoGptStreamResult {
  const stream = createNanoGptReplayStream();

  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    message.content.forEach((contentBlock, contentIndex) => {
      if (contentBlock.type === "text" && typeof contentBlock.text === "string") {
        stream.push({ type: "text_start", contentIndex, partial: message });
        stream.push({
          type: "text_delta",
          contentIndex,
          delta: contentBlock.text,
          partial: message,
        });
        stream.push({
          type: "text_end",
          contentIndex,
          content: contentBlock.text,
          partial: message,
        });
        return;
      }

      if (contentBlock.type === "thinking" && typeof contentBlock.thinking === "string") {
        stream.push({ type: "thinking_start", contentIndex, partial: message });
        stream.push({
          type: "thinking_delta",
          contentIndex,
          delta: contentBlock.thinking,
          partial: message,
        });
        stream.push({
          type: "thinking_end",
          contentIndex,
          content: contentBlock.thinking,
          partial: message,
        });
        return;
      }

      if (
        contentBlock.type === "toolCall" &&
        typeof contentBlock.id === "string" &&
        typeof contentBlock.name === "string" &&
        isRecord(contentBlock.arguments)
      ) {
        const delta = JSON.stringify(contentBlock.arguments);
        stream.push({ type: "toolcall_start", contentIndex, partial: message });
        stream.push({
          type: "toolcall_delta",
          contentIndex,
          delta,
          partial: message,
        });
        stream.push({
          type: "toolcall_end",
          contentIndex,
          toolCall: {
            type: "toolCall",
            id: contentBlock.id,
            name: contentBlock.name,
            arguments: contentBlock.arguments,
          },
          partial: message,
        });
      }
    });
    stream.push({
      type: "done",
      reason: resolveNanoGptReplayStopReason(message.stopReason),
      message,
    });
    stream.end();
  });

  return stream as unknown as NanoGptStreamResult;
}