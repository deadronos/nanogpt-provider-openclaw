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

  it("redacts sensitive keys from meta", async () => {
    const log = createNanoGptLoggerSync("test-redact");
    log.info("test-redact-info", {
      normalKey: "visible",
      apiKey: "secret-api-key",
      nanoGptApiKey: "secret-nanogpt-key",
      nested: { token: "secret-token", password: "secret-password" },
      authorization: "secret-auth",
      providerApiKey: "secret-provider-key",
      prompt_tokens: 150,
      completion_tokens: 50,
      total_tokens: 200,
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(existsSync(LOG_PATH)).toBe(true);
    const contents = readFileSync(LOG_PATH, "utf8");
    expect(contents).toContain("test-redact-info");
    expect(contents).toContain('"normalKey":"visible"');
    expect(contents).toContain('"apiKey":"[REDACTED]"');
    expect(contents).toContain('"nanoGptApiKey":"[REDACTED]"');
    expect(contents).toContain('"token":"[REDACTED]"');
    expect(contents).toContain('"password":"[REDACTED]"');
    expect(contents).toContain('"authorization":"[REDACTED]"');
    expect(contents).not.toContain("secret-api-key");
    expect(contents).not.toContain("secret-nanogpt-key");
    expect(contents).not.toContain("secret-token");
    expect(contents).not.toContain("secret-password");
    expect(contents).not.toContain("secret-auth");
    expect(contents).toContain('"providerApiKey":"[REDACTED]"');
    expect(contents).not.toContain("secret-provider-key");
    expect(contents).toContain('"prompt_tokens":150');
    expect(contents).toContain('"completion_tokens":50');
    expect(contents).toContain('"total_tokens":200');
  });

  it("handles circular references in metadata gracefully without throwing and writes the message", async () => {
    const log = createNanoGptLoggerSync("test-circular");
    const circularObj: any = { key: "value" };
    circularObj.self = circularObj;

    expect(() => {
      log.info("test-circular-info", circularObj);
    }).not.toThrow();

    await new Promise((r) => setTimeout(r, 100));

    expect(existsSync(LOG_PATH)).toBe(true);
    const contents = readFileSync(LOG_PATH, "utf8");
    expect(contents).toContain("[info] [test-circular] test-circular-info [Serialization Failed]");
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

  it("falls back to a no-op logger when the log file cannot be created", async () => {
    vi.resetModules();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        createWriteStream: vi.fn(() => {
          throw new Error("readonly file");
        }),
      };
    });

    const { createNanoGptLoggerSync: createLoggerWithFailingFs } =
      await import("./nanogpt-logger.js");
    const log = createLoggerWithFailingFs("readonly-file");

    expect(() => {
      log.info("test-info");
      log.warn("test-warn");
      log.error("test-error");
    }).not.toThrow();

    vi.doUnmock("node:fs");
    vi.resetModules();
  });
});
