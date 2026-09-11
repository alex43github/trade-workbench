import assert from "node:assert/strict";
import test from "node:test";

import { dueJobs } from "../services/workbench/maintenance-schedule.mjs";

test("maintenance runs at the five-minute post-close slot", () => {
  assert.deepEqual(dueJobs(new Date("2026-08-28T00:05:00.000Z")), ["atr-band", "reversal-hourly", "reversal-four-hour", "daily"]);
  assert.deepEqual(dueJobs(new Date("2026-08-28T01:05:00.000Z")), ["atr-band", "reversal-hourly"]);
  assert.deepEqual(dueJobs(new Date("2026-08-28T17:05:00.000Z")), ["reversal-hourly"]);
  assert.deepEqual(dueJobs(new Date("2026-08-28T00:00:00.000Z")), []);
});
