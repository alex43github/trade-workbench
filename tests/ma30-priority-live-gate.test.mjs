import assert from "node:assert/strict";
import test from "node:test";
import { resolveMa30PriorityNotificationMode } from "../lib/radar/ma30-priority-live-gate.ts";

test("priority watcher defaults to DRY_RUN", () => {
  assert.equal(resolveMa30PriorityNotificationMode([], {}), "DRY_RUN");
});

test("--live alone is refused without a dedicated priority Bark acknowledgement", () => {
  assert.throws(
    () => resolveMa30PriorityNotificationMode(["--live"], {}),
    /MA30_PRIORITY_ENABLE_LIVE_BARK=YES/,
  );
});

test("--live plus dedicated acknowledgement enables LIVE Bark", () => {
  assert.equal(resolveMa30PriorityNotificationMode(["--live"], { MA30_PRIORITY_ENABLE_LIVE_BARK: "YES" }), "LIVE");
});