import { OUTCOME_VERSION } from "./task-007-protocol.ts";
import type { LiveEventSnapshot, OutcomeHorizon } from "./task-007-protocol.ts";

export { OUTCOME_VERSION };
export const SUPPORTED_OUTCOME_HORIZONS = ["15m", "30m", "1h", "3h", "6h", "12h", "24h", "48h"] as const satisfies readonly OutcomeHorizon[];

const HORIZON_MINUTES: Record<OutcomeHorizon, number> = {
  "15m": 15,
  "30m": 30,
  "1h": 60,
  "3h": 180,
  "6h": 360,
  "12h": 720,
  "24h": 1_440,
  "48h": 2_880,
};

const TARGETS_PCT = [5, 8, 10, 15, 20] as const;
const BAR_MS = 5 * 60_000;

export type OutcomeBar = {
  open_time_utc: string;
  close_time_utc: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: true;
};

type SnapshotReference = Pick<LiveEventSnapshot, "identity" | "anchor_price">;

export type MaturityStatus = {
  status: "MATURE" | "NOT_MATURE";
  maturity_ms: number;
  maturity_utc: string;
};

export type ClosedBarSelection = Omit<MaturityStatus, "status"> & {
  status: "MATURE" | "NOT_MATURE" | "DATA_GAP";
  bars: OutcomeBar[];
  observation_watermark_utc: string | null;
};

export type MatureOutcomeCalculation = {
  status: "MATURE" | "NOT_MATURE" | "DATA_GAP";
  maturity_utc: string;
  observation_watermark_utc: string | null;
  metrics?: Record<string, unknown>;
};

