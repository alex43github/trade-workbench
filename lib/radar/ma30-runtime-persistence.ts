import type { Ma30LifecycleEvent, Ma30LifecycleState } from "./ma30-lifecycle.ts";
import type { Ma30NotificationState } from "./ma30-notifications.ts";
import type { Ma30OvernightEventRecord } from "./ma30-overnight-catchup.ts";

export type Ma30RuntimeStatement = {
  bind: (...args: unknown[]) => Ma30RuntimeStatement;
  run: () => Promise<unknown>;
  first?: <T = Record<string, unknown>>() => Promise<T | null>;
  all?: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
};

export type Ma30RuntimeDb = {
  prepare: (sql: string) => Ma30RuntimeStatement;
  batch?: (statements: Ma30RuntimeStatement[]) => Promise<unknown[]>;
};

export const MA30_SCAN_RUN_TABLE = "ma30_scan_runs";
export const MA30_LIFECYCLE_SNAPSHOT_TABLE = "ma30_lifecycle_snapshots";
export const MA30_LIFECYCLE_EVENT_TABLE = "ma30_lifecycle_events";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS ${MA30_SCAN_RUN_TABLE} (
    run_id TEXT PRIMARY KEY,
    run_time_utc TEXT NOT NULL,
    run_time_bjt TEXT NOT NULL,
    scanner_version TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('FULL','PARTIAL')),
    coverage_json TEXT NOT NULL,
    notification_state_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ${MA30_LIFECYCLE_SNAPSHOT_TABLE} (
    run_id TEXT PRIMARY KEY,
    run_time_bjt TEXT NOT NULL,
    lifecycle_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES ${MA30_SCAN_RUN_TABLE}(run_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ${MA30_LIFECYCLE_EVENT_TABLE} (
    run_id TEXT NOT NULL,
    event_index INTEGER NOT NULL,
    run_time_bjt TEXT NOT NULL,
    group_name TEXT NOT NULL,
    symbol TEXT NOT NULL,
    event_type TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, event_index),
    FOREIGN KEY (run_id) REFERENCES ${MA30_SCAN_RUN_TABLE}(run_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ma30_scan_runs_time ON ${MA30_SCAN_RUN_TABLE}(run_time_bjt)`,
  `CREATE INDEX IF NOT EXISTS idx_ma30_lifecycle_time ON ${MA30_LIFECYCLE_SNAPSHOT_TABLE}(run_time_bjt)`,
  `CREATE INDEX IF NOT EXISTS idx_ma30_lifecycle_events_time ON ${MA30_LIFECYCLE_EVENT_TABLE}(run_time_bjt)`,
] as const;

export async function ensureMa30RuntimePersistenceSchema(db: Ma30RuntimeDb): Promise<void> {
  for (const sql of SCHEMA) await db.prepare(sql).run();
}

export type Ma30RuntimeSnapshot = {
  runId: string;
  runTimeUtc: string;
  runTimeBjt: string;
  scannerVersion: string;
  status: "FULL" | "PARTIAL";
  coverage: Record<string, unknown>;
  notificationState: Ma30NotificationState;
  lifecycle: Ma30LifecycleState;
  lifecycleEvents: Ma30LifecycleEvent[];
};

/** Build append-only runtime/lifecycle/event statements without executing them. */
export function prepareMa30RuntimeSnapshotStatements(
  db: Ma30RuntimeDb,
  snapshot: Ma30RuntimeSnapshot,
): Ma30RuntimeStatement[] {
  const run = db.prepare(`INSERT INTO ${MA30_SCAN_RUN_TABLE} (
    run_id, run_time_utc, run_time_bjt, scanner_version, status,
    coverage_json, notification_state_json
  ) VALUES (?,?,?,?,?,?,?)`).bind(
    snapshot.runId,
    snapshot.runTimeUtc,
    snapshot.runTimeBjt,
    snapshot.scannerVersion,
    snapshot.status,
    JSON.stringify(snapshot.coverage),
    JSON.stringify(snapshot.notificationState),
  );

  const lifecycle = db.prepare(`INSERT INTO ${MA30_LIFECYCLE_SNAPSHOT_TABLE} (
    run_id, run_time_bjt, lifecycle_json
  ) VALUES (?,?,?)`).bind(
    snapshot.runId,
    snapshot.runTimeBjt,
    JSON.stringify(snapshot.lifecycle),
  );

  const lifecycleEvents = (snapshot.lifecycleEvents ?? []).map((event, eventIndex) =>
    db.prepare(`INSERT INTO ${MA30_LIFECYCLE_EVENT_TABLE} (
      run_id, event_index, run_time_bjt, group_name, symbol, event_type, event_json
    ) VALUES (?,?,?,?,?,?,?)`).bind(
      snapshot.runId,
      eventIndex,
      snapshot.runTimeBjt,
      event.group,
      event.symbol,
      event.type,
      JSON.stringify(event),
    ),
  );

  return [run, lifecycle, ...lifecycleEvents];
}

/**
 * Append-only runtime persistence. A duplicate run_id is intentionally a
 * database error unless callers first detect it with hasMa30RuntimeRun().
 */
export async function appendMa30RuntimeSnapshot(db: Ma30RuntimeDb, snapshot: Ma30RuntimeSnapshot): Promise<void> {
  const statements = prepareMa30RuntimeSnapshotStatements(db, snapshot);
  if (db.batch) {
    await db.batch(statements);
    return;
  }
  for (const statement of statements) await statement.run();
}

export async function hasMa30RuntimeRun(db: Ma30RuntimeDb, runId: string): Promise<boolean> {
  const statement = db.prepare(`SELECT run_id FROM ${MA30_SCAN_RUN_TABLE} WHERE run_id = ? LIMIT 1`).bind(runId);
  if (!statement.first) throw new Error("MA30 runtime DB adapter must support first() for duplicate detection");
  return Boolean(await statement.first<{ run_id: string }>());
}

export async function loadLatestMa30LifecycleState(db: Ma30RuntimeDb): Promise<Ma30LifecycleState | undefined> {
  const statement = db.prepare(`SELECT lifecycle_json FROM ${MA30_LIFECYCLE_SNAPSHOT_TABLE}
    ORDER BY run_time_bjt DESC, created_at DESC LIMIT 1`);
  if (!statement.first) throw new Error("MA30 runtime DB adapter must support first() for lifecycle restore");
  const row = await statement.first<{ lifecycle_json?: string }>();
  if (!row?.lifecycle_json) return undefined;
  const parsed: unknown = JSON.parse(row.lifecycle_json);
  if (!parsed || typeof parsed !== "object") throw new Error("Invalid MA30 lifecycle snapshot");
  return parsed as Ma30LifecycleState;
}

export async function loadMa30LifecycleEventsInWindow(
  db: Ma30RuntimeDb,
  startBjt: string,
  endBjt: string,
): Promise<Ma30OvernightEventRecord[]> {
  const statement = db.prepare(`SELECT
      e.run_id,
      e.event_index,
      e.run_time_bjt,
      e.event_json,
      r.notification_state_json
    FROM ${MA30_LIFECYCLE_EVENT_TABLE} e
    JOIN ${MA30_SCAN_RUN_TABLE} r ON r.run_id = e.run_id
    WHERE e.run_time_bjt >= ? AND e.run_time_bjt < ?
    ORDER BY e.run_time_bjt ASC, e.event_index ASC`).bind(startBjt, endBjt);
  if (!statement.all) throw new Error("MA30 runtime DB adapter must support all() for lifecycle event loading");
  const result = await statement.all<{
    run_id: string;
    event_index: number;
    run_time_bjt: string;
    event_json: string;
    notification_state_json: string;
  }>();

  return result.results.map((row) => ({
    runId: row.run_id,
    eventIndex: Number(row.event_index),
    runTimeBjt: row.run_time_bjt,
    event: JSON.parse(row.event_json) as Ma30LifecycleEvent,
    notificationState: JSON.parse(row.notification_state_json) as Ma30NotificationState,
  }));
}
