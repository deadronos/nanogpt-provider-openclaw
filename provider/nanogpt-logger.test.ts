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
  });

  it("redacts keys containing sensitive substrings from meta", async () => {
    const log = createNanoGptLoggerSync("test-redact-substrings");
    log.info("test-redact-substrings-info", {
      normalKey: "visible",
      providerApiKey: "secret-api-key",
      mySecretKey: "secret-nanogpt-key",
      nested: { xTokenY: "secret-token", adminPasswordHash: "secret-password" },
      authorizationHeader: "secret-auth",
    });

    await new Promise((r) => setTimeout(r, 100));

    expect(existsSync(LOG_PATH)).toBe(true);
    const contents = readFileSync(LOG_PATH, "utf8");
    expect(contents).toContain("test-redact-substrings-info");
    expect(contents).toContain('"normalKey":"visible"');
    expect(contents).toContain('"providerApiKey":"[REDACTED]"');
    expect(contents).toContain('"mySecretKey":"[REDACTED]"');
    expect(contents).toContain('"xTokenY":"[REDACTED]"');
    expect(contents).toContain('"adminPasswordHash":"[REDACTED]"');
    expect(contents).toContain('"authorizationHeader":"[REDACTED]"');
    expect(contents).not.toContain("secret-api-key");
    expect(contents).not.toContain("secret-nanogpt-key");
    expect(contents).not.toContain("secret-token");
    expect(contents).not.toContain("secret-password");
    expect(contents).not.toContain("secret-auth");
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

    const { createNanoGptLoggerSync: createLoggerWithFailingFs } = await import(
      "./nanogpt-logger.js"
    );
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

    const { createNanoGptLoggerSync: createLoggerWithFailingFs } = await import(
      "./nanogpt-logger.js"
    );
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
