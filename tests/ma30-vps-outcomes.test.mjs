import assert from "node:assert/strict";
import test from "node:test";

import {
  loadPendingMa30Outcomes,
} from "../lib/radar/ma30-vps-outcomes.ts";

function fakeDb(rows) {
  let sql = "";
  return {
    get sql() { return sql; },
    prepare(statement) {
      sql = statement;
      return {
        bind() { return this; },
        async all() { return { results: rows, success: true, meta: {} }; },
        async run() { return { success: true }; },
      };
    },
  };
}

test("pending loader joins frozen AI selections to scan UTC time and excludes existing outcomes", async () => {
  const db = fakeDb([{
    run_id: "ma30:2026-09-14T13",
    run_time_utc: "2026-09-14T05:16:36.485Z",
    symbol: "AAAUSDT",
    direction: "LONG",
    current_price: 100,
    horizon_hours: 3,
  }]);
  const rows = await loadPendingMa30Outcomes(db);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    runId: "ma30:2026-09-14T13",
    runTimeUtc: "2026-09-14T05:16:36.485Z",
    symbol: "AAAUSDT",
    direction: "LONG",
    entryPrice: 100,
    horizonHours: 3,
  });
  assert.match(db.sql, /ma30_ai_selections/);
  assert.match(db.sql, /ma30_scan_runs/);
  assert.match(db.sql, /ma30_ai_outcomes/);
  assert.match(db.sql, /LEFT JOIN/);
  assert.match(db.sql, /o\.run_id IS NULL/);
});

test("pending loader rejects malformed rows rather than fabricating outcomes", async () => {
  const db = fakeDb([
    { run_id: "x", run_time_utc: "bad", symbol: "AAAUSDT", direction: "LONG", current_price: 100, horizon_hours: 1 },
    { run_id: "y", run_time_utc: "2026-09-14T05:00:00Z", symbol: "BBBUSDT", direction: "SIDEWAYS", current_price: 100, horizon_hours: 1 },
    { run_id: "z", run_time_utc: "2026-09-14T05:00:00Z", symbol: "CCCUSDT", direction: "SHORT", current_price: 0, horizon_hours: 24 },
  ]);
  assert.deepEqual(await loadPendingMa30Outcomes(db), []);
});
