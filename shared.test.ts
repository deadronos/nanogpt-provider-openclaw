import { describe, expect, it } from "vitest";
import { isRecord } from "./shared/guards.js";
import { parseEpochMillis, parseFiniteNumber, parseFinitePositiveNumber } from "./shared/parse.js";
import { sanitizeApiKey, sanitizeHeaderValue } from "./shared/http.js";

describe("shared guards", () => {
  it("recognizes plain records and excludes arrays and null", () => {
    expect(isRecord({ a: 1 })).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
  });
});

describe("shared parse helpers", () => {
  it("parses finite numbers", () => {
    expect(parseFiniteNumber(1)).toBe(1);
    expect(parseFiniteNumber(" 2.5 ")).toBe(2.5);
    expect(parseFiniteNumber("")).toBeUndefined();
  });

  it("parses positive finite numbers", () => {
    expect(parseFinitePositiveNumber(1)).toBe(1);
    expect(parseFinitePositiveNumber(" 2.5 ")).toBe(2.5);
    expect(parseFinitePositiveNumber(0)).toBeUndefined();
  });

  it("parses epoch millis from seconds and ISO strings", () => {
    expect(parseEpochMillis(1_700_000_000)).toBe(1_700_000_000_000);
    expect(parseEpochMillis(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(parseEpochMillis("2026-04-22T00:00:00Z")).toBe(Date.parse("2026-04-22T00:00:00Z"));
  });
});

describe("shared http helpers", () => {
  it("removes carriage returns and line feeds from header values", () => {
    expect(sanitizeHeaderValue("a\r\nb")).toBe("ab");
    expect(sanitizeApiKey("\na\r")).toBe("a");
  });
});
