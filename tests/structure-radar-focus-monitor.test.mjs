import assert from "node:assert/strict";
import test from "node:test";
import { FocusMonitor } from "../services/structure-radar/focus-monitor.ts";
import { createFocusPoolRecord, mergeFocusPoolRecord } from "../lib/structure-radar/focus-pool.ts";

function bars({ timeframeSeconds, start = 100, lastPrevious = 99, last = 101, endTime = 1_700_100_000 }) {
  const result = [];
  for (let i = 0; i < 31; i += 1) {
    const close = i === 29 ? lastPrevious : i === 30 ? last : start;
    result.push({ time: endTime - (30 - i) * timeframeSeconds, open: close, high: close + 1, low: close - 1, close, volume: 100, closed: true });
  }
  return result;
}

function focus() {
  const base = createFocusPoolRecord("ENAUSDT", "2023-11-14T00:00:00.000Z");
  return mergeFocusPoolRecord(base, {
    sources: ["HOURLY_TREND", "HOURLY_SQUEEZE"], classifications: ["STRONG_TREND", "SHORT_SQUEEZE"], bias: "LONG", meaningfulDetection: true,
    trendStage: "ACTIONABLE", squeezeStage: "REIGNITION_READY",
  }, "2023-11-14T00:30:00.000Z");
}

function setup({ sendStatus = "delivered", stored = focus() } = {}) {
  let current = structuredClone(stored);
  const sent = [];
  const series = {
    "5m": bars({ timeframeSeconds: 300, lastPrevious: 100, last: 101 }),
    "15m": bars({ timeframeSeconds: 900, lastPrevious: 99, last: 101 }),
    "1h": bars({ timeframeSeconds: 3600, lastPrevious: 101, last: 102 }),
  };
  const monitor = new FocusMonitor({
    repository: {
      getFocus: async () => structuredClone(current),
      saveFocus: async (value) => { current = structuredClone(value); },
    },
    readBars: (_symbol, timeframe) => series[timeframe],
    evidence: async () => ({ thesisValid: true, localHigherLow: true, extended: false, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 2.2, hasLongPosition: false }),
    send: async (message) => { sent.push(message); return { status: sendStatus }; },
    now: () => new Date((series["15m"].at(-1).time + 60) * 1000),
  });
  return { monitor, sent, getStored: () => current };
}

test("15m reclaim sends structural alert and BUY_READY decision once, then persists watermarks", async () => {
  const { monitor, sent, getStored } = setup();
  const result = await monitor.processClosedTimeframe("ENAUSDT", "15m");
  assert.equal(result.status, "processed");
  assert.equal(sent.length, 2);
  assert.match(sent[0].title, /15m MA30 收回/);
  assert.match(sent[1].title, /买入条件成立/);
  assert.equal(getStored().lastDecision, "BUY_READY");
  assert.equal(getStored().ma30EventWatermarks["15m"], sent[0].key);

  await monitor.processClosedTimeframe("ENAUSDT", "15m");
  assert.equal(sent.length, 2);
});

test("failed Bark delivery does not persist MA30 watermark or BUY_READY transition, allowing retry", async () => {
  const { monitor, sent, getStored } = setup({ sendStatus: "failed" });
  const result = await monitor.processClosedTimeframe("ENAUSDT", "15m");
  assert.equal(result.status, "delivery_failed");
  assert.equal(sent.length, 1);
  assert.equal(getStored().ma30EventWatermarks["15m"], undefined);
  assert.notEqual(getStored().lastDecision, "BUY_READY");
});

test("stale 5m context prevents BUY_READY while still allowing a 15m structural reclaim alert", async () => {
  let current = focus();
  const sent = [];
  const five = bars({ timeframeSeconds: 300, lastPrevious: 100, last: 101 });
  five[five.length - 1].time -= 3600;
  const fifteen = bars({ timeframeSeconds: 900, lastPrevious: 99, last: 101 });
  const one = bars({ timeframeSeconds: 3600, lastPrevious: 101, last: 102 });
  const monitor = new FocusMonitor({
    repository: { getFocus: async () => structuredClone(current), saveFocus: async (value) => { current = structuredClone(value); } },
    readBars: (_symbol, timeframe) => ({ "5m": five, "15m": fifteen, "1h": one })[timeframe],
    evidence: async () => ({ thesisValid: true, localHigherLow: true, extended: false, derivativesSupportive: true, relativeStrengthSupportive: true, rewardRisk: 2.2, hasLongPosition: false }),
    send: async (message) => { sent.push(message); return { status: "delivered" }; },
    now: () => new Date((fifteen.at(-1).time + 60) * 1000),
  });
  await monitor.processClosedTimeframe("ENAUSDT", "15m");
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /AI：WATCH/);
  assert.equal(current.lastDecision, "WATCH");
});
