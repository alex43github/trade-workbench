import assert from "node:assert/strict";
import test from "node:test";

import { maintenanceRunKey, selectMaintenanceWork } from "../services/workbench/maintenance-schedule.mjs";

function compact(work) {
  return work.map(({ job, key, catchup }) => ({ job, key, catchup }));
}

test("maintenance carries a missed 08:05 four-hour and daily job into 09:05 without replaying stale hourly jobs", () => {
  const now = new Date("2026-09-15T01:05:00.000Z"); // 09:05 BJT
  assert.deepEqual(compact(selectMaintenanceWork(now, {})), [
    { job: "reversal-four-hour", key: "reversal-four-hour:2026-09-15:08", catchup: true },
    { job: "daily", key: "daily:2026-09-15", catchup: true },
    { job: "atr-band", key: "atr-band:2026-09-15:09", catchup: false },
    { job: "reversal-hourly", key: "reversal-hourly:2026-09-15:09", catchup: false },
  ]);
});

test("completed special jobs are not replayed", () => {
  const eight = new Date("2026-09-15T00:05:00.000Z");
  const completed = {
    [maintenanceRunKey(eight, "reversal-four-hour")]: "2026-09-15T00:06:00.000Z",
    [maintenanceRunKey(eight, "daily")]: "2026-09-15T00:06:00.000Z",
  };
  const now = new Date("2026-09-15T01:05:00.000Z");
  assert.deepEqual(compact(selectMaintenanceWork(now, completed)), [
    { job: "atr-band", key: "atr-band:2026-09-15:09", catchup: false },
    { job: "reversal-hourly", key: "reversal-hourly:2026-09-15:09", catchup: false },
  ]);
});

test("a missed four-hour slot expires once the next four-hour close is available, while daily remains recoverable", () => {
  const now = new Date("2026-09-15T04:05:00.000Z"); // 12:05 BJT
  const work = compact(selectMaintenanceWork(now, {}));
  assert.equal(work.some((item) => item.key === "reversal-four-hour:2026-09-15:08"), false);
  assert.equal(work.some((item) => item.key === "daily:2026-09-15" && item.catchup), true);
  assert.equal(work.some((item) => item.key === "reversal-four-hour:2026-09-15:12" && !item.catchup), true);
});
