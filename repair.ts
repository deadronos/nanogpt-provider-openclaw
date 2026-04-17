import { jsonrepair } from "jsonrepair";
import type {
  AssistantMessage,
  AssistantMessageEvent,
  Tool,
} from "@mariozechner/pi-ai";
import type { StreamFn } from "@mariozechner/pi-agent-core";

export type RepairLogger = {
  warn: (message: string) => void;
  info: (message: string) => void;
};

export type ToolCallRepairOptions = {
  debug?: boolean;
  retryInvalidEmptyTurns?: boolean;
};

type RepairRuntimeMeta = {
  modelId: string;
  requestApi?: string;
  attempt: number;
  debug: boolean;
};

type RepairAttempt = {
  events: AssistantMessageEvent[];
  finalMessage: AssistantMessage;
  toolEnabled: boolean;
  sawToolCall: boolean;
  sawVisibleText: boolean;
};

const EMPTY_USAGE: AssistantMessage["usage"] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
};

const INVALID_EMPTY_TOOL_TURN_RETRY_PROMPT =
  "NanoGPT retry note: the previous response was invalid because it produced no visible content or tool call for a tool-enabled turn. Reply again with either concise visible text or a valid tool call. If you use a tool, emit the tool call directly with valid JSON arguments and no markdown fences.";

const TOOL_CALL_CONTAINER_KEYS = ["tool_calls", "toolCalls", "tools", "calls", "actions"] as const;
const TOOL_ARGUMENT_KEYS = ["arguments", "args", "parameters", "input"] as const;
const PSEUDO_TOOL_WRAPPER_TAG_NAMES = new Set(["use_tool", "tool", "tool_call", "toolcall"]);
const PSEUDO_TOOL_NAME_ATTRIBUTE_PATTERN = /\bname\s*=\s*(?:"([^"]+)"|'([^']+)')/i;
const TOOL_CALL_RESERVED_KEYS = new Set<string>([
  "id",
  "type",
  "name",
  "tool",
  "toolName",
  "function",
  "message",
  "text",
  "mode",
  ...TOOL_ARGUMENT_KEYS,
  ...TOOL_CALL_CONTAINER_KEYS,
]);

