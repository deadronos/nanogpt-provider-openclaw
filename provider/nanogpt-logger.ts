import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

export type NanoGptLogLevel = "info" | "warn" | "error";

export type NanoGptLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

const LOGGERS = new Map<string, NanoGptLogger>();
const NANOGPT_LOG_DIR = ".openclaw/logs/nanogpt";
const LOG_FILE = "nanogpt.log";

let _stream: ReturnType<typeof createWriteStream> | null = null;
let _streamPromise: Promise<void> | null = null;

function getOrCreateStream(): { stream: ReturnType<typeof createWriteStream>; ready: Promise<void> } {
  if (_stream) {
    return { stream: _stream, ready: _streamPromise ?? Promise.resolve() };
  }

  const logDir = homedir() + "/" + NANOGPT_LOG_DIR;
  mkdirSync(logDir, { recursive: true });

  const logPath = logDir + "/" + LOG_FILE;
  const stream = createWriteStream(logPath, { flags: "a", encoding: "utf8" });
  _stream = stream;

  let resolveStream: () => void;
  _streamPromise = new Promise((resolve) => {
    resolveStream = resolve;
  });

  stream.on("open", () => {
    resolveStream!();
  });

  stream.on("error", () => {
    // Non-fatal
  });

  return { stream, ready: _streamPromise };
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatLogLine(level: NanoGptLogLevel, module: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = formatTimestamp();
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level}] [${module}] ${message}${metaStr}\n`;
}

export function createNanoGptLoggerSync(module: string): NanoGptLogger {
  const cached = LOGGERS.get(module);
  if (cached) return cached;

  const { stream } = getOrCreateStream();

  const logger: NanoGptLogger = {
    info(message: string, meta?: Record<string, unknown>) {
      stream.write(formatLogLine("info", module, message, meta));
    },
    warn(message: string, meta?: Record<string, unknown>) {
      stream.write(formatLogLine("warn", module, message, meta));
    },
    error(message: string, meta?: Record<string, unknown>) {
      stream.write(formatLogLine("error", module, message, meta));
    },
  };

  LOGGERS.set(module, logger);
  return logger;
}

// Async version — waits for stream to be ready before writing
export async function createNanoGptLogger(module: string): Promise<NanoGptLogger> {
  const cached = LOGGERS.get(module);
  if (cached) return cached;

  const { stream, ready } = getOrCreateStream();
  await ready;

  const logger: NanoGptLogger = {
    info(message: string, meta?: Record<string, unknown>) {
      stream.write(formatLogLine("info", module, message, meta));
    },
    warn(message: string, meta?: Record<string, unknown>) {
      stream.write(formatLogLine("warn", module, message, meta));
    },
    error(message: string, meta?: Record<string, unknown>) {
      stream.write(formatLogLine("error", module, message, meta));
    },
  };

  LOGGERS.set(module, logger);
  return logger;
}
