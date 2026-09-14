import assert from "node:assert/strict";
import test from "node:test";

import {
  appendMa30RuntimeSnapshot,
  ensureMa30RuntimePersistenceSchema,
  hasMa30RuntimeRun,
  loadLatestMa30LifecycleState,
} from "../lib/radar/ma30-runtime-persistence.ts";

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async run() { this.db.runs.push({ sql: this.sql, args: this.args }); return { success: true }; }
  async first() {
    this.db.firstCalls.push({ sql: this.sql, args: this.args });
    if (/WHERE run_id/.test(this.sql)) return this.db.existingRun ? { run_id: this.args[0] } : null;
    if (/lifecycle_json/.test(this.sql)) return this.db.latestLifecycle ? { lifecycle_json: JSON.stringify(this.db.latestLifecycle) } : null;
    return null;
  }
}

class FakeDb {
  constructor() { this.prepared = []; this.runs = []; this.batches = []; this.firstCalls = []; this.existingRun = false; this.latestLifecycle = null; }
  prepare(sql) { this.prepared.push(sql); return new FakeStatement(this, sql); }
  async batch(statements) {
    this.batches.push(statements.map((s) => ({ sql: s.sql, args: s.args })));
    for (const statement of statements) await statement.run();
    return [];
  }
}

const lifecycle = {
  version: "MA30_LIFECYCLE_V1",
  lastRunAt: "2026-09-14T12:00:00+08:00",
  groups: { A: {}, B: {}, C: {}, SHORT: {}, AI: {} },
};

test("runtime schema is append-only and creates scan/lifecycle snapshot tables", async () => {
  const db = new FakeDb();
  await ensureMa30RuntimePersistenceSchema(db);
  const sql = db.prepared.join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_scan_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_lifecycle_snapshots/);
  assert.equal(/UPDATE|REPLACE|ON CONFLICT/i.test(sql), false);
});

test("runtime snapshot appends scan and lifecycle in one batch without mutation SQL", async () => {
  const db = new FakeDb();
  await appendMa30RuntimeSnapshot(db, {
    runId: "ma30:2026-09-14T04:00:00.000Z",
    runTimeUtc: "2026-09-14T04:05:00.000Z",
    runTimeBjt: "2026-09-14T12:05:00+08:00",
    scannerVersion: "MA30_SCANNER_V1",
    status: "FULL",
    coverage: { universe: 528, fetchedSuccessfully: 528, slopeQualified: 528, insufficientHistory: 0, staleLastCandle: 0, failed: 0 },
    notificationState: { a: [], b: [], c: [], shorts: [], ai: [] },
    lifecycle,
  });
  assert.equal(db.batches.length, 1);
  assert.equal(db.batches[0].length, 2);
  const sql = db.batches[0].map((x) => x.sql).join("\n");
  assert.equal(/UPDATE|REPLACE|DELETE|ON CONFLICT/i.test(sql), false);
  assert.match(sql, /INSERT INTO ma30_scan_runs/);
  assert.match(sql, /INSERT INTO ma30_lifecycle_snapshots/);
});

test("hasRun makes duplicate hourly run ids restart-safe", async () => {
  const db = new FakeDb();
  db.existingRun = true;
  assert.equal(await hasMa30RuntimeRun(db, "same-run"), true);
  db.existingRun = false;
  assert.equal(await hasMa30RuntimeRun(db, "new-run"), false);
});

test("latest lifecycle state is restored from append-only snapshot", async () => {
  const db = new FakeDb();
  db.latestLifecycle = lifecycle;
  assert.deepEqual(await loadLatestMa30LifecycleState(db), lifecycle);
  db.latestLifecycle = null;
  assert.equal(await loadLatestMa30LifecycleState(db), undefined);
});
