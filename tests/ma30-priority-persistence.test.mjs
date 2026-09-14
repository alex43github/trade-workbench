import assert from "node:assert/strict";
import test from "node:test";
import {
  appendMa30PriorityCycle,
  ensureMa30PriorityPersistenceSchema,
  hasMa30PriorityRun,
  loadLatestFullMa30PrioritySource,
  loadMa30PriorityState,
  loadRecentMa30PriorityEventKeys,
} from "../lib/radar/ma30-priority-persistence.ts";

class FakeStatement {
  constructor(db, sql) { this.db = db; this.sql = sql; this.args = []; }
  bind(...args) { this.args = args; return this; }
  async run() { this.db.runs.push({ sql: this.sql, args: this.args }); return { success: true }; }
  async first() {
    this.db.firstCalls.push({ sql: this.sql, args: this.args });
    if (/FROM ma30_scan_runs/.test(this.sql)) return this.db.fullSourceRow;
    if (/FROM ma30_priority_state/.test(this.sql)) return this.db.priorityStateRow;
    if (/FROM ma30_priority_runs/.test(this.sql)) return this.db.existingPriorityRun ? { run_id: this.args[0] } : null;
    return null;
  }
  async all() {
    this.db.allCalls.push({ sql: this.sql, args: this.args });
    if (/FROM ma30_priority_events/.test(this.sql)) return { results: this.db.eventKeyRows };
    return { results: [] };
  }
}
class FakeDb {
  constructor() {
    this.prepared = []; this.runs = []; this.batches = []; this.firstCalls = []; this.allCalls = [];
    this.fullSourceRow = null; this.priorityStateRow = null; this.existingPriorityRun = false; this.eventKeyRows = [];
  }
  prepare(sql) { this.prepared.push(sql); return new FakeStatement(this, sql); }
  async batch(statements) {
    this.batches.push(statements.map((s) => ({ sql: s.sql, args: s.args })));
    for (const statement of statements) await statement.run();
    return [];
  }
}

const notificationState = { a: [], b: [], c: [{ symbol: "KOMAUSDT", rank: 1, stage: "EARLY_ACCELERATION" }], shorts: [], ai: [] };

test("creates isolated priority state/run/event tables without altering hourly MA30 tables", async () => {
  const db = new FakeDb();
  await ensureMa30PriorityPersistenceSchema(db);
  const sql = db.prepared.join("\n");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_priority_state/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_priority_runs/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ma30_priority_events/);
  assert.equal(/CREATE TABLE IF NOT EXISTS ma30_scan_runs/.test(sql), false);
});

test("loads only latest FULL hourly MA30 notification state as discovery source", async () => {
  const db = new FakeDb();
  db.fullSourceRow = {
    run_id: "ma30:2026-09-14T12",
    run_time_utc: "2026-09-14T04:02:05.000Z",
    notification_state_json: JSON.stringify(notificationState),
  };
  const source = await loadLatestFullMa30PrioritySource(db);
  assert.equal(source.runId, "ma30:2026-09-14T12");
  assert.equal(source.runTimeMs, Date.parse("2026-09-14T04:02:05.000Z"));
  assert.deepEqual(source.notificationState, notificationState);
  const query = db.firstCalls[0].sql;
  assert.match(query, /status = 'FULL'/);
  assert.match(query, /ORDER BY run_time_utc DESC/);
});

test("loads empty runtime state safely when priority watcher has never run", async () => {
  const db = new FakeDb();
  assert.deepEqual(await loadMa30PriorityState(db), { sourceRunId: null, watchlist: [], reignitionState: {} });
});

test("loads persisted watchlist and reignition state", async () => {
  const db = new FakeDb();
  const watchlist = [{ symbol: "KOMAUSDT", direction: "LONG", expiresAt: 123 }];
  const reignitionState = { "KOMAUSDT:LONG": { lastPullbackAt: 1, lastIgnitedPullbackAt: null, lastIgnitedAt: null } };
  db.priorityStateRow = { source_run_id: "ma30:1", watchlist_json: JSON.stringify(watchlist), reignition_state_json: JSON.stringify(reignitionState) };
  assert.deepEqual(await loadMa30PriorityState(db), { sourceRunId: "ma30:1", watchlist, reignitionState });
});

test("loads recent event keys for restart-safe Bark dedupe", async () => {
  const db = new FakeDb();
  db.eventKeyRows = [{ event_key: "a" }, { event_key: "b" }];
  const keys = await loadRecentMa30PriorityEventKeys(db, 123456);
  assert.deepEqual([...keys], ["a", "b"]);
  assert.equal(db.allCalls[0].args[0], 123456);
});

test("duplicate watcher run is restart-safe", async () => {
  const db = new FakeDb();
  db.existingPriorityRun = true;
  assert.equal(await hasMa30PriorityRun(db, "priority:1"), true);
  db.existingPriorityRun = false;
  assert.equal(await hasMa30PriorityRun(db, "priority:2"), false);
});

test("appends run, events, and singleton state in one atomic batch", async () => {
  const db = new FakeDb();
  await appendMa30PriorityCycle(db, {
    runId: "ma30-priority:123",
    runTimeUtc: "2026-09-14T04:19:05.000Z",
    sourceRunId: "ma30:2026-09-14T12",
    coverage: { watched: 1, fetched: 1, failed: 0 },
    watchlist: [{ symbol: "KOMAUSDT", direction: "LONG", expiresAt: 999 }],
    reignitionState: {},
    events: [{
      eventKey: "ma30-cross:KOMAUSDT:15m:1:LONG",
      eventType: "MA30_CROSS",
      symbol: "KOMAUSDT",
      direction: "LONG",
      interval: "15m",
      signalCloseTime: 1,
      payload: { eventKey: "ma30-cross:KOMAUSDT:15m:1:LONG" },
    }],
  });
  assert.equal(db.batches.length, 1);
  const sql = db.batches[0].map((row) => row.sql).join("\n");
  assert.match(sql, /INSERT INTO ma30_priority_runs/);
  assert.match(sql, /INSERT INTO ma30_priority_events/);
  assert.match(sql, /INSERT INTO ma30_priority_state/);
  assert.match(sql, /ON CONFLICT\(singleton_id\) DO UPDATE/);
});