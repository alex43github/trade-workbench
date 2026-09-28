import { loadRadarConfig } from "../services/structure-radar/config.ts";
import {
  REIGNITION_OUTCOME_HORIZONS,
  ReignitionForwardTracker,
  type ReignitionOutcome,
} from "../services/structure-radar/reignition-forward-tracker.ts";

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function formatPct(value: number | null) {
  return value === null ? "-" : `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

const config = loadRadarConfig();
const tracker = new ReignitionForwardTracker(config.dataDirectory);
const alerts = await tracker.listAlerts();
const outcomes = await tracker.listOutcomes();
const byAlert = new Map<string, ReignitionOutcome[]>();

for (const outcome of outcomes) {
  byAlert.set(outcome.alertId, [...(byAlert.get(outcome.alertId) ?? []), outcome]);
}

console.log("========== REIGNITION FORWARD MVP ==========");
console.log(`ALERTS=${alerts.length}`);
console.log("");
console.log("symbol\tdirection\talerted_at\talert_price\t+1H\t+4H\t+6H\t+12H");

for (const alert of alerts.toSorted((a, b) => a.alertedAt.localeCompare(b.alertedAt))) {
  const rows = byAlert.get(alert.alertId) ?? [];
  const at = (horizon: number) => rows.find((row) => row.horizonHours === horizon)?.returnPct ?? null;
  console.log([
    alert.symbol,
    alert.direction,
    alert.alertedAt,
    alert.alertPrice,
    formatPct(at(1)),
    formatPct(at(4)),
    formatPct(at(6)),
    formatPct(at(12)),
  ].join("\t"));
}

console.log("");
console.log("========== SUMMARY ==========");
for (const horizon of REIGNITION_OUTCOME_HORIZONS) {
  const rows = outcomes.filter((row) => row.horizonHours === horizon);
  const returns = rows.map((row) => row.returnPct);
  const positive = rows.filter((row) => row.returnPct > 0).length;
  console.log([
    `HORIZON=${horizon}H`,
    `N=${rows.length}`,
    `POSITIVE_RATE=${rows.length ? ((positive / rows.length) * 100).toFixed(2) : "0.00"}%`,
    `MEDIAN_RETURN=${formatPct(median(returns))}`,
    `MEDIAN_MFE=${formatPct(median(rows.map((row) => row.mfePct)))}`,
    `MEDIAN_MAE=${formatPct(median(rows.map((row) => row.maePct)))}`,
  ].join(" "));
}
