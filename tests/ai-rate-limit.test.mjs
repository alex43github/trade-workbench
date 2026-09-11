import assert from "node:assert/strict";
import test from "node:test";

import { createAiRequestLimiter } from "../lib/security/ai-rate-limit.ts";

test("AI limiter caps concurrent requests and releases a completed request", () => {
  const limiter = createAiRequestLimiter({ maxRequests: 10, windowMs: 60_000, maxConcurrent: 2 });
  const first = limiter.acquire(1_000);
  const second = limiter.acquire(1_000);
  const blocked = limiter.acquire(1_000);

  assert.equal(first.allowed, true);
  assert.equal(second.allowed, true);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "concurrency");

  first.release?.();
  assert.equal(limiter.acquire(1_000).allowed, true);
});

test("AI limiter enforces a rolling request window", () => {
  const limiter = createAiRequestLimiter({ maxRequests: 2, windowMs: 60_000, maxConcurrent: 5 });
  const first = limiter.acquire(1_000);
  const second = limiter.acquire(1_001);
  first.release?.();
  second.release?.();

  const blocked = limiter.acquire(1_002);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.reason, "rate");
  assert.ok((blocked.retryAfterMs ?? 0) > 0);

  assert.equal(limiter.acquire(61_001).allowed, true);
});
