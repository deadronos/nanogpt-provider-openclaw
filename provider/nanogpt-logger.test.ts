import { describe, it, expect, beforeAll } from "vitest";
import { createNanoGptLoggerSync } from "./nanogpt-logger.js";
import { readFileSync, unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";

const LOG_PATH = homedir() + "/.openclaw/logs/nanogpt/nanogpt.log";

describe("nanogpt logger", () => {
  beforeAll(() => {
    try {
      unlinkSync(LOG_PATH);
    } catch {}
  });

  it("writes info/warn/error to the log file", async () => {
    const log = createNanoGptLoggerSync("test-verify");
    log.info("test-info", { key: "value" });
    log.warn("test-warn");
    log.error("test-error");

    // Stream buffers — give it a moment to flush
    await new Promise((r) => setTimeout(r, 100));

    expect(existsSync(LOG_PATH)).toBe(true);
    const contents = readFileSync(LOG_PATH, "utf8");
    expect(contents).toContain("[info] [test-verify] test-info");
    expect(contents).toContain("[warn] [test-verify] test-warn");
    expect(contents).toContain("[error] [test-verify] test-error");
    expect(contents).toContain('"key":"value"');
  });
});
