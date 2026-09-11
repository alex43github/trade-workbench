import assert from "node:assert/strict";
import test from "node:test";
import { BinanceRequestPacer, retryDelayMs, withRetries } from "../lib/radar/binance-throttle.ts";

test("uses bounded exponential backoff for retryable public requests", () => {
  assert.equal(retryDelayMs(1, 100), 100);
  assert.equal(retryDelayMs(2, 100), 200);
  assert.equal(retryDelayMs(20, 100), 8000);
});

test("serializes requests through one public-request pacer", async () => {
  const starts = [];
  const pacer = new BinanceRequestPacer({ minIntervalMs: 0, sleep: async () => {} });
  await Promise.all([
    pacer.run(async () => { starts.push("a"); }),
    pacer.run(async () => { starts.push("b"); }),
  ]);
  assert.deepEqual(starts, ["a", "b"]);
});

test("does not wait for a previous request to finish before starting the next one", async () => {
  const starts = [];
  let releaseFirst;
  const firstFinished = new Promise((resolve) => { releaseFirst = resolve; });
  const pacer = new BinanceRequestPacer({ minIntervalMs: 0, sleep: async () => {} });

  const first = pacer.run(async () => {
    starts.push("a");
    await firstFinished;
  });
  const second = pacer.run(async () => {
    starts.push("b");
  });

  const secondStarted = await Promise.race([
    second.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 50)),
  ]);
  releaseFirst();
  await Promise.all([first, second]);

  assert.equal(secondStarted, true);
  assert.deepEqual(starts, ["a", "b"]);
});

test("retries a transient request and then returns its result", async () => {
  let attempts = 0;
  const sleeps = [];
  const result = await withRetries(async () => {
    attempts += 1;
    if (attempts < 3) throw new Error("429");
    return "ok";
  }, { sleep: async (milliseconds) => sleeps.push(milliseconds) });
  assert.equal(result, "ok");
  assert.equal(attempts, 3);
  assert.deepEqual(sleeps, [1000, 2000]);
});
