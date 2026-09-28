import { loadRadarConfig } from "../services/structure-radar/config.ts";
import {
  SECOND_IGNITION_HORIZONS,
  SecondIgnitionTracker,
  type SecondIgnitionOutcome,
} from "../services/structure-radar/second-ignition-tracker.ts";

function median(values: number[]) {
  if (!values.length) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle]! : (ordered[middle - 1]! + ordered[middle]!) / 2;
}

function pct(value: number | null) {
  return value === null ? "-" : `${value.toFixed(2)}%`;
}

const config = loadRadarConfig();
const tracker = new SecondIgnitionTracker({ dataDirectory: config.dataDirectory });
const alerts = await tracker.listAlerts();
const outcomes = await tracker.listOutcomes();

const byAlert = new Map<string, SecondIgnitionOutcome[]>();
for (const outcome of outcomes) {
  byAlert.set(outcome.alertId, [...(byAlert.get(outcome.alertId) ?? []), outcome]);
}

console.log("========== SECOND IGNITION MVP REPORT ==========");
console.log(`ALERT_COUNT=${alerts.length}`);
console.log("");
console.log("symbol\tstage\talerted_at\talert_price\t1h\t4h\t6h\t12h");
for (const alert of alerts.toSorted((a, b) => a.alertedAt.localeCompare(b.alertedAt))) {
  const rows = byAlert.get(alert.alertId) ?? [];
  const value = (h: number) => rows.find((row) => row.horizonHours === h)?.returnPct ?? null;
  console.log([
    alert.symbol,
    alert.stage,
    alert.alertedAt,
    alert.alertPrice,
    pct(value(1)),
    pct(value(4)),
    pct(value(6)),
    pct(value(12)),
  ].join("\t"));
}

console.log("");
console.log("========== HORIZON SUMMARY ==========");
for (const horizon of SECOND_IGNITION_HORIZONS) {
  const rows = outcomes.filter((row) => row.horizonHours === horizon);
  const returns = rows.map((row) => row.returnPct);
  const mfes = rows.map((row) => row.mfePct);
  const maes = rows.map((row) => row.maePct);
  const positive = rows.filter((row) => row.returnPct > 0).length;
  console.log([
    `${horizon}H`,
    `N=${rows.length}`,
    `POSITIVE_RATE=${rows.length ? ((positive / rows.length) * 100).toFixed(2) : "0.00"}%`,
    `MEDIAN_RETURN=${pct(median(returns))}`,
    `MEDIAN_MFE=${pct(median(mfes))}`,
    `MEDIAN_MAE=${pct(median(maes))}`,
  ].join(" "));
}
