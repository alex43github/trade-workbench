import assert from "node:assert/strict";
import test from "node:test";

import { getMaintenancePlan, maintenanceRunKey, schedulerStatus, selectDueJobs } from "../lib/workbench/scheduler.ts";

test("scheduler uses closed-candle Asia/Shanghai slots", () => {
  const daily = getMaintenancePlan(new Date("2026-08-20T00:00:00.000Z")); // 08:00 Shanghai
  assert.deepEqual(daily, { fourHour: true, daily: true, timezone: "Asia/Shanghai" });

  const fourHour = getMaintenancePlan(new Date("2026-08-20T04:00:00.000Z")); // 12:00 Shanghai
  assert.deepEqual(fourHour, { fourHour: true, daily: false, timezone: "Asia/Shanghai" });

  const between = getMaintenancePlan(new Date("2026-08-20T03:59:00.000Z"));
  assert.deepEqual(between, { fourHour: false, daily: false, timezone: "Asia/Shanghai" });
});

test("scheduler emits each due job once per closed-candle slot", () => {
  const now = new Date("2026-08-20T00:00:00.000Z");
  const key = maintenanceRunKey(now, "4h");
  assert.deepEqual(selectDueJobs(now, new Set()), ["4h", "daily"]);
  assert.deepEqual(selectDueJobs(now, new Set([key])), ["daily"]);
  assert.equal(maintenanceRunKey(now, "daily"), "daily:2026-08-20");
});

test("scheduler health distinguishes disabled, current, stale, and failed persisted runs", () => {
  const configured = { WORKBENCH_BASE_URL: "https://workbench.example", MAINTENANCE_JOB_TOKEN: "test-token" };
  const now = new Date("2026-08-21T00:00:00.000Z");

  assert.equal(schedulerStatus({}, { lastRunStatus: "completed", lastRunAt: "2026-08-20T23:00:00.000Z" }, now).state, "disabled");
  assert.equal(schedulerStatus(configured, { lastRunStatus: "completed", lastRunAt: "2026-08-20T23:00:00.000Z" }, now).state, "current");
  assert.equal(schedulerStatus(configured, { lastRunStatus: "completed", lastRunAt: "2026-08-20T12:00:00.000Z" }, now).state, "stale");
  assert.equal(schedulerStatus(configured, { lastRunStatus: "failed", lastRunAt: "2026-08-20T23:00:00.000Z" }, now).state, "failed");
});

test("scheduler reports a stale running heartbeat instead of running forever", () => {
  const status = schedulerStatus(
    { WORKBENCH_BASE_URL: "https://workbench.example", MAINTENANCE_JOB_TOKEN: "test-token" },
    { lastRunStatus: "running", lastAttemptAt: "2026-08-20T12:00:00.000Z" },
    new Date("2026-08-21T00:00:00.000Z"),
  );
  assert.equal(status.state, "stale");
});

test("scheduler surfaces the sanitized persisted maintenance run record", () => {
  const latestRun = {
    startedAt: "2026-08-20T23:00:00.000Z",
    finishedAt: "2026-08-20T23:00:04.000Z",
    durationMs: 4000,
    status: "completed",
    scannerCounts: { crowding: 2, reversal4h: 3, reversalDaily: 0, ma30Oi: 1 },
    bark: { sent: 1, failed: 0, skipped: 2 },
    error: null,
  };
  const status = schedulerStatus(
    { WORKBENCH_BASE_URL: "https://workbench.example", MAINTENANCE_JOB_TOKEN: "test-token" },
    { lastRunStatus: "completed", lastRunAt: latestRun.finishedAt, latestRun },
    new Date("2026-08-21T00:00:00.000Z"),
  );
  assert.deepEqual(status.latestRun, latestRun);
});
