import assert from "node:assert/strict";
import test from "node:test";

import { resolveMa30VpsNotificationMode } from "../lib/radar/ma30-vps-runtime.ts";

test("VPS production runner defaults to DRY_RUN", () => {
  assert.equal(resolveMa30VpsNotificationMode([], {}), "DRY_RUN");
});

test("--live is rejected unless the explicit safety acknowledgement is present", () => {
  assert.throws(
    () => resolveMa30VpsNotificationMode(["--live"], {}),
    /MA30_ENABLE_LIVE_BARK=YES/i,
  );
});

test("--live is accepted only with MA30_ENABLE_LIVE_BARK=YES", () => {
  assert.equal(
    resolveMa30VpsNotificationMode(["--live"], { MA30_ENABLE_LIVE_BARK: "YES" }),
    "LIVE",
  );
});
