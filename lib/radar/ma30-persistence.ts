import type {
  Ma30AiOutcome,
  Ma30AiSelection,
  Ma30AiSnapshot,
} from "./ma30-ai-selection.ts";
import { serializeMa30AiSnapshot } from "./ma30-ai-selection.ts";

/** Minimal D1-compatible surface used by both Cloudflare D1 and lib/local-d1.ts. */
export type Ma30PersistenceStatement = {
  bind: (...args: unknown[]) => Ma30PersistenceStatement;
  run: () => Promise<unknown>;
};

export type Ma30PersistenceDb = {
  prepare: (sql: string) => Ma30PersistenceStatement;
  batch?: (statements: Ma30PersistenceStatement[]) => Promise<unknown[]>;
};

export const MA30_SNAPSHOT_TABLE = "ma30_ai_snapshots";
export const MA30_SELECTION_TABLE = "ma30_ai_selections";
export const MA30_OUTCOME_TABLE = "ma30_ai_outcomes";

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS ${MA30_SNAPSHOT_TABLE} (
    run_id TEXT PRIMARY KEY,
    run_time_bjt TEXT NOT NULL,
    scanner_version TEXT NOT NULL,
    snapshot_version TEXT NOT NULL,
    immutable INTEGER NOT NULL CHECK (immutable = 1),
    selection_count INTEGER NOT NULL,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS ${MA30_SELECTION_TABLE} (
    run_id TEXT NOT NULL,
    ai_rank INTEGER NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
    confidence TEXT NOT NULL,
    score REAL NOT NULL,
    a_rank INTEGER,
    b_rank INTEGER,
    c_rank INTEGER,
    slope3 REAL NOT NULL,
    slope6 REAL NOT NULL,
    slope12 REAL NOT NULL,
    slope20 REAL NOT NULL,
    slope6_acceleration REAL NOT NULL,
    ma30 REAL NOT NULL,
    current_price REAL NOT NULL,
    ma30_new_high_bars INTEGER NOT NULL,
    price_vs_ma30_pct REAL NOT NULL,
    long_stage TEXT,
    short_stage TEXT,
    reason TEXT NOT NULL,
    risk TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, ai_rank),
    UNIQUE (run_id, symbol, direction),
    FOREIGN KEY (run_id) REFERENCES ${MA30_SNAPSHOT_TABLE}(run_id)
  )`,
  `CREATE TABLE IF NOT EXISTS ${MA30_OUTCOME_TABLE} (
    run_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL CHECK (direction IN ('LONG','SHORT')),
    horizon_hours INTEGER NOT NULL CHECK (horizon_hours IN (1,3,6,12,24)),
    mfe_pct REAL NOT NULL,
    mae_pct REAL NOT NULL,
    return_pct REAL NOT NULL,
    observed_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, symbol, direction, horizon_hours),
    FOREIGN KEY (run_id) REFERENCES ${MA30_SNAPSHOT_TABLE}(run_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ma30_selection_symbol_time
    ON ${MA30_SELECTION_TABLE}(symbol, run_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ma30_outcome_symbol_horizon
    ON ${MA30_OUTCOME_TABLE}(symbol, horizon_hours)`,
] as const;

export async function ensureMa30PersistenceSchema(db: Ma30PersistenceDb): Promise<void> {
  for (const sql of SCHEMA_STATEMENTS) {
    await db.prepare(sql).run();
  }
}

function selectionInsert(db: Ma30PersistenceDb, runId: string, row: Readonly<Ma30AiSelection>) {
  return db.prepare(`INSERT INTO ${MA30_SELECTION_TABLE} (
    run_id, ai_rank, symbol, direction, confidence, score,
    a_rank, b_rank, c_rank, slope3, slope6, slope12, slope20,
    slope6_acceleration, ma30, current_price, ma30_new_high_bars,
    price_vs_ma30_pct, long_stage, short_stage, reason, risk
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
    runId,
    row.aiRank,
    row.symbol,
    row.direction,
    row.confidence,
    row.score,
    row.aRank,
    row.bRank,
    row.cRank,
    row.slope3,
    row.slope6,
    row.slope12,
    row.slope20,
    row.slope6Acceleration,
    row.ma30,
    row.currentPrice,
    row.ma30NewHighBars,
    row.priceVsMa30Pct,
    row.longStage ?? null,
    row.shortStage ?? null,
    row.reason,
    row.risk,
  );
}

/**
 * Append-only by design: plain INSERT is intentional. A repeated run_id must fail rather
 * than overwrite or mutate a historical recommendation snapshot.
 */
export async function appendMa30AiSnapshot(
  db: Ma30PersistenceDb,
  snapshot: Ma30AiSnapshot,
): Promise<void> {
  if (!snapshot.immutable) throw new Error("MA30 snapshot must be immutable");

  const snapshotStmt = db.prepare(`INSERT INTO ${MA30_SNAPSHOT_TABLE} (
    run_id, run_time_bjt, scanner_version, snapshot_version,
    immutable, selection_count, snapshot_json
  ) VALUES (?,?,?,?,1,?,?)`).bind(
    snapshot.runId,
    snapshot.runTimeBjt,
    snapshot.scannerVersion,
    snapshot.snapshotVersion,
    snapshot.selections.length,
    serializeMa30AiSnapshot(snapshot),
  );
  const selectionStmts = snapshot.selections.map((row) => selectionInsert(db, snapshot.runId, row));

  if (db.batch) {
    await db.batch([snapshotStmt, ...selectionStmts]);
    return;
  }
  // Fallback for a minimal adapter. Production local-d1/D1 both support batch.
  await snapshotStmt.run();
  for (const stmt of selectionStmts) await stmt.run();
}

/** Outcomes are append-only sibling facts. They never update the frozen recommendation. */
export async function appendMa30AiOutcome(
  db: Ma30PersistenceDb,
  outcome: Ma30AiOutcome,
): Promise<void> {
  await db.prepare(`INSERT INTO ${MA30_OUTCOME_TABLE} (
    run_id, symbol, direction, horizon_hours,
    mfe_pct, mae_pct, return_pct, observed_at
  ) VALUES (?,?,?,?,?,?,?,?)`).bind(
    outcome.runId,
    outcome.symbol,
    outcome.direction,
    outcome.horizonHours,
    outcome.mfePct,
    outcome.maePct,
    outcome.returnPct,
    outcome.observedAt,
  ).run();
}
