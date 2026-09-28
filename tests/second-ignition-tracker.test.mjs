import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SecondIgnitionTracker,
  computeSecondIgnitionOutcome,
} from "../services/structure-radar/second-ignition-tracker.ts";
import { backfillSecondIgnitionOutcomes } from "../services/structure-radar/second-ignition-outcomes.ts";

const FIVE_MINUTES = 5 * 60 * 1_000;

function alert(overrides = {}) {
  return {
    schemaVersion: "second-ignition-alert-v1",
    alertId: "AAA:1:CONFIRMED",
    signalId: "AAA",
    symbol: "AAAUSDT",
    direction: "LONG",
    stage: "CONFIRMED",
    setup: "PLATFORM_RECLAIM",
    timeframe: "1h",
    reason: "BOUNDARY_RETEST_HELD",
    alertPrice: 100,
    alertedAt: "2026-09-28T00:00:10.000Z",
    signalTime: "2026-09-27T23:59:59.999Z",
    source: "structure-radar",
    ...overrides,
  };
}

function bars(alertedAt, count, close = 105) {
  const start = Date.parse(alertedAt);
  return Array.from({ length: count }, (_, index) => ({
    high: 106,
    low: 97,
    close,
    closeTime: Math.floor(start / FIVE_MINUTES) * FIVE_MINUTES + (index + 1) * FIVE_MINUTES - 1,
  }));
}

test("tracker records the same delivered alert only once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "second-ignition-"));
  try {
    const tracker = new SecondIgnitionTracker({
      dataDirectory: directory,
      now: () => new Date("2026-09-28T00:00:10.000Z"),
    });
    const input = {
      signalId: "AAA",
      stateVersion: 2,
      symbol: "aaausdt",
      stage: "CONFIRMED",
      setup: "PLATFORM_RECLAIM",
      timeframe: "1h",
      reason: "BOUNDARY_RETEST_HELD",
      alertPrice: 100,
      signalTimeMs: Date.parse("2026-09-27T23:59:59.999Z"),
    };

    const first = await tracker.recordAlert(input);
    const second = await tracker.recordAlert(input);
    const records = await tracker.listAlerts();

    assert.equal(first.status, "recorded");
    assert.equal(second.status, "duplicate");
    assert.equal(records.length, 1);
    assert.equal(records[0].symbol, "AAAUSDT");
    assert.equal(records[0].alertPrice, 100);
    assert.equal(records[0].alertedAt, "2026-09-28T00:00:10.000Z");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("1H outcome measures return, MFE and MAE from post-alert 5m bars", () => {
  const row = alert();
  const outcome = computeSecondIgnitionOutcome(row, 1, bars(row.alertedAt, 12, 105), new Date("2026-09-28T01:01:00Z"));

  assert.ok(outcome);
  assert.equal(outcome.returnPct, 5);
  assert.equal(outcome.mfePct, 6);
  assert.equal(outcome.maePct, -3);
  assert.equal(outcome.horizonHours, 1);
});

test("backfill appends only due 1H/4H/6H/12H outcomes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "second-ignition-"));
  try {
    const tracker = new SecondIgnitionTracker({
      dataDirectory: directory,
      now: () => new Date("2026-09-28T00:00:10.000Z"),
    });
    await tracker.recordAlert({
      signalId: "AAA",
      stateVersion: 2,
      symbol: "AAAUSDT",
      stage: "CONFIRMED",
      setup: "PLATFORM_RECLAIM",
      timeframe: "1h",
      alertPrice: 100,
      signalTimeMs: Date.parse("2026-09-27T23:59:59.999Z"),
    });

    const result = await backfillSecondIgnitionOutcomes({
      tracker,
      now: new Date("2026-09-28T04:02:00.000Z"),
      fetchBars: async (record, target) => {
        const count = Math.ceil((target - Date.parse(record.alertedAt)) / FIVE_MINUTES);
        return bars(record.alertedAt, count, 102);
      },
    });
    const outcomes = await tracker.listOutcomes();

    assert.equal(result.inserted, 2);
    assert.deepEqual(outcomes.map((item) => item.horizonHours), [1, 4]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
