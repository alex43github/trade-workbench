export type AiLimitResult = {
  allowed: boolean;
  reason?: "rate" | "concurrency";
  retryAfterMs?: number;
  release?: () => void;
};

export type AiRequestLimiter = {
  acquire: (now?: number) => AiLimitResult;
};

export function createAiRequestLimiter({
  maxRequests = 12,
  windowMs = 60_000,
  maxConcurrent = 2,
}: {
  maxRequests?: number;
  windowMs?: number;
  maxConcurrent?: number;
} = {}): AiRequestLimiter {
  let active = 0;
  let timestamps: number[] = [];

  return {
    acquire(now = Date.now()) {
      timestamps = timestamps.filter((timestamp) => now - timestamp < windowMs);
      if (active >= maxConcurrent) return { allowed: false, reason: "concurrency", retryAfterMs: 1_000 };
      if (timestamps.length >= maxRequests) {
        return { allowed: false, reason: "rate", retryAfterMs: Math.max(1, windowMs - (now - timestamps[0])) };
      }

      timestamps.push(now);
      active += 1;
      let released = false;
      return {
        allowed: true,
        release() {
          if (released) return;
          released = true;
          active = Math.max(0, active - 1);
        },
      };
    },
  };
}

const sharedLimiter = createAiRequestLimiter();

export function reserveAiRequest() {
  return sharedLimiter.acquire();
}
