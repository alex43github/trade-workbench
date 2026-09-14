import assert from "node:assert/strict";
import test from "node:test";

import {
  backfillMa30AiOutcomes,
  computeMa30AiOutcome,
  ma30SignalCloseTime,
} from "../lib/radar/ma30-outcome-backfill.ts";

const HOUR = 3_600_000;

function barsFrom(signalCloseTime, rows) {
  return rows.map((row, index) => ({
    open: row.open ?? 100,
    high: row.high,
    low: row.low,
    close: row.close,
    closeTime: signalCloseTime + (index + 1) * HOUR,
    volume: 1,
  }));
}

function pending(overrides = {}) {
  return {
    runId: "ma30:2026-09-14T13",
    runTimeUtc: "2026-09-14T05:16:36.485Z",
    symbol: "AAAUSDT",
    direction: "LONG",
    entryPrice: 100,
    horizonHours: 3,
    ...overrides,
  };
}

test("signal anchor is the last fully closed 1H candle before the scan", () => {
  assert.equal(
    new Date(ma30SignalCloseTime("2026-09-14T05:16:36.485Z")).toISOString(),
    "2026-09-14T04:59:59.999Z",
  );
});

test("LONG outcome uses only closed bars through the requested horizon", () => {
  const p = pending();
  const signal = ma30SignalCloseTime(p.runTimeUtc);
  const bars = barsFrom(signal, [
    { high: 105, low: 98, close: 102 },
    { high: 110, low: 99, close: 108 },
    { high: 109, low: 95, close: 106 },
    // Must not leak into the 3H result.
    { high: 140, low: 70, close: 130 },
  ]);
  const outcome = computeMa30AiOutcome(p, bars);
  assert.ok(outcome);
  assert.equal(outcome.horizonHours, 3);
  assert.equal(outcome.mfePct, 10);
  assert.equal(outcome.maePct, -5);
  assert.equal(outcome.returnPct, 6);
  assert.equal(outcome.observedAt, "2026-09-14T07:59:59.999Z");
});

test("SHORT outcome is direction-normalized: favorable positive, adverse negative", () => {
  const p = pending({ direction: "SHORT", horizonHours: 1 });
  const signal = ma30SignalCloseTime(p.runTimeUtc);
  const outcome = computeMa30AiOutcome(p, barsFrom(signal, [
    { high: 103, low: 92, close: 95 },
  ]));
  assert.ok(outcome);
  assert.equal(outcome.mfePct, 8);
  assert.equal(outcome.maePct, -3);
  assert.equal(outcome.returnPct, 5);
});

test("missing or non-contiguous target candles never create a hindsight outcome", () => {
  const p = pending({ horizonHours: 3 });
  const signal = ma30SignalCloseTime(p.runTimeUtc);
  const bars = barsFrom(signal, [
    { high: 101, low: 99, close: 100 },
    { high: 102, low: 98, close: 101 },
  ]);
  assert.equal(computeMa30AiOutcome(p, bars), null);
});

test("backfill fetches each symbol once and appends only horizons that are actually due", async () => {
  const pendingRows = [
    pending({ horizonHours: 1 }),
    pending({ horizonHours: 3 }),
    pending({ horizonHours: 6 }),
  ];
  const signal = ma30SignalCloseTime(pendingRows[0].runTimeUtc);
  const threeBars = barsFrom(signal, [
    { high: 101, low: 99, close: 100.5 },
    { high: 103, low: 99.5, close: 102 },
    { high: 104, low: 98, close: 103 },
  ]);
  let fetches = 0;
  const appended = [];

  const result = await backfillMa30AiOutcomes({
    now: new Date("2026-09-14T08:10:00.000Z"),
    deps: {
      loadPending: async () => pendingRows,
      fetchClosedBars: async () => {
        fetches += 1;
        return threeBars;
      },
      appendOutcome: async (outcome) => appended.push(outcome),
    },
  });

  assert.equal(fetches, 1);
  assert.deepEqual(appended.map((row) => row.horizonHours), [1, 3]);
  assert.equal(result.inserted, 2);
  assert.equal(result.notDue, 1);
  assert.equal(result.missingBars, 0);
});
