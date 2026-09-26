import assert from "node:assert/strict";
import test from "node:test";

import {
  OUTCOME_VERSION,
  SUPPORTED_OUTCOME_HORIZONS,
  calculateMatureOutcome,
  maturityStatus,
  selectCompleteClosedBars,
} from "../services/structure-radar/research/task-007b-outcomes.ts";
import { buildLiveOutcomeRecord, executionAuditForSnapshot } from "../scripts/fast-detach-v2-task-007b-natural-outcome.ts";

const snapshot = {
  identity: {
    decision_bar_close_utc: "2026-09-24T10:14:59.999Z",
  },
  anchor_price: 100,
};

function bar(openMinute, { high, low, close, closed = true } = {}) {
  const open = Date.parse(`2026-09-24T10:${String(openMinute).padStart(2, "0")}:00.000Z`);
  return {
    open_time_utc: new Date(open).toISOString(),
    close_time_utc: new Date(open + 5 * 60_000 - 1).toISOString(),
    open: close ?? 100,
    high: high ?? 100,
    low: low ?? 100,
    close: close ?? 100,
    volume: 1,
    closed,
  };
}

test("maturity status is strict and only supports the registered horizons", () => {
  assert.deepEqual(SUPPORTED_OUTCOME_HORIZONS, ["15m", "30m", "1h", "3h", "6h", "12h", "24h", "48h"]);
  assert.equal(OUTCOME_VERSION, "fast-detach-v2-task-007b-outcome-1");
  assert.equal(maturityStatus(snapshot, "15m", Date.parse("2026-09-24T10:29:59.999Z")).status, "NOT_MATURE");
  assert.equal(maturityStatus(snapshot, "15m", Date.parse("2026-09-24T10:30:00.000Z")).status, "MATURE");
});

test("closed-bar selection rejects a missing or open 5m candle instead of compressing the horizon", () => {
  const complete = [15, 20, 25].map((minute) => bar(minute));
  const ready = selectCompleteClosedBars({ snapshot, horizon: "15m", bars: complete, nowMs: Date.parse("2026-09-24T10:30:00.000Z") });
  assert.equal(ready.status, "MATURE");
  assert.equal(ready.bars.length, 3);

  const gap = selectCompleteClosedBars({ snapshot, horizon: "15m", bars: [complete[0], complete[2]], nowMs: Date.parse("2026-09-24T10:30:00.000Z") });
  assert.equal(gap.status, "DATA_GAP");

  const open = selectCompleteClosedBars({ snapshot, horizon: "15m", bars: complete.map((item, index) => index === 2 ? { ...item, closed: false } : item), nowMs: Date.parse("2026-09-24T10:30:00.000Z") });
  assert.equal(open.status, "DATA_GAP");
});

test("mature outcome uses only post-decision closed bars and computes path, targets, barrier, and underwater duration", () => {
  const bars = [
    bar(15, { high: 102, low: 99, close: 101 }),
    bar(20, { high: 106, low: 98, close: 103 }),
    bar(25, { high: 99, low: 98, close: 99 }),
    bar(30, { high: 99, low: 97, close: 98 }),
    bar(35, { high: 101, low: 99, close: 100 }),
    bar(40, { high: 108, low: 100, close: 100 }),
  ];
  const result = calculateMatureOutcome({ snapshot, horizon: "30m", bars, nowMs: Date.parse("2026-09-24T10:45:00.000Z") });
  assert.equal(result.status, "MATURE");
  assert.equal(result.metrics.price_at_horizon, 100);
  assert.equal(result.metrics.return_pct, 0);
  assert.ok(Math.abs(result.metrics.MFE_pct - 8) < 1e-9);
  assert.ok(Math.abs(result.metrics.MAE_pct + 3) < 1e-9);
  assert.equal(result.metrics.time_to_positive_min, 0);
  assert.equal(result.metrics.TTP_5, 5);
  assert.equal(result.metrics.TTP_8, 25);
  assert.equal(result.metrics.TTP_10, null);
  assert.ok(Math.abs(result.metrics.MAE_before_5 + 2) < 1e-9);
  assert.ok(Math.abs(result.metrics.MAE_before_8 + 3) < 1e-9);
  assert.equal(result.metrics.tp_before_sl.result, "TP_FIRST");
  assert.equal(result.metrics.max_time_underwater_min, 10);
});

test("same closed bar touching both focused barriers is explicitly ambiguous", () => {
  const bars = [bar(15, { high: 106, low: 96, close: 100 }), bar(20), bar(25)];
  const result = calculateMatureOutcome({ snapshot, horizon: "15m", bars, nowMs: Date.parse("2026-09-24T10:30:00.000Z") });
  assert.equal(result.status, "MATURE");
  assert.equal(result.metrics.tp_before_sl.result, "AMBIGUOUS_SAME_BAR");
});

test("collector preserves the existing identity, marks LOW_SAMPLE, and never infers EAP from setup", () => {
  const calculation = calculateMatureOutcome({
    snapshot,
    horizon: "15m",
    bars: [bar(15), bar(20), bar(25)],
    nowMs: Date.parse("2026-09-24T10:30:00.000Z"),
  });
  const outcome = buildLiveOutcomeRecord({
    snapshot: { ...snapshot, identity: { ...snapshot.identity, event_id: "event-1", setup: "PLATFORM_RECLAIM" } },
    horizon: "15m",
    calculation,
  });
  assert.equal(outcome.event_id, "event-1");
  assert.equal(outcome.outcome_version, OUTCOME_VERSION);
  assert.equal(outcome.metrics.sample_quality, "LOW_SAMPLE");
  const execution = executionAuditForSnapshot({ ...snapshot, identity: { ...snapshot.identity, setup: "PLATFORM_RECLAIM" }, direction_status: "NOT_PROVIDED_BY_SOURCE" });
  assert.equal(execution.EDP, snapshot.identity.decision_bar_close_utc);
  assert.equal(execution.EAP_PRESENT, false);
  assert.equal(execution.EAP, null);
});
