import { createWriteStream } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";

const NANOGPT_LOG_DIR = ".openclaw/logs/nanogpt";

export async function createNanoGptLogDir(logFileName: string): Promise<{
  writeLine: (line: string) => void;
  close: () => void;
}> {
  const logDir = homedir() + "/" + NANOGPT_LOG_DIR;
  await mkdir(logDir, { recursive: true });

  const logPath = logDir + "/" + logFileName;
  const fileHandle = await open(logPath, "a");
  const stream = createWriteStream(logPath, { flags: "a", encoding: "utf8" });

  // Keep the file handle open for the lifetime of the process
  stream.on("error", () => {
    // Non-fatal — let writes continue to stdout as fallback
  });

  return {
    writeLine(line: string) {
      stream.write(line);
    },
    close() {
      stream.end();
      void fileHandle.close();
    },
  };
}
