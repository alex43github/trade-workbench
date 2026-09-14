import { getLocalD1 } from "../local-d1.ts";
import { fetchClosedBars } from "./binance-public.ts";
import {
  backfillMa30AiOutcomes,
  MA30_OUTCOME_HORIZONS,
  type Ma30OutcomeHorizon,
  type Ma30PendingOutcome,
} from "./ma30-outcome-backfill.ts";
import {
  appendMa30AiOutcome,
  ensureMa30PersistenceSchema,
  type Ma30PersistenceDb,
} from "./ma30-persistence.ts";

export type Ma30OutcomeQueryStatement = {
  bind: (...args: unknown[]) => Ma30OutcomeQueryStatement;
  all: <T = Record<string, unknown>>() => Promise<{ results: T[] }>;
  run: () => Promise<unknown>;
};

export type Ma30OutcomeQueryDb = Ma30PersistenceDb & {
  prepare: (sql: string) => Ma30OutcomeQueryStatement;
};

type PendingRow = {
  run_id?: unknown;
  run_time_utc?: unknown;
  symbol?: unknown;
  direction?: unknown;
  current_price?: unknown;
  horizon_hours?: unknown;
};

function isHorizon(value: number): value is Ma30OutcomeHorizon {
  return (MA30_OUTCOME_HORIZONS as readonly number[]).includes(value);
}

/**
 * Return only missing outcome facts. Existing outcomes are excluded in SQL so
 * historical recommendation snapshots remain immutable and backfill stays
 * idempotent at the data-selection layer.
 */
export async function loadPendingMa30Outcomes(
  db: Ma30OutcomeQueryDb,
  limit = 2_000,
): Promise<Ma30PendingOutcome[]> {
  const boundedLimit = Math.max(1, Math.min(20_000, Math.floor(limit)));
  const sql = `WITH horizons(horizon_hours) AS (
      VALUES (1), (3), (6), (12), (24)
    )
    SELECT
      s.run_id,
      r.run_time_utc,
      s.symbol,
      s.direction,
      s.current_price,
      h.horizon_hours
    FROM ma30_ai_selections s
    JOIN ma30_scan_runs r ON r.run_id = s.run_id
    CROSS JOIN horizons h
    LEFT JOIN ma30_ai_outcomes o
      ON o.run_id = s.run_id
     AND o.symbol = s.symbol
     AND o.direction = s.direction
     AND o.horizon_hours = h.horizon_hours
    WHERE o.run_id IS NULL
    ORDER BY r.run_time_utc ASC, s.ai_rank ASC, h.horizon_hours ASC
    LIMIT ?`;

  const response = await db.prepare(sql).bind(boundedLimit).all<PendingRow>();
  const out: Ma30PendingOutcome[] = [];

  for (const row of response.results ?? []) {
    const runId = typeof row.run_id === "string" ? row.run_id : "";
    const runTimeUtc = typeof row.run_time_utc === "string" ? row.run_time_utc : "";
    const symbol = typeof row.symbol === "string" ? row.symbol : "";
    const direction = row.direction === "LONG" || row.direction === "SHORT" ? row.direction : null;
    const entryPrice = Number(row.current_price);
    const horizonHours = Number(row.horizon_hours);

    if (!runId || !symbol || !direction) continue;
    if (!Number.isFinite(Date.parse(runTimeUtc))) continue;
    if (!(entryPrice > 0) || !Number.isFinite(entryPrice)) continue;
    if (!Number.isInteger(horizonHours) || !isHorizon(horizonHours)) continue;

    out.push({
      runId,
      runTimeUtc,
      symbol,
      direction,
      entryPrice,
      horizonHours,
    });
  }

  return out;
}

export async function executeMa30VpsOutcomeBackfill(options: {
  now?: Date;
  pendingLimit?: number;
} = {}) {
  const localDb = getLocalD1();
  const db = localDb as unknown as Ma30OutcomeQueryDb;
  await ensureMa30PersistenceSchema(db);

  return backfillMa30AiOutcomes({
    now: options.now,
    deps: {
      loadPending: () => loadPendingMa30Outcomes(db, options.pendingLimit),
      fetchClosedBars: (symbol, now) => fetchClosedBars(symbol, "1h", now, 1_000),
      appendOutcome: (outcome) => appendMa30AiOutcome(db, outcome),
    },
  });
}
