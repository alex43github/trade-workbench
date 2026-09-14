import assert from "node:assert/strict";
import test from "node:test";

import {
  ensureMa30RuntimePersistenceSchema,
  loadMa30LifecycleEventsInWindow,
  prepareMa30RuntimeSnapshotStatements,
} from "../lib/radar/ma30-runtime-persistence.ts";

class Statement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async run() { this.db.runs.push({ sql: this.sql, args: this.args }); return { success: true }; }
  async all() { this.db.allCalls.push({ sql: this.sql, args: this.args }); return { results: this.db.rows, success: true, meta: {} }; }
}

class Db {
  constructor() { this.prepared = []; this.runs = []; this.allCalls = []; this.rows = []; }
  prepare(sql) { this.prepared.push(sql); return new Statement(this, sql); }
}

const event = {
  type: "ENTER",
  group: "C",
  symbol: "SENTUSDT",
  at: "2026-09-14 03:02:00",
  previousRank: null,
  currentRank: 1,
  previousStage: null,
  currentStage: "EARLY_ACCELERATION",
};

const state = {
  a: [], b: [], shorts: [], ai: [],
  c: [{ symbol: "SENTUSDT", rank: 1, stage: "EARLY_ACCELERATION", priceVsMa30Pct: 3.7 }],
};

const snapshot = {
  runId: "ma30:2026-09-14T03",
  runTimeUtc: "2026-09-13T19:02:00.000Z",
  runTimeBjt: "2026-09-14 03:02:00",
  scannerVersion: "MA30_SCANNER_V1",
  status: "FULL",
  coverage: {},
  notificationState: state,
  lifecycle: { version: "MA30_LIFECYCLE_V1", lastRunAt: "2026-09-14 03:02:00", groups: {} },
  lifecycleEvents: [event],
};

test("schema includes append-only lifecycle event table", async () => {
  const db = new Db();
  await ensureMa30RuntimePersistenceSchema(db);
  const sql = db.prepared.join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_lifecycle_events/);
  assert.doesNotMatch(sql, /UPDATE|REPLACE|ON CONFLICT/i);
});

test("runtime statements append every lifecycle event with stable event index", () => {
  const db = new Db();
  const statements = prepareMa30RuntimeSnapshotStatements(db, snapshot);
  assert.equal(statements.length, 3);
  assert.match(db.prepared.join("\n"), /INSERT INTO ma30_lifecycle_events/);
  const eventStmt = statements[2];
  assert.equal(eventStmt.args[0], snapshot.runId);
  assert.equal(eventStmt.args[1], 0);
  assert.equal(eventStmt.args[2], snapshot.runTimeBjt);
  assert.equal(eventStmt.args[3], "C");
  assert.equal(eventStmt.args[4], "SENTUSDT");
  assert.equal(eventStmt.args[5], "ENTER");
});

test("window loader joins event rows to frozen notification state", async () => {
  const db = new Db();
  db.rows = [{
    run_id: snapshot.runId,
    event_index: 0,
    run_time_bjt: snapshot.runTimeBjt,
    event_json: JSON.stringify(event),
    notification_state_json: JSON.stringify(state),
  }];
  const rows = await loadMa30LifecycleEventsInWindow(db, "2026-09-14 02:00:00", "2026-09-14 08:00:00");
  assert.equal(db.allCalls.length, 1);
  assert.match(db.allCalls[0].sql, /JOIN ma30_scan_runs/);
  assert.deepEqual(db.allCalls[0].args, ["2026-09-14 02:00:00", "2026-09-14 08:00:00"]);
  assert.equal(rows[0].event.symbol, "SENTUSDT");
  assert.equal(rows[0].notificationState.c[0].priceVsMa30Pct, 3.7);
});