function parseUtc(value: string, label: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${label} must be an ISO timestamp`);
  return timestamp;
}

function horizonMinutes(horizon: OutcomeHorizon) {
  const minutes = HORIZON_MINUTES[horizon];
  if (!minutes) throw new Error(`unsupported outcome horizon: ${horizon}`);
  return minutes;
}

function percent(value: number, anchorPrice: number) {
  return ((value / anchorPrice) - 1) * 100;
}

function minutesSince(decisionMs: number, barOpenMs: number) {
  return Math.max(0, Math.floor((barOpenMs - decisionMs) / 60_000));
}

function firstTouch(bars: readonly OutcomeBar[], anchorPrice: number, targetPct: number) {
  const threshold = anchorPrice * (1 + targetPct / 100);
  const index = bars.findIndex((bar) => bar.high >= threshold);
  if (index < 0) return null;
  return { index, bar: bars[index]!, threshold };
}

function barrier(bars: readonly OutcomeBar[], anchorPrice: number) {
  const targetPct = 5;
  const stopLossPct = 3;
  const tpPrice = anchorPrice * (1 + targetPct / 100);
  const slPrice = anchorPrice * (1 - stopLossPct / 100);
  for (const bar of bars) {
    const hitTp = bar.high >= tpPrice;
    const hitSl = bar.low <= slPrice;
    if (hitTp && hitSl) {
      return {
        result: "AMBIGUOUS_SAME_BAR",
        target_pct: targetPct,
        stop_loss_pct: stopLossPct,
        first_touch_time_utc: null,
        ambiguous: true,
        tp_price: tpPrice,
        sl_price: slPrice,
      };
    }
    if (hitTp || hitSl) {
      return {
        result: hitTp ? "TP_FIRST" : "SL_FIRST",
        target_pct: targetPct,
        stop_loss_pct: stopLossPct,
        first_touch_time_utc: bar.open_time_utc,
        ambiguous: false,
        tp_price: tpPrice,
        sl_price: slPrice,
      };
    }
  }
  return {
    result: "NEITHER_BY_HORIZON",
    target_pct: targetPct,
    stop_loss_pct: stopLossPct,
    first_touch_time_utc: null,
    ambiguous: false,
    tp_price: tpPrice,
    sl_price: slPrice,
  };
}

function maxTimeUnderwater(bars: readonly OutcomeBar[], anchorPrice: number) {
  let longest = 0;
  let underwaterStart: number | null = null;
  for (const bar of bars) {
    const openMs = parseUtc(bar.open_time_utc, "bar.open_time_utc");
    if (bar.low <= anchorPrice && underwaterStart === null) underwaterStart = openMs;
    if (underwaterStart !== null && bar.high > anchorPrice) {
      longest = Math.max(longest, Math.floor((openMs - underwaterStart) / 60_000));
      underwaterStart = null;
    }
  }
  if (underwaterStart !== null && bars.length) {
    const endMs = parseUtc(bars.at(-1)!.close_time_utc, "bar.close_time_utc") + 1;
    longest = Math.max(longest, Math.floor((endMs - underwaterStart) / 60_000));
  }
  return Math.max(0, longest);
}

export function maturityStatus(snapshot: SnapshotReference, horizon: OutcomeHorizon, nowMs = Date.now()): MaturityStatus {
  const decisionMs = parseUtc(snapshot.identity.decision_bar_close_utc, "decision_bar_close_utc");
  const maturity_ms = decisionMs + horizonMinutes(horizon) * 60_000;
  return {
    status: nowMs > maturity_ms ? "MATURE" : "NOT_MATURE",
    maturity_ms,
    maturity_utc: new Date(maturity_ms).toISOString(),
  };
}

export function selectCompleteClosedBars({
  snapshot,
  horizon,
  bars,
  nowMs = Date.now(),
}: {
  snapshot: SnapshotReference;
  horizon: OutcomeHorizon;
  bars: readonly OutcomeBar[];
  nowMs?: number;
}): ClosedBarSelection {
  const maturity = maturityStatus(snapshot, horizon, nowMs);
  if (maturity.status !== "MATURE") return { ...maturity, status: "NOT_MATURE", bars: [], observation_watermark_utc: null };

  const decisionMs = parseUtc(snapshot.identity.decision_bar_close_utc, "decision_bar_close_utc");
  const expectedCount = horizonMinutes(horizon) / 5;
  const expectedFirstOpenMs = decisionMs + 1;
  const eligible = bars
    .filter((bar) => bar.closed === true)
    .filter((bar) => {
      const openMs = parseUtc(bar.open_time_utc, "bar.open_time_utc");
      const closeMs = parseUtc(bar.close_time_utc, "bar.close_time_utc");
      return openMs > decisionMs && closeMs <= maturity.maturity_ms;
    })
    .sort((left, right) => parseUtc(left.open_time_utc, "bar.open_time_utc") - parseUtc(right.open_time_utc, "bar.open_time_utc"));
  const selected = eligible.slice(0, expectedCount);
  const complete = selected.length === expectedCount && selected.every((bar, index) => {
    const openMs = parseUtc(bar.open_time_utc, "bar.open_time_utc");
    const closeMs = parseUtc(bar.close_time_utc, "bar.close_time_utc");
    return openMs === expectedFirstOpenMs + index * BAR_MS && closeMs === openMs + BAR_MS - 1;
  });
  if (!complete) return {
    status: "DATA_GAP" as const,
    maturity_ms: maturity.maturity_ms,
    maturity_utc: maturity.maturity_utc,
    bars: [],
    observation_watermark_utc: null,
  };
  return {
    ...maturity,
    status: "MATURE",
    bars: selected,
    observation_watermark_utc: selected.at(-1)!.close_time_utc,
  };
}

export function calculateMatureOutcome({
  snapshot,
  horizon,
  bars,
  nowMs = Date.now(),
}: {
  snapshot: SnapshotReference;
  horizon: OutcomeHorizon;
  bars: readonly OutcomeBar[];
  nowMs?: number;
}): MatureOutcomeCalculation {
  const selection = selectCompleteClosedBars({ snapshot, horizon, bars, nowMs });
  if (selection.status !== "MATURE") {
    return {
      status: selection.status,
      maturity_utc: selection.maturity_utc,
      observation_watermark_utc: selection.observation_watermark_utc,
    };
  }
  const anchorPrice = snapshot.anchor_price;
  if (!Number.isFinite(anchorPrice) || anchorPrice <= 0) throw new Error("anchor_price must be positive");
  const decisionMs = parseUtc(snapshot.identity.decision_bar_close_utc, "decision_bar_close_utc");
  const selected = selection.bars;
  const last = selected.at(-1)!;
  const maxHigh = Math.max(...selected.map((bar) => bar.high));
  const minLow = Math.min(...selected.map((bar) => bar.low));
  const positiveBar = selected.find((bar) => bar.high > anchorPrice);
  const metrics: Record<string, unknown> = {
    price_at_horizon: last.close,
    return_pct: percent(last.close, anchorPrice),
    MFE_pct: percent(maxHigh, anchorPrice),
    MAE_pct: percent(minLow, anchorPrice),
    time_to_positive_min: positiveBar ? minutesSince(decisionMs, parseUtc(positiveBar.open_time_utc, "bar.open_time_utc")) : null,
    max_time_underwater_min: maxTimeUnderwater(selected, anchorPrice),
    tp_before_sl: barrier(selected, anchorPrice),
    closed_bar_interval: "5m",
    closed_bar_count: selected.length,
    price_path_definition: "raw_price_path_relative_to_anchor_price; source_direction_not_provided",
    direction_status: "NOT_PROVIDED_BY_SOURCE",
    source_rule: "decision_bar_close_utc_after_only",
  };
  for (const target of TARGETS_PCT) {
    const touch = firstTouch(selected, anchorPrice, target);
    metrics[`TTP_${target}`] = touch ? minutesSince(decisionMs, parseUtc(touch.bar.open_time_utc, "bar.open_time_utc")) : null;
    metrics[`MAE_before_${target}`] = touch ? percent(Math.min(...selected.slice(0, touch.index + 1).map((bar) => bar.low)), anchorPrice) : null;
  }
  return {
    status: "MATURE",
    maturity_utc: selection.maturity_utc,
    observation_watermark_utc: selection.observation_watermark_utc,
    metrics,
  };
}