function normalizeNanoGptRepairModelId(modelId: string): string {
  const normalized = modelId.trim().toLowerCase();
  return normalized.startsWith("nanogpt/") ? normalized.slice("nanogpt/".length) : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function shouldRepairNanoGptToolCallArguments(modelId?: string): boolean {
  if (!modelId?.trim()) {
    return false;
  }
  const normalized = normalizeNanoGptRepairModelId(modelId);
  return normalized.startsWith("moonshotai/kimi");
}

function normalizeAssistantMessage(
  message: Partial<AssistantMessage> | undefined,
  meta: Pick<RepairRuntimeMeta, "modelId" | "requestApi">,
): AssistantMessage {
  const candidate = isRecord(message) ? (message as Partial<AssistantMessage>) : undefined;
  return {
    role: "assistant",
    content: Array.isArray(candidate?.content) ? [...candidate.content] : [],
    api: typeof candidate?.api === "string" ? candidate.api : meta.requestApi ?? "openai-completions",
    provider: typeof candidate?.provider === "string" ? candidate.provider : "nanogpt",
    model: typeof candidate?.model === "string" ? candidate.model : meta.modelId,
    ...(typeof candidate?.responseId === "string" ? { responseId: candidate.responseId } : {}),
    usage: isRecord(candidate?.usage)
      ? (candidate.usage as AssistantMessage["usage"])
      : {
          ...EMPTY_USAGE,
          cost: { ...EMPTY_USAGE.cost },
        },
    stopReason: candidate?.stopReason ?? "stop",
    ...(typeof candidate?.errorMessage === "string" ? { errorMessage: candidate.errorMessage } : {}),
    timestamp: typeof candidate?.timestamp === "number" ? candidate.timestamp : Date.now(),
  };
}

function hasVisibleText(message: AssistantMessage): boolean {
  return message.content.some(
    (block) => block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0,
  );
}

function countToolCalls(message: AssistantMessage): number {
  return message.content.filter((block) => block.type === "toolCall").length;
}

function hasToolEnabledContext(context: Parameters<StreamFn>[1]): boolean {
  return Array.isArray(context?.tools) && context.tools.length > 0;
}

function canonicalizeToolName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function resolveKnownToolName(name: string, tools: readonly Tool[]): string {
  const normalized = canonicalizeToolName(name);
  const match = tools.find((tool) => canonicalizeToolName(tool.name) === normalized);
  return match?.name ?? name.trim();
}

function logReliabilityArtifact(
  logger: RepairLogger,
  meta: RepairRuntimeMeta,
  artifact: Record<string, unknown>,
): void {
  if (!meta.debug) {
    return;
  }

  logger.info(
    `[nanogpt][tool-reliability] ${JSON.stringify({
      modelId: meta.modelId,
      requestApi: meta.requestApi ?? "unknown",
      attempt: meta.attempt,
      ...artifact,
    })}`,
  );
}

function isMalformedToolCallJson(rawArgs: string): boolean {
  try {
    JSON.parse(rawArgs);
    return false;
  } catch {
    return true;
  }
}

function logObservedMalformedToolCall(params: {
  contentIndex: number;
  toolName: string;
  rawArgs: string;
  logger: RepairLogger;
  meta: RepairRuntimeMeta;
  loggedContentIndexes: Set<number>;
}): void {
  if (params.loggedContentIndexes.has(params.contentIndex)) {
    return;
  }

  params.loggedContentIndexes.add(params.contentIndex);
  params.logger.warn(
    `[nanogpt] Observed malformed tool call arguments from model ${params.meta.modelId} (api=${params.meta.requestApi ?? "unknown"}) for tool "${params.toolName}". Automatic repair is not enabled for this model family; investigate whether this model should get targeted reliability handling.`,
  );
  logReliabilityArtifact(params.logger, params.meta, {
    event: "malformed_tool_call_observed",
    toolName: params.toolName,
    rawArgumentLength: params.rawArgs.length,
    repairEnabled: false,
  });
}

function buildRetryContext(context: Parameters<StreamFn>[1]): Parameters<StreamFn>[1] {
  return {
    ...context,
    systemPrompt: context.systemPrompt?.trim()
      ? `${context.systemPrompt}\n\n${INVALID_EMPTY_TOOL_TURN_RETRY_PROMPT}`
      : INVALID_EMPTY_TOOL_TURN_RETRY_PROMPT,
  };
}

function parseJsonCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return JSON.parse(jsonrepair(candidate));
  }
}

function isStructuredJsonCandidate(candidate: string): boolean {
  try {
    const parsed = parseJsonCandidate(candidate);
    return isRecord(parsed) || Array.isArray(parsed);
  } catch {
    return false;
  }
}

function extractBalancedJsonCandidate(text: string, opener: "{" | "[", closer: "}" | "]") {
  let startIndex = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === opener) {
      if (startIndex === -1) {
        startIndex = index;
      }
      depth += 1;
      continue;
    }
    if (char === closer && startIndex !== -1) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

function extractRawToolPayloadCandidates(text: string): string[] {
  const candidates = new Set<string>();
  const trimmed = text.trim();
  if (trimmed) {
    candidates.add(trimmed);
  }

  const fencedBlockPattern = /```(?:json)?\s*([\s\S]*?)```/gi;
  for (const match of trimmed.matchAll(fencedBlockPattern)) {
    const candidate = match[1]?.trim();
    if (candidate) {
      candidates.add(candidate);
    }
  }

  const objectCandidate = extractBalancedJsonCandidate(trimmed, "{", "}");
  if (objectCandidate) {
    candidates.add(objectCandidate.trim());
  }

  const arrayCandidate = extractBalancedJsonCandidate(trimmed, "[", "]");
  if (arrayCandidate) {
    candidates.add(arrayCandidate.trim());
  }

  return [...candidates];
}

