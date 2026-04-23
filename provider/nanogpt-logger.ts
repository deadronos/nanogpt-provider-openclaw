import { createNanoGptLogDir } from "./log-dir.js";

export type NanoGptLogLevel = "info" | "warn" | "error";

export type NanoGptLogMessage = {
  level: NanoGptLogLevel;
  module: string;
  message: string;
  meta?: Record<string, unknown>;
  timestamp: string;
};

export type NanoGptLogger = {
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
};

const LOGGERS = new Map<string, NanoGptLogger>();
const LOG_FILE = "nanogpt.log";

let _logHandle: Awaited<ReturnType<typeof createNanoGptLogDir>> | null = null;
let _logHandlePromise: Promise<Awaited<ReturnType<typeof createNanoGptLogDir>>> | null = null;

async function getLogHandle(): Promise<{
  writeLine: (line: string) => void;
  close: () => void;
}> {
  if (_logHandle) return _logHandle;
  if (_logHandlePromise) return _logHandlePromise;
  _logHandlePromise = createNanoGptLogDir(LOG_FILE).then((handle) => {
    _logHandle = handle;
    return handle;
  });
  return _logHandlePromise;
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatLogLine(level: NanoGptLogLevel, module: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = formatTimestamp();
  const metaStr = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
  return `${timestamp} [${level}] [${module}] ${message}${metaStr}\n`;
}

export async function createNanoGptLogger(module: string): Promise<NanoGptLogger> {
  const cached = LOGGERS.get(module);
  if (cached) return cached;

  const handle = await getLogHandle();

  const logger: NanoGptLogger = {
    info(message: string, meta?: Record<string, unknown>) {
      handle.writeLine(formatLogLine("info", module, message, meta));
    },
    warn(message: string, meta?: Record<string, unknown>) {
      handle.writeLine(formatLogLine("warn", module, message, meta));
    },
    error(message: string, meta?: Record<string, unknown>) {
      handle.writeLine(formatLogLine("error", module, message, meta));
    },
  };

  LOGGERS.set(module, logger);
  return logger;
}

// Synchronous version — blocks on the handle being ready
export function createNanoGptLoggerSync(module: string): NanoGptLogger {
  const cached = LOGGERS.get(module);
  if (cached) return cached;

  // If the async handle isn't ready yet, fall back to a no-op logger until the first async call
  // has resolved. This avoids throwing during sync module init.
  const logger: NanoGptLogger = {
    info(_message: string, _meta?: Record<string, unknown>) {},
    warn(_message: string, _meta?: Record<string, unknown>) {},
    error(_message: string, _meta?: Record<string, unknown>) {},
  };

  // Upgrade once the handle is ready
  getLogHandle()
    .then((handle) => {
      const realLogger: NanoGptLogger = {
        info(message: string, meta?: Record<string, unknown>) {
          handle.writeLine(formatLogLine("info", module, message, meta));
        },
        warn(message: string, meta?: Record<string, unknown>) {
          handle.writeLine(formatLogLine("warn", module, message, meta));
        },
        error(message: string, meta?: Record<string, unknown>) {
          handle.writeLine(formatLogLine("error", module, message, meta));
        },
      };
      LOGGERS.set(module, realLogger);
    })
    .catch(() => {});

  return logger;
}

export async function closeNanoGptLogs(): Promise<void> {
  const handle = await getLogHandle();
  handle.close();
}
