import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";

export type NanoGptWrappedStreamFn = ProviderWrapStreamFnContext["streamFn"];
export type NanoGptStreamResult = Awaited<ReturnType<NonNullable<NanoGptWrappedStreamFn>>>;

export type NanoGptToolCall = Readonly<{
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}>;

export type NanoGptAssistantContentBlock =
  | Readonly<{ type: "text"; text: string }>
  | Readonly<{ type: "thinking"; thinking: string }>
  | NanoGptToolCall
  | (Record<string, unknown> & { type: string });

export type NanoGptUsage = {
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

export type NanoGptAssistantMessage = Readonly<{
  role: string;
  content: NanoGptAssistantContentBlock[];
  stopReason: string;
  usage?: NanoGptUsage;
  api?: string;
  provider?: string;
  model?: string;
  timestamp?: number;
}>;

export type NanoGptReplayEvent =
  | Readonly<{ type: "start"; partial: NanoGptAssistantMessage }>
  | Readonly<{ type: "text_start"; contentIndex: number; partial: NanoGptAssistantMessage }>
  | Readonly<{ type: "text_delta"; contentIndex: number; delta: string; partial: NanoGptAssistantMessage }>
  | Readonly<{ type: "text_end"; contentIndex: number; content: string; partial: NanoGptAssistantMessage }>
  | Readonly<{ type: "thinking_start"; contentIndex: number; partial: NanoGptAssistantMessage }>
  | Readonly<{ type: "thinking_delta"; contentIndex: number; delta: string; partial: NanoGptAssistantMessage }>
  | Readonly<{ type: "thinking_end"; contentIndex: number; content: string; partial: NanoGptAssistantMessage }>
  | Readonly<{ type: "toolcall_start"; contentIndex: number; partial: NanoGptAssistantMessage }>
  | Readonly<{ type: "toolcall_delta"; contentIndex: number; delta: string; partial: NanoGptAssistantMessage }>
  | Readonly<{
      type: "toolcall_end";
      contentIndex: number;
      toolCall: NanoGptToolCall;
      partial: NanoGptAssistantMessage;
    }>
  | Readonly<{
      type: "done";
      reason: "stop" | "length" | "toolUse";
      message: NanoGptAssistantMessage;
    }>;

export type NanoGptReplayStream = {
  push: (event: NanoGptReplayEvent) => void;
  end: (message?: NanoGptAssistantMessage) => void;
  result: () => Promise<NanoGptAssistantMessage>;
  [Symbol.asyncIterator]: () => AsyncIterator<NanoGptReplayEvent>;
};

export type NanoGptPluginLogger = {
  warn?: (message: string, meta?: Record<string, unknown>) => void;
};

export type NanoGptRequestToolMetadata = Readonly<{
  toolEnabled: boolean;
  toolCount: number;
  toolNames: readonly string[];
}>;

export type NanoGptStreamContentInspection = Readonly<{
  visibleText: string;
  visibleTextLength: number;
  textBlockCount: number;
  toolCallCount: number;
  thinkingBlockCount: number;
}>;