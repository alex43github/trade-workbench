import test from "node:test";
import assert from "node:assert/strict";
import { withExitOnlyLock } from "./exit-lock.mjs";

test("同一 position key 的 EXIT_ONLY 临界区串行执行", async () => {
  const events = [];
  let releaseFirst;
  const first = withExitOnlyLock("BTCUSDT:BOTH", async () => {
    events.push("first-start");
    await new Promise((resolve) => { releaseFirst = resolve; });
    events.push("first-end");
  });
  const second = withExitOnlyLock("BTCUSDT:BOTH", async () => { events.push("second"); });
  await Promise.resolve();
  assert.deepEqual(events, ["first-start"]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(events, ["first-start", "first-end", "second"]);
});
