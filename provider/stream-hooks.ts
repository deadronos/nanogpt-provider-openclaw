import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";
import { isRecord } from "../shared/guards.js";

type NanoGptWrappedStreamFn = ProviderWrapStreamFnContext["streamFn"];

type NanoGptLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

type NanoGptUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function inspectUsage(usage: unknown): { empty: boolean; invalidFields: string[] } {
  if (!isRecord(usage)) {
    return { empty: true, invalidFields: ["usage"] };
  }

  const invalidFields: string[] = [];
  const numericFields: Array<keyof NanoGptUsage> = [
    "input",
    "output",
    "cacheRead",
    "cacheWrite",
    "totalTokens",
  ];
  for (const field of numericFields) {
    if (!isFiniteNonNegativeNumber(usage[field])) {
      invalidFields.push(`usage.${field}`);
    }
  }

  if (!isRecord(usage.cost)) {
    invalidFields.push("usage.cost");
  } else {
    const costFields: Array<keyof NanoGptUsage["cost"]> = [
      "input",
      "output",
      "cacheRead",
      "cacheWrite",
      "total",
    ];
    for (const field of costFields) {
      if (!isFiniteNonNegativeNumber(usage.cost[field])) {
        invalidFields.push(`usage.cost.${field}`);
      }
    }
  }

  const empty =
    invalidFields.length === 0 &&
    usage.input === 0 &&
    usage.output === 0 &&
    usage.cacheRead === 0 &&
    usage.cacheWrite === 0 &&
    usage.totalTokens === 0 &&
    isRecord(usage.cost) &&
    usage.cost.input === 0 &&
    usage.cost.output === 0 &&
    usage.cost.cacheRead === 0 &&
    usage.cost.cacheWrite === 0 &&
    usage.cost.total === 0;

  return { empty, invalidFields };
}

function ensureIncludeUsageInStreamingPayload(payload: unknown): { payload?: unknown; requested: boolean } {
  if (!isRecord(payload)) {
    return { requested: false };
  }

  const streamValue = payload.stream;
  const isStreaming = streamValue === true || streamValue === "true";
  const hasStreamOptionsKey = "stream_options" in payload;
  if (!isStreaming && !hasStreamOptionsKey) {
    return { requested: false };
  }

  const existingStreamOptions = isRecord(payload.stream_options) ? payload.stream_options : undefined;
  const existingIncludeUsage = existingStreamOptions?.include_usage;
  if (existingIncludeUsage === true) {
    return { requested: true };
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

function scheduleUsageInStreamingWarning(params: {
  stream: unknown;
  logger?: NanoGptLogger;
  modelId: string;
  requestedIncludeUsage: boolean;
}): void {
  if (!params.requestedIncludeUsage) {
    return;
  }

  if (!params.stream || typeof (params.stream as any).result !== "function") {
    return;
  }

  void (params.stream as any)
    .result()
    .then((finalMessage: unknown) => {
      if (!isRecord(finalMessage)) {
        return;
      }
      const { empty, invalidFields } = inspectUsage(finalMessage.usage);
      if (!empty && invalidFields.length === 0) {
        return;
      }
      params.logger?.warn?.(
        `[nanogpt] requested stream_options.include_usage but received ${empty ? "empty" : "invalid"} usage in stream result`,
        {
          modelId: params.modelId,
          ...(invalidFields.length > 0 ? { invalidFields } : {}),
        },
      );
    })
    .catch(() => {
      // Non-blocking: usage warning is best-effort.
    });
}

export function wrapNanoGptStreamFn(
  ctx: ProviderWrapStreamFnContext,
  logger?: NanoGptLogger,
): NanoGptWrappedStreamFn {
  if (ctx.streamFn) {
    const streamFn = ctx.streamFn;
    const modelApi = ctx.model?.api;
    if (modelApi !== "openai-completions") {
      return streamFn;
    }

    const modelCompat = ctx.model?.compat;
    if (isRecord(modelCompat) && "supportsUsageInStreaming" in modelCompat) {
      if (modelCompat.supportsUsageInStreaming === false) {
        return streamFn;
      }
    }

    return async (model, context, options) => {
      let requestedIncludeUsage = false;
      const upstreamOnPayload = options?.onPayload;
      const patchedOptions = {
        ...(options ?? {}),
        onPayload: async (payload: unknown, payloadModel: unknown) => {
          const upstreamPayload =
            typeof upstreamOnPayload === "function"
              ? ((await upstreamOnPayload(payload, payloadModel as never)) ?? payload)
              : payload;

          const ensured = ensureIncludeUsageInStreamingPayload(upstreamPayload);
          if (ensured.requested) {
            requestedIncludeUsage = true;
          }
          return ensured.payload ?? upstreamPayload;
        },
      };

      const stream = await streamFn(model, context, patchedOptions);

      scheduleUsageInStreamingWarning({
        stream,
        logger,
        modelId: ctx.model?.id ?? ctx.modelId,
        requestedIncludeUsage,
      });

      return stream as any;
    };
  }
  return undefined;
}