function extractPseudoToolWrapperName(attributes: string): string | undefined {
  const match = attributes.match(PSEUDO_TOOL_NAME_ATTRIBUTE_PATTERN);
  const value = match?.[1] ?? match?.[2];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function extractToolPayloadCandidates(text: string): string[] {
  const candidates = new Set<string>(extractRawToolPayloadCandidates(text));
  const trimmed = text.trim();
  if (!trimmed) {
    return [...candidates];
  }

  const pseudoToolWrapperPattern = /<([a-zA-Z][\w-]*)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const match of trimmed.matchAll(pseudoToolWrapperPattern)) {
    const tagName = match[1]?.trim().toLowerCase();
    if (!tagName || !PSEUDO_TOOL_WRAPPER_TAG_NAMES.has(tagName)) {
      continue;
    }

    const toolName = extractPseudoToolWrapperName(match[2] ?? "");
    const body = match[3]?.trim();
    if (!toolName || !body) {
      continue;
    }

    for (const innerCandidate of extractRawToolPayloadCandidates(body)) {
      if (!isStructuredJsonCandidate(innerCandidate)) {
        continue;
      }

      candidates.add(JSON.stringify({ name: toolName, arguments: innerCandidate }));
    }
  }

  return [...candidates];
}

function firstDefinedProperty(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (key in record && record[key] !== undefined) {
      return record[key];
    }
  }
  return undefined;
}

function firstStringProperty(
  record: Record<string, unknown>,
  keys: readonly string[],
): string | undefined {
  const value = firstDefinedProperty(record, keys);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeToolArguments(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) {
    return { ...raw };
  }
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }

  try {
    const parsed = parseJsonCandidate(raw.trim());
    if (isRecord(parsed)) {
      return { ...parsed };
    }
    if (Array.isArray(parsed)) {
      return { value: parsed };
    }
    return { value: parsed };
  } catch {
    return null;
  }
}

function buildFlattenedToolArguments(
  record: Record<string, unknown>,
  nestedFunction?: Record<string, unknown>,
): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (!TOOL_CALL_RESERVED_KEYS.has(key)) {
      flattened[key] = value;
    }
  }

  if (Object.keys(flattened).length > 0) {
    return flattened;
  }

  if (nestedFunction) {
    for (const [key, value] of Object.entries(nestedFunction)) {
      if (!TOOL_CALL_RESERVED_KEYS.has(key)) {
        flattened[key] = value;
      }
    }
  }

  return flattened;
}

function normalizeSalvagedToolCall(
  value: unknown,
  tools: readonly Tool[],
  index: number,
): Extract<AssistantMessage["content"][number], { type: "toolCall" }> | null {
  if (!isRecord(value)) {
    return null;
  }

  const nestedFunction = isRecord(value.function) ? value.function : undefined;
  const rawName =
    firstStringProperty(value, ["name", "toolName"]) ??
    (typeof value.tool === "string" && value.tool.trim() ? value.tool.trim() : undefined) ??
    (nestedFunction ? firstStringProperty(nestedFunction, ["name"]) : undefined);
  if (!rawName) {
    return null;
  }

  const normalizedName = resolveKnownToolName(rawName, tools);
  const rawArguments =
    firstDefinedProperty(value, TOOL_ARGUMENT_KEYS) ??
    (nestedFunction ? firstDefinedProperty(nestedFunction, TOOL_ARGUMENT_KEYS) : undefined);
  const normalizedArguments =
    normalizeToolArguments(rawArguments) ?? buildFlattenedToolArguments(value, nestedFunction);

  return {
    type: "toolCall",
    id: typeof value.id === "string" && value.id.trim() ? value.id : `call_salvaged_${index + 1}`,
    name: normalizedName,
    arguments: normalizedArguments,
  };
}

