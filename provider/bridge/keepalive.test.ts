import { describe, expect, it, vi } from "vitest";
import { buildSseKeepaliveChunk, createKeepaliveTimer } from "./keepalive.js";

describe("bridge keepalive helpers", () => {
  it("builds the SSE keepalive chunk", () => {
    expect(new TextDecoder().decode(buildSseKeepaliveChunk())).toBe(": keepalive\n\n");
  });

  it("starts and stops the keepalive timer", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const timer = createKeepaliveTimer(callback, 100);
    timer.start();
    vi.advanceTimersByTime(250);
    timer.stop();
    vi.advanceTimersByTime(250);
    expect(callback).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
