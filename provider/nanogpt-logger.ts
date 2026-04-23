import { createWriteStream, mkdirSync } from "node:fs";
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
const NOOP_LOGGER: NanoGptLogger = {
  info() {},
  warn() {},
  error() {},
};

let _stream: ReturnType<typeof createWriteStream> | null = null;
let _streamPromise: Promise<void> | null = null;

function getOrCreateStream(): { stream: ReturnType<typeof createWriteStream>; ready: Promise<void> } | null {
  if (_stream) {
    return { stream: _stream, ready: _streamPromise ?? Promise.resolve() };
  }

  const logDir = homedir() + "/" + NANOGPT_LOG_DIR;
  try {
    mkdirSync(logDir, { recursive: true });
  } catch {
    return null;
  }

  const logPath = logDir + "/" + LOG_FILE;
  let stream: ReturnType<typeof createWriteStream>;
  try {
    stream = createWriteStream(logPath, { flags: "a", encoding: "utf8" });
  } catch {
    return null;
  }
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

function writeLogLine(
  stream: ReturnType<typeof createWriteStream>,
  level: NanoGptLogLevel,
  module: string,
  message: string,
  meta?: Record<string, unknown>,
): void {
  try {
    stream.write(formatLogLine(level, module, message, meta));
  } catch {
    // Logging must not affect provider behavior.
  }
}

export function createNanoGptLoggerSync(module: string): NanoGptLogger {
  const cached = LOGGERS.get(module);
  if (cached) return cached;

  const streamState = getOrCreateStream();
  if (!streamState) {
    LOGGERS.set(module, NOOP_LOGGER);
    return NOOP_LOGGER;
  }
  const { stream } = streamState;

  const logger: NanoGptLogger = {
    info(message: string, meta?: Record<string, unknown>) {
      writeLogLine(stream, "info", module, message, meta);
    },
    warn(message: string, meta?: Record<string, unknown>) {
      writeLogLine(stream, "warn", module, message, meta);
    },
    error(message: string, meta?: Record<string, unknown>) {
      writeLogLine(stream, "error", module, message, meta);
    },
  };

  LOGGERS.set(module, logger);
  return logger;
}

// Async version — waits for stream to be ready before writing
export async function createNanoGptLogger(module: string): Promise<NanoGptLogger> {
  const cached = LOGGERS.get(module);
  if (cached) return cached;

  const streamState = getOrCreateStream();
  if (!streamState) {
    LOGGERS.set(module, NOOP_LOGGER);
    return NOOP_LOGGER;
  }
  const { stream, ready } = streamState;
  await ready;

  const logger: NanoGptLogger = {
    info(message: string, meta?: Record<string, unknown>) {
      writeLogLine(stream, "info", module, message, meta);
    },
    warn(message: string, meta?: Record<string, unknown>) {
      writeLogLine(stream, "warn", module, message, meta);
    },
    error(message: string, meta?: Record<string, unknown>) {
      writeLogLine(stream, "error", module, message, meta);
    },
  };

  LOGGERS.set(module, logger);
  return logger;
}
