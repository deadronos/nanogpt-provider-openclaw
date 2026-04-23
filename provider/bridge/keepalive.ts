const SSE_KEEPALIVE_CHUNK = ": keepalive\n\n";

export function buildSseKeepaliveChunk(): Uint8Array {
  return new TextEncoder().encode(SSE_KEEPALIVE_CHUNK);
}

export function createKeepaliveTimer(callback: () => void, intervalMs = 15_000): {
  start: () => void;
  stop: () => void;
} {
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (timer !== null) {
        return;
      }
      timer = setInterval(callback, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer === null) {
        return;
      }
      clearInterval(timer);
      timer = null;
    },
  };
}
