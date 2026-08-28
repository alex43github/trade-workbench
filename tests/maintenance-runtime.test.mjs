import assert from "node:assert/strict";
import test from "node:test";

import { dueJobs } from "../services/workbench/maintenance-schedule.mjs";

test("maintenance runs at the five-minute post-close slot", () => {
  assert.deepEqual(dueJobs(new Date("2026-08-28T00:05:00.000Z")), ["4h", "daily"]);
  assert.deepEqual(dueJobs(new Date("2026-08-28T00:00:00.000Z")), []);
});
