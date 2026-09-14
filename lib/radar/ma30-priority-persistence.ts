import type { Ma30PriorityScanLike, Ma30PriorityWatchItem } from "./ma30-priority-watchlist.ts";
import type { Ma30PriorityReignitionStateMap } from "./ma30-priority-watcher-cycle.ts";

export type Ma30PriorityStatement = {
  bind: (...args: unknown[]) => Ma30PriorityStatement;
  run: () => Promise<unknown>;
  first?: <T = Record<string, unknown>>() => Promise<T | null>;
  all?: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
};

export type Ma30PriorityDb = {
  prepare: (sql: string) => Ma30PriorityStatement;
  batch?: (statements: Ma30PriorityStatement[]) => Promise<unknown[]>;
};

export const MA30_PRIORITY_STATE_TABLE = "ma30_priority_state";
export const MA30_PRIORITY_RUN_TABLE = "ma30_priority_runs";
export const MA30_PRIORITY_EVENT_TABLE = "ma30_priority_events";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ${MA30_PRIORITY_STATE_TABLE} (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    source_run_id TEXT,
    watchlist_json TEXT NOT NULL,
    reignition_state_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ${MA30_PRIORITY_RUN_TABLE} (
    run_id TEXT PRIMARY KEY,
    run_time_utc TEXT NOT NULL,
    source_run_id TEXT NOT NULL,
    coverage_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ${MA30_PRIORITY_EVENT_TABLE} (
    event_key TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    event_type TEXT NOT NULL CHECK (event_type IN ('MA30_CROSS','REIGNITION')),
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
    interval TEXT NOT NULL CHECK (interval IN ('15m','1h')),
    signal_close_time INTEGER NOT NULL,
    event_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES ${MA30_PRIORITY_RUN_TABLE}(run_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ma30_priority_runs_time ON ${MA30_PRIORITY_RUN_TABLE}(run_time_utc)`,
  `CREATE INDEX IF NOT EXISTS idx_ma30_priority_events_close ON ${MA30_PRIORITY_EVENT_TABLE}(signal_close_time)`,
] as const;

export async function ensureMa30PriorityPersistenceSchema(db: Ma30PriorityDb) {
  for (const sql of SCHEMA) await db.prepare(sql).run();
}

export type Ma30PriorityHourlySourceRecord = {
  runId: string;
  runTimeMs: number;
  notificationState: Ma30PriorityScanLike;
};

export async function loadLatestFullMa30PrioritySource(db: Ma30PriorityDb): Promise<Ma30PriorityHourlySourceRecord | null> {
  const statement = db.prepare(`SELECT run_id, run_time_utc, notification_state_json
    FROM ma30_scan_runs
    WHERE status = 'FULL'
    ORDER BY run_time_utc DESC, created_at DESC
    LIMIT 1`);
  if (!statement.first) throw new Error("MA30 priority DB adapter must support first() for source loading");
  const row = await statement.first<{ run_id?: string; run_time_utc?: string; notification_state_json?: string }>();
  if (!row?.run_id || !row.run_time_utc || !row.notification_state_json) return null;
  const runTimeMs = Date.parse(row.run_time_utc);
  if (!Number.isFinite(runTimeMs)) throw new Error("Invalid MA30 hourly source run_time_utc");
  const notificationState = JSON.parse(row.notification_state_json) as Ma30PriorityScanLike;
  return { runId: row.run_id, runTimeMs, notificationState };
}

export type Ma30PriorityStoredState = {
  sourceRunId: string | null;
  watchlist: Ma30PriorityWatchItem[];
  reignitionState: Ma30PriorityReignitionStateMap;
};

export async function loadMa30PriorityState(db: Ma30PriorityDb): Promise<Ma30PriorityStoredState> {
  const statement = db.prepare(`SELECT source_run_id, watchlist_json, reignition_state_json
    FROM ${MA30_PRIORITY_STATE_TABLE}
    WHERE singleton_id = 1
    LIMIT 1`);
  if (!statement.first) throw new Error("MA30 priority DB adapter must support first() for state loading");
  const row = await statement.first<{ source_run_id?: string | null; watchlist_json?: string; reignition_state_json?: string }>();
  if (!row) return { sourceRunId: null, watchlist: [], reignitionState: {} };
  return {
    sourceRunId: row.source_run_id ?? null,
    watchlist: row.watchlist_json ? JSON.parse(row.watchlist_json) as Ma30PriorityWatchItem[] : [],
    reignitionState: row.reignition_state_json ? JSON.parse(row.reignition_state_json) as Ma30PriorityReignitionStateMap : {},
  };
}

export async function loadRecentMa30PriorityEventKeys(db: Ma30PriorityDb, sinceCloseTime: number): Promise<Set<string>> {
  const statement = db.prepare(`SELECT event_key FROM ${MA30_PRIORITY_EVENT_TABLE}
    WHERE signal_close_time >= ?
    ORDER BY signal_close_time ASC`).bind(sinceCloseTime);
  if (!statement.all) throw new Error("MA30 priority DB adapter must support all() for event dedupe loading");
  const result = await statement.all<{ event_key?: string }>();
  return new Set(result.results.map((row) => row.event_key).filter((value): value is string => Boolean(value)));
}

export async function hasMa30PriorityRun(db: Ma30PriorityDb, runId: string): Promise<boolean> {
  const statement = db.prepare(`SELECT run_id FROM ${MA30_PRIORITY_RUN_TABLE} WHERE run_id = ? LIMIT 1`).bind(runId);
  if (!statement.first) throw new Error("MA30 priority DB adapter must support first() for duplicate detection");
  return Boolean(await statement.first<{ run_id: string }>());
}

export type Ma30PriorityPersistedEvent = {
  eventKey: string;
  eventType: "MA30_CROSS" | "REIGNITION";
  symbol: string;
  direction: "LONG" | "SHORT";
  interval: "15m" | "1h";
  signalCloseTime: number;
  payload: unknown;
};

export type Ma30PriorityCyclePersistenceInput = {
  runId: string;
  runTimeUtc: string;
  sourceRunId: string;
  coverage: Record<string, unknown>;
  watchlist: readonly Ma30PriorityWatchItem[];
  reignitionState: Ma30PriorityReignitionStateMap;
  events: readonly Ma30PriorityPersistedEvent[];
};

export async function appendMa30PriorityCycle(db: Ma30PriorityDb, input: Ma30PriorityCyclePersistenceInput): Promise<void> {
  if (!db.batch) throw new Error("MA30 priority persistence requires atomic batch support");

  const run = db.prepare(`INSERT INTO ${MA30_PRIORITY_RUN_TABLE} (
    run_id, run_time_utc, source_run_id, coverage_json
  ) VALUES (?,?,?,?)`).bind(
    input.runId,
    input.runTimeUtc,
    input.sourceRunId,
    JSON.stringify(input.coverage),
  );

  const events = input.events.map((event) => db.prepare(`INSERT INTO ${MA30_PRIORITY_EVENT_TABLE} (
    event_key, run_id, event_type, symbol, direction, interval, signal_close_time, event_json
  ) VALUES (?,?,?,?,?,?,?,?)`).bind(
    event.eventKey,
    input.runId,
    event.eventType,
    event.symbol,
    event.direction,
    event.interval,
    event.signalCloseTime,
    JSON.stringify(event.payload),
  ));

  const state = db.prepare(`INSERT INTO ${MA30_PRIORITY_STATE_TABLE} (
    singleton_id, source_run_id, watchlist_json, reignition_state_json, updated_at
  ) VALUES (1,?,?,?,?)
  ON CONFLICT(singleton_id) DO UPDATE SET
    source_run_id = excluded.source_run_id,
    watchlist_json = excluded.watchlist_json,
    reignition_state_json = excluded.reignition_state_json,
    updated_at = excluded.updated_at`).bind(
    input.sourceRunId,
    JSON.stringify(input.watchlist),
    JSON.stringify(input.reignitionState),
    input.runTimeUtc,
  );

  await db.batch([run, ...events, state]);
}