import type { Ma30AiDirection, Ma30AiOutcome } from "./ma30-ai-selection.ts";

const HOUR_MS = 3_600_000;
export const MA30_OUTCOME_HORIZONS = [1, 3, 6, 12, 24] as const;
export type Ma30OutcomeHorizon = typeof MA30_OUTCOME_HORIZONS[number];

export type Ma30OutcomeBar = {
  high: number;
  low: number;
  close: number;
  closeTime: number;
};

export type Ma30PendingOutcome = {
  runId: string;
  runTimeUtc: string;
  symbol: string;
  direction: Ma30AiDirection;
  entryPrice: number;
  horizonHours: Ma30OutcomeHorizon;
};

export type Ma30OutcomeBackfillDeps = {
  loadPending: () => Promise<Ma30PendingOutcome[]>;
  fetchClosedBars: (symbol: string, now: Date) => Promise<Ma30OutcomeBar[]>;
  appendOutcome: (outcome: Ma30AiOutcome) => Promise<void>;
};

function pct(value: number): number {
  return Math.round(value * 100_000_000) / 100_000_000;
}

export function ma30SignalCloseTime(runTimeUtc: string): number {
  const runTime = Date.parse(runTimeUtc);
  if (!Number.isFinite(runTime)) throw new Error(`Invalid MA30 run_time_utc: ${runTimeUtc}`);
  return Math.floor(runTime / HOUR_MS) * HOUR_MS - 1;
}

function targetCloseTime(pending: Ma30PendingOutcome): number {
  return ma30SignalCloseTime(pending.runTimeUtc) + pending.horizonHours * HOUR_MS;
}

function expectedLastClosedHourlyCandle(now: Date): number {
  return Math.floor(now.getTime() / HOUR_MS) * HOUR_MS - 1;
}

/**
 * Compute a direction-normalized, no-lookahead outcome.
 * MFE is >= 0, MAE is <= 0, and return is positive when the selected direction
 * was profitable. The window must contain every exact 1H candle through the
 * requested horizon; incomplete/stale history returns null instead of guessing.
 */
export function computeMa30AiOutcome(
  pending: Ma30PendingOutcome,
  bars: readonly Ma30OutcomeBar[],
): Ma30AiOutcome | null {
  if (!(pending.entryPrice > 0) || !Number.isFinite(pending.entryPrice)) return null;

  const signalClose = ma30SignalCloseTime(pending.runTimeUtc);
  const targetClose = targetCloseTime(pending);
  const byClose = new Map<number, Ma30OutcomeBar>();
  for (const bar of bars) {
    if (![bar.high, bar.low, bar.close, bar.closeTime].every(Number.isFinite)) continue;
    byClose.set(bar.closeTime, bar);
  }

  const window: Ma30OutcomeBar[] = [];
  for (let hour = 1; hour <= pending.horizonHours; hour += 1) {
    const closeTime = signalClose + hour * HOUR_MS;
    const bar = byClose.get(closeTime);
    if (!bar) return null;
    window.push(bar);
  }

  if (!window.length || window.at(-1)?.closeTime !== targetClose) return null;

  const entry = pending.entryPrice;
  const highest = Math.max(...window.map((bar) => bar.high));
  const lowest = Math.min(...window.map((bar) => bar.low));
  const finalClose = window.at(-1)!.close;

  let mfePct: number;
  let maePct: number;
  let returnPct: number;

  if (pending.direction === "LONG") {
    mfePct = Math.max(0, (highest / entry - 1) * 100);
    maePct = Math.min(0, (lowest / entry - 1) * 100);
    returnPct = (finalClose / entry - 1) * 100;
  } else {
    mfePct = Math.max(0, (1 - lowest / entry) * 100);
    maePct = Math.min(0, (1 - highest / entry) * 100);
    returnPct = (1 - finalClose / entry) * 100;
  }

  return {
    runId: pending.runId,
    symbol: pending.symbol,
    direction: pending.direction,
    horizonHours: pending.horizonHours,
    mfePct: pct(mfePct),
    maePct: pct(maePct),
    returnPct: pct(returnPct),
    observedAt: new Date(targetClose).toISOString(),
  };
}

export async function backfillMa30AiOutcomes(options: {
  now?: Date;
  deps: Ma30OutcomeBackfillDeps;
}) {
  const now = options.now ?? new Date();
  const pendingRows = await options.deps.loadPending();
  const latestClosed = expectedLastClosedHourlyCandle(now);
  const due = pendingRows.filter((row) => targetCloseTime(row) <= latestClosed);
  const notDue = pendingRows.length - due.length;

  const dueSymbols = [...new Set(due.map((row) => row.symbol))];
  const barsBySymbol = new Map<string, Ma30OutcomeBar[]>();
  const fetchFailures: Array<{ symbol: string; error: string }> = [];

  for (const symbol of dueSymbols) {
    try {
      barsBySymbol.set(symbol, await options.deps.fetchClosedBars(symbol, now));
    } catch (error) {
      fetchFailures.push({
        symbol,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  let inserted = 0;
  let missingBars = 0;
  const appendFailures: Array<{ runId: string; symbol: string; horizonHours: number; error: string }> = [];

  for (const row of due) {
    const bars = barsBySymbol.get(row.symbol);
    if (!bars) {
      missingBars += 1;
      continue;
    }
    const outcome = computeMa30AiOutcome(row, bars);
    if (!outcome) {
      missingBars += 1;
      continue;
    }
    try {
      await options.deps.appendOutcome(outcome);
      inserted += 1;
    } catch (error) {
      appendFailures.push({
        runId: row.runId,
        symbol: row.symbol,
        horizonHours: row.horizonHours,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    pending: pendingRows.length,
    due: due.length,
    notDue,
    symbolsFetched: barsBySymbol.size,
    inserted,
    missingBars,
    fetchFailures,
    appendFailures,
  } as const;
}