function normalizeStructuredToolTurn(
  value: unknown,
  tools: readonly Tool[],
): {
  messageText?: string;
  toolCalls: Array<Extract<AssistantMessage["content"][number], { type: "toolCall" }>>;
} | null {
  if (Array.isArray(value)) {
    const toolCalls = value
      .map((entry, index) => normalizeSalvagedToolCall(entry, tools, index))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    return toolCalls.length > 0 ? { toolCalls } : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const messageText =
    (typeof value.message === "string" && value.message.trim() ? value.message.trim() : undefined) ??
    (typeof value.text === "string" && value.text.trim() ? value.text.trim() : undefined);
  const rawCalls = firstDefinedProperty(value, TOOL_CALL_CONTAINER_KEYS);
  if (rawCalls !== undefined) {
    const callEntries = Array.isArray(rawCalls) ? rawCalls : [rawCalls];
    const toolCalls = callEntries
      .map((entry, index) => normalizeSalvagedToolCall(entry, tools, index))
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
    return toolCalls.length > 0 ? { messageText, toolCalls } : null;
  }

  const toolCall = normalizeSalvagedToolCall(value, tools, 0);
  return toolCall ? { messageText, toolCalls: [toolCall] } : null;
}

function buildSyntheticToolEvents(message: AssistantMessage): AssistantMessageEvent[] {
  const partial = normalizeAssistantMessage(
    {
      ...message,
      content: [],
      stopReason: "toolUse",
      errorMessage: undefined,
    },
    { modelId: message.model, requestApi: message.api },
  );
  const events: AssistantMessageEvent[] = [{ type: "start", partial }];

  for (const [contentIndex, block] of message.content.entries()) {
    if (block.type === "text") {
      const partialTextBlock: Extract<AssistantMessage["content"][number], { type: "text" }> = {
        type: "text",
        text: "",
      };
      partial.content.push(partialTextBlock);
      events.push({ type: "text_start", contentIndex, partial });
      if (block.text) {
        partialTextBlock.text = block.text;
        events.push({ type: "text_delta", contentIndex, delta: block.text, partial });
      }
      events.push({ type: "text_end", contentIndex, content: block.text, partial });
      continue;
    }

    if (block.type === "toolCall") {
      const partialToolCall: Extract<AssistantMessage["content"][number], { type: "toolCall" }> = {
        type: "toolCall",
        id: block.id,
        name: block.name,
        arguments: {},
      };
      partial.content.push(partialToolCall);
      events.push({ type: "toolcall_start", contentIndex, partial });
      const delta = JSON.stringify(block.arguments);
      partialToolCall.arguments = block.arguments;
      if (delta) {
        events.push({ type: "toolcall_delta", contentIndex, delta, partial });
      }
      events.push({ type: "toolcall_end", contentIndex, toolCall: block, partial });
    }
  }

  events.push({ type: "done", reason: "toolUse", message });
  return events;
}

function salvageStructuredToolTurn(
  message: AssistantMessage,
  tools: readonly Tool[],
  meta: RepairRuntimeMeta,
  logger: RepairLogger,
): { events: AssistantMessageEvent[]; finalMessage: AssistantMessage } | null {
  const textPayload = message.content
    .filter((block): block is Extract<AssistantMessage["content"][number], { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!textPayload) {
    return null;
  }

  for (const candidate of extractToolPayloadCandidates(textPayload)) {
    try {
      const normalized = normalizeStructuredToolTurn(parseJsonCandidate(candidate), tools);
      if (!normalized || normalized.toolCalls.length === 0) {
        continue;
      }

      const salvagedMessage = normalizeAssistantMessage(message, meta);
      salvagedMessage.content = [
        ...(normalized.messageText ? [{ type: "text", text: normalized.messageText } as const] : []),
        ...normalized.toolCalls,
      ];
      salvagedMessage.stopReason = "toolUse";
      delete salvagedMessage.errorMessage;

      logger.warn(
        `[nanogpt] Salvaged structured tool payload from assistant text for model ${meta.modelId}`,
      );
      logReliabilityArtifact(logger, meta, {
        event: "salvage_success",
        toolCallCount: normalized.toolCalls.length,
        payloadLength: textPayload.length,
      });

      return {
        events: buildSyntheticToolEvents(salvagedMessage),
        finalMessage: salvagedMessage,
      };
    } catch {
      continue;
    }
  }

  return null;
}

function createReplayStream(events: AssistantMessageEvent[], finalMessage: AssistantMessage) {
  return {
    async result() {
      return finalMessage;
    },
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          if (index >= events.length) {
            return { done: true as const, value: undefined };
          }
          const value = events[index];
          index += 1;
          return { done: false as const, value };
        },
        async return(value?: unknown) {
          return { done: true as const, value };
        },
        async throw(error?: unknown) {
          return Promise.reject(error);
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
    },
  };
}

async function collectRepairAttempt(params: {
  streamFn: StreamFn;
  args: Parameters<StreamFn>;
  logger: RepairLogger;
  meta: RepairRuntimeMeta;
}): Promise<RepairAttempt> {
  const stream = await params.streamFn(...params.args);
  const toolCallArgBuffers = new Map<number, string>();
  const events: AssistantMessageEvent[] = [];
  let lastAssistantMessage: AssistantMessage | undefined;
  let sawToolCall = false;

  for await (const event of stream) {
    const repairedEvent = repairAssistantMessageEvent(
      event,
      toolCallArgBuffers,
      params.meta,
      params.logger,
    );
    if (
      repairedEvent.type === "toolcall_start" ||
      repairedEvent.type === "toolcall_delta" ||
      repairedEvent.type === "toolcall_end"
    ) {
      sawToolCall = true;
    }
    if ("partial" in repairedEvent) {
      lastAssistantMessage = repairedEvent.partial;
    }
    if (repairedEvent.type === "done") {
      lastAssistantMessage = repairedEvent.message;
    }
    if (repairedEvent.type === "error") {
      lastAssistantMessage = repairedEvent.error;
    }
    events.push(repairedEvent);
  }

  const terminalEvent = [...events].reverse().find(
    (event): event is Extract<AssistantMessageEvent, { type: "done" | "error" }> =>
      event.type === "done" || event.type === "error",
  );
  let finalMessage =
    terminalEvent?.type === "done"
      ? terminalEvent.message
      : terminalEvent?.type === "error"
        ? terminalEvent.error
        : normalizeAssistantMessage(lastAssistantMessage, params.meta);
  const toolEnabled = hasToolEnabledContext(params.args[1]);

  if (toolEnabled && !sawToolCall && countToolCalls(finalMessage) === 0) {
    const salvaged = salvageStructuredToolTurn(
      finalMessage,
      params.args[1].tools ?? [],
      params.meta,
      params.logger,
    );
    if (salvaged) {
      finalMessage = salvaged.finalMessage;
      return {
        events: salvaged.events,
        finalMessage,
        toolEnabled,
        sawToolCall: true,
        sawVisibleText: hasVisibleText(finalMessage),
      };
    }
  }

  const finalToolCallCount = countToolCalls(finalMessage);
  if (finalToolCallCount > 0) {
    sawToolCall = true;
  }

  return {
    events,
    finalMessage,
    toolEnabled,
    sawToolCall,
    sawVisibleText: hasVisibleText(finalMessage),
  };
}

/**
 * Wraps an OpenClaw model stream to automatically repair malformed JSON in tool call arguments.
 * This is particularly useful for "thinking" models or models that may truncate output.
 */
export function wrapStreamWithToolCallRepair(
  streamFn: StreamFn,
  logger: RepairLogger,
  options: ToolCallRepairOptions = {},
): StreamFn {
  return async (...args) => {
    const baseMeta: RepairRuntimeMeta = {
      modelId: args[0]?.id || "unknown",
      requestApi: args[0]?.api,
      attempt: 0,
      debug: options.debug === true,
    };
    const firstAttempt = await collectRepairAttempt({
      streamFn,
      args,
      logger,
      meta: baseMeta,
    });

    let selectedAttempt = firstAttempt;
    if (
      options.retryInvalidEmptyTurns !== false &&
      firstAttempt.toolEnabled &&
      !firstAttempt.sawToolCall &&
      !firstAttempt.sawVisibleText
    ) {
      logger.warn(
        `[nanogpt] Retrying empty tool-enabled turn from model ${baseMeta.modelId} after no visible content or tool call was produced`,
      );
      logReliabilityArtifact(logger, baseMeta, {
        event: "retry_invalid_empty_turn",
      });

      selectedAttempt = await collectRepairAttempt({
        streamFn,
        args: [args[0], buildRetryContext(args[1]), args[2]],
        logger,
        meta: {
          ...baseMeta,
          attempt: 1,
        },
      });
      logReliabilityArtifact(logger, { ...baseMeta, attempt: 1 }, {
        event: "retry_result",
        recoveredToolCalls: countToolCalls(selectedAttempt.finalMessage),
        sawVisibleText: selectedAttempt.sawVisibleText,
      });
    }

    return createReplayStream(selectedAttempt.events, selectedAttempt.finalMessage) as any;
  };
}

export function wrapStreamWithMalformedToolCallGuard(
  streamFn: StreamFn,
  logger: RepairLogger,
  options: ToolCallRepairOptions = {},
): StreamFn {
  return async (...args) => {
    const stream = await streamFn(...args);
    const meta: RepairRuntimeMeta = {
      modelId: args[0]?.id || "unknown",
      requestApi: args[0]?.api,
      attempt: 0,
      debug: options.debug === true,
    };
    const toolCallArgBuffers = new Map<number, string>();
    const loggedContentIndexes = new Set<number>();
    const wrappedStream = stream as typeof stream & {
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

          const event = result.value;
          if (event.type === "toolcall_delta") {
            const current = toolCallArgBuffers.get(event.contentIndex) || "";
            toolCallArgBuffers.set(event.contentIndex, current + event.delta);
          }

          if (event.type === "toolcall_end") {
            const rawArgs = toolCallArgBuffers.get(event.contentIndex);
            if (typeof rawArgs === "string" && isMalformedToolCallJson(rawArgs)) {
              logObservedMalformedToolCall({
                contentIndex: event.contentIndex,
                toolName: event.toolCall.name,
                rawArgs,
                logger,
                meta,
                loggedContentIndexes,
              });
            }
          }

          return {
            done: false as const,
            value: event,
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
        message.content.forEach((block, index) => {
          if (block.type !== "toolCall") {
            return;
          }

          const rawArgs = toolCallArgBuffers.get(index);
          if (typeof rawArgs === "string" && isMalformedToolCallJson(rawArgs)) {
            logObservedMalformedToolCall({
              contentIndex: index,
              toolName: block.name,
              rawArgs,
              logger,
              meta,
              loggedContentIndexes,
            });
          }
        });
        return message;
      };
    }

    return wrappedStream as any;
  };
}

function repairAssistantMessageEvent(
  event: AssistantMessageEvent,
  toolCallArgBuffers: Map<number, string>,
  meta: RepairRuntimeMeta,
  logger: RepairLogger,
): AssistantMessageEvent {
  if (event.type === "toolcall_delta") {
    const current = toolCallArgBuffers.get(event.contentIndex) || "";
    toolCallArgBuffers.set(event.contentIndex, current + event.delta);
    return event;
  }

  if (event.type === "toolcall_end") {
    const rawArgs = toolCallArgBuffers.get(event.contentIndex);
    return rawArgs !== undefined ? repairToolCallEndEvent(event, rawArgs, meta, logger) : event;
  }

  if (event.type === "done") {
    return {
      ...event,
      message: repairAssistantMessage(event.message, toolCallArgBuffers, meta, logger),
    };
  }

  if (event.type === "error") {
    return {
      ...event,
      error: repairAssistantMessage(event.error, toolCallArgBuffers, meta, logger),
    };
  }

  return event;
}

function repairToolCallEndEvent(
  event: Extract<AssistantMessageEvent, { type: "toolcall_end" }>,
  rawArgs: string,
  meta: RepairRuntimeMeta,
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
        `[nanogpt] Repaired malformed tool call arguments from model ${meta.modelId} for tool "${event.toolCall.name}"`,
      );
      logReliabilityArtifact(logger, meta, {
        event: "repair_success",
        repairStage: "toolcall_end",
        toolName: event.toolCall.name,
        rawArgumentLength: rawArgs.length,
      });

      return {
        ...event,
        toolCall: {
          ...event.toolCall,
          arguments: parsed,
        },
        partial: repairAssistantMessage(event.partial, new Map([[event.contentIndex, rawArgs]]), meta, logger, true),
      };
    } catch {
      logReliabilityArtifact(logger, meta, {
        event: "repair_failed",
        repairStage: "toolcall_end",
        toolName: event.toolCall.name,
        rawArgumentLength: rawArgs.length,
      });
      // If even jsonrepair fails, we just pass through and let the core handle the error
      return event;
    }
  }
}

function repairAssistantMessage(
  message: AssistantMessage,
  buffers: Map<number, string>,
  meta: RepairRuntimeMeta,
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
              `[nanogpt] Repaired malformed tool call arguments in final message from model ${meta.modelId} for tool "${block.name}"`,
            );
            logReliabilityArtifact(logger, meta, {
              event: "repair_success",
              repairStage: "final_message",
              toolName: block.name,
              rawArgumentLength: rawArgs.length,
            });
          }
          changed = true;
          return { ...block, arguments: parsed };
        } catch {
          if (!silent) {
            logReliabilityArtifact(logger, meta, {
              event: "repair_failed",
              repairStage: "final_message",
              toolName: block.name,
              rawArgumentLength: rawArgs.length,
            });
          }
          return block;
        }
      }
    }
    return block;
  });

  return changed ? { ...message, content: newContent as any } : message;
}
