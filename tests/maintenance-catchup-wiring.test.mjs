import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const scheduler = fs.readFileSync(new URL("../services/workbench/maintenance-scheduler.mjs", import.meta.url), "utf8");
const route = fs.readFileSync(new URL("../app/api/advisory/maintenance/route.ts", import.meta.url), "utf8");

test("scheduler selects recoverable work and forwards the selected maintenance jobs", () => {
  assert.match(scheduler, /selectMaintenanceWork\(now, state\.completed\)/);
  assert.match(scheduler, /x-workbench-maintenance-jobs/);
});

test("maintenance endpoint honors catch-up selection for four-hour and daily work", () => {
  assert.match(route, /x-workbench-maintenance-jobs/);
  assert.match(route, /selectedJobs\?\.has\("reversal-four-hour"\)/);
  assert.match(route, /selectedJobs\?\.has\("daily"\)/);
});
