import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ReignitionForwardTracker } from "../services/structure-radar/reignition-forward-tracker.ts";

const HOUR = 60 * 60;
const START = 1_800_000_000;

function bar(time, close, high = close, low = close) {
  return { time, open: close, high, low, close, volume: 1, closed: true };
}

function state() {
  return {
    id: "squeeze:AAAUSDT",
    symbol: "AAAUSDT",
    detectorVersion: "SQUEEZE_RADAR_V0.1_RESEARCH",
    direction: "SHORT_SQUEEZE_LONG_BIAS",
    stage: "REIGNITION_READY",
    offlineExecutionLevel: "A_OFFLINE_EXECUTABLE",
    reasonCodes: ["ONE_HOUR_STRUCTURE", "OI_EXPANDING"],
    timestamps: { reignitionAt: "2026-09-28T00:00:00.000Z" },
    peakPrice: 100,
    startedAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
    lastProcessedOneHourCloseTime: START,
    stickyWatchUntil: "2026-10-01T00:00:00.000Z",
  };
}

test("records only actually delivered REIGNITION_READY Bark alerts and deduplicates them", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reignition-forward-"));
  try {
    const tracker = new ReignitionForwardTracker(directory);
    const bars = [bar(START, 100)];

    const skipped = await tracker.recordDeliveredAlert({
      state: state(),
      bars1h: bars,
      deliveryStatus: "disabled",
      deliveredAt: new Date("2026-09-28T00:00:05.000Z"),
    });
    assert.equal(skipped.status, "not_delivered");
    assert.equal((await tracker.listAlerts()).length, 0);

    const first = await tracker.recordDeliveredAlert({
      state: state(),
      bars1h: bars,
      deliveryStatus: "delivered",
      deliveredAt: new Date("2026-09-28T00:00:05.000Z"),
    });
    const duplicate = await tracker.recordDeliveredAlert({
      state: state(),
      bars1h: bars,
      deliveryStatus: "delivered",
      deliveredAt: new Date("2026-09-28T00:00:06.000Z"),
    });

    assert.equal(first.status, "recorded");
    assert.equal(duplicate.status, "duplicate");
    const alerts = await tracker.listAlerts();
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].alertPrice, 100);
    assert.equal(alerts[0].alertedAt, "2026-09-28T00:00:05.000Z");
    assert.equal(alerts[0].stage, "REIGNITION_READY");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("fills +1H/+4H/+6H/+12H returns, MFE and MAE from exact future hourly bars", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reignition-forward-"));
  try {
    const tracker = new ReignitionForwardTracker(directory);
    await tracker.recordDeliveredAlert({
      state: state(),
      bars1h: [bar(START, 100)],
      deliveryStatus: "delivered",
      deliveredAt: new Date("2026-09-28T00:00:05.000Z"),
    });

    const bars = [bar(START, 100)];
    for (let hour = 1; hour <= 12; hour += 1) {
      bars.push(bar(START + hour * HOUR, 100 + hour, 102 + hour, 98));
    }

    const result = await tracker.backfillSymbol("AAAUSDT", bars);
    assert.equal(result.inserted, 4);
    assert.equal(result.missing, 0);

    const outcomes = await tracker.listOutcomes();
    assert.deepEqual(outcomes.map((row) => row.horizonHours), [1, 4, 6, 12]);
    assert.equal(outcomes.find((row) => row.horizonHours === 1)?.returnPct, 1);
    assert.equal(outcomes.find((row) => row.horizonHours === 4)?.returnPct, 4);
    assert.equal(outcomes.find((row) => row.horizonHours === 12)?.returnPct, 12);
    assert.equal(outcomes.find((row) => row.horizonHours === 12)?.mfePct, 14);
    assert.equal(outcomes.find((row) => row.horizonHours === 12)?.maePct, -2);

    const again = await tracker.backfillSymbol("AAAUSDT", bars);
    assert.equal(again.inserted, 0);
    assert.equal((await tracker.listOutcomes()).length, 4);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not manufacture an outcome when an intermediate hourly candle is missing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "reignition-forward-"));
  try {
    const tracker = new ReignitionForwardTracker(directory);
    await tracker.recordDeliveredAlert({
      state: state(),
      bars1h: [bar(START, 100)],
      deliveryStatus: "delivered",
    });

    const bars = [
      bar(START, 100),
      bar(START + HOUR, 101),
      bar(START + 3 * HOUR, 103),
      bar(START + 4 * HOUR, 104),
    ];
    const result = await tracker.backfillSymbol("AAAUSDT", bars);

    assert.equal(result.inserted, 1);
    assert.equal(result.missing, 1);
    assert.deepEqual((await tracker.listOutcomes()).map((row) => row.horizonHours), [1]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
