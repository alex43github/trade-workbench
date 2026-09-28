import { BINANCE_FUTURES, binanceJson } from "../../lib/radar/binance-public.ts";
import {
  SECOND_IGNITION_HORIZONS,
  computeSecondIgnitionOutcome,
  type SecondIgnitionAlert,
  type SecondIgnitionBar,
  type SecondIgnitionHorizon,
  type SecondIgnitionOutcome,
  type SecondIgnitionTracker,
} from "./second-ignition-tracker.ts";

type BinanceKline = [number, string, string, string, string, string, number, string?, ...unknown[]];

const HOUR_MS = 60 * 60 * 1_000;

export async function fetchSecondIgnitionFiveMinuteBars(
  alert: Pick<SecondIgnitionAlert, "symbol" | "alertedAt">,
  targetTimeMs: number,
): Promise<SecondIgnitionBar[]> {
  const startTime = Date.parse(alert.alertedAt);
  if (!Number.isFinite(startTime) || !Number.isFinite(targetTimeMs) || targetTimeMs <= startTime) return [];
  const url = `${BINANCE_FUTURES}/fapi/v1/klines?symbol=${encodeURIComponent(alert.symbol)}&interval=5m&startTime=${Math.floor(startTime)}&endTime=${Math.floor(targetTimeMs)}&limit=1000`;
  const rows = await binanceJson<BinanceKline[]>(url);
  return rows
    .map((row) => ({
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      closeTime: Number(row[6]),
    }))
    .filter((bar) => [bar.high, bar.low, bar.close, bar.closeTime].every(Number.isFinite))
    .toSorted((left, right) => left.closeTime - right.closeTime);
}

export async function backfillSecondIgnitionOutcomes(options: {
  tracker: Pick<SecondIgnitionTracker, "listAlerts" | "listOutcomes" | "appendOutcome">;
  now?: Date;
  fetchBars?: (alert: SecondIgnitionAlert, targetTimeMs: number) => Promise<SecondIgnitionBar[]>;
}) {
  const now = options.now ?? new Date();
  const alerts = await options.tracker.listAlerts();
  const outcomes = await options.tracker.listOutcomes();
  const existing = new Set(outcomes.map((item) => `${item.alertId}:${item.horizonHours}`));
  const fetchBars = options.fetchBars ?? fetchSecondIgnitionFiveMinuteBars;

  const pending: Array<{ alert: SecondIgnitionAlert; horizon: SecondIgnitionHorizon; targetTimeMs: number }> = [];
  for (const alert of alerts) {
    const alertedAtMs = Date.parse(alert.alertedAt);
    if (!Number.isFinite(alertedAtMs)) continue;
    for (const horizon of SECOND_IGNITION_HORIZONS) {
      const key = `${alert.alertId}:${horizon}`;
      const targetTimeMs = alertedAtMs + horizon * HOUR_MS;
      if (!existing.has(key) && targetTimeMs <= now.getTime()) {
        pending.push({ alert, horizon, targetTimeMs });
      }
    }
  }

  let inserted = 0;
  let missingBars = 0;
  const failures: Array<{ alertId: string; horizonHours: number; error: string }> = [];

  // Fetch once per alert through the largest due horizon.
  const grouped = new Map<string, typeof pending>();
  for (const item of pending) grouped.set(item.alert.alertId, [...(grouped.get(item.alert.alertId) ?? []), item]);

  for (const items of grouped.values()) {
    const alert = items[0]!.alert;
    const maxTarget = Math.max(...items.map((item) => item.targetTimeMs));
    let bars: SecondIgnitionBar[];
    try {
      bars = await fetchBars(alert, maxTarget);
    } catch (error) {
      for (const item of items) {
        failures.push({
          alertId: alert.alertId,
          horizonHours: item.horizon,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      continue;
    }

    for (const item of items.toSorted((left, right) => left.horizon - right.horizon)) {
      const outcome = computeSecondIgnitionOutcome(alert, item.horizon, bars, now);
      if (!outcome) {
        missingBars += 1;
        continue;
      }
      try {
        const result = await options.tracker.appendOutcome(outcome as SecondIgnitionOutcome);
        if (result.status === "recorded") inserted += 1;
      } catch (error) {
        failures.push({
          alertId: alert.alertId,
          horizonHours: item.horizon,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    alerts: alerts.length,
    existingOutcomes: outcomes.length,
    due: pending.length,
    inserted,
    missingBars,
    failures,
  } as const;
}
