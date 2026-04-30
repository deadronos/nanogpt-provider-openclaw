import { beforeAll, describe, expect, it, vi } from "vitest";
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

  it("falls back to a no-op logger when the log directory cannot be created", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        mkdirSync: vi.fn(() => {
          throw new Error("readonly home");
        }),
      };
    });

    const { createNanoGptLoggerSync: createLoggerWithFailingFs } =
      await import("./nanogpt-logger.js");
    const log = createLoggerWithFailingFs("readonly-home");

    expect(() => {
      log.info("test-info");
      log.warn("test-warn");
      log.error("test-error");
    }).not.toThrow();

    vi.doUnmock("node:fs");
    vi.resetModules();
  });
});
