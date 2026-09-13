import assert from "node:assert/strict";
import test from "node:test";

const readyMa30 = (symbols) => ({
  status: "ready", scannedAt: "2026-08-28T00:00:00.000Z",
  candidates: symbols.map((symbol) => ({ symbol, eligible: true, currentOi: 100, previousDayOi: 110, priorTenDayOiAverage: 100, oiExpansionPct: 10, consecutiveAboveMa: 7, ma30: 90, lastClose: 100, scannedAt: "2026-08-28T00:00:00.000Z" })),
});
const readyReversal = (directions) => ({
  scans: Object.fromEntries(Object.entries(directions).map(([interval, candidates]) => [interval, {
    status: "ready", scannedAt: "2026-08-28T00:00:00.000Z", interval,
    candidates: candidates.map(({ symbol, direction }) => ({ symbol, direction, score: 80, signalTime: 1, interval })),
  }])),
  archives: [],
});
const readyVegas = ({ bullish = {}, bearish = {} } = {}) => ({
  status: "ready", scannedAt: "2026-08-28T00:00:00.000Z", vegas: { "1h": bullish["1h"] ?? [], "4h": bullish["4h"] ?? [], "1d": bullish["1d"] ?? [] },
  vegasBearish: { "1h": bearish["1h"] ?? [], "4h": bearish["4h"] ?? [], "1d": bearish["1d"] ?? [] },
});
const liveRadar = (observations) => ({ mode: "live", observations });

test("combines only same-direction evidence and ranks more conditions first", async () => {
  const { buildCompositeSnapshot } = await import("../lib/radar/composite-ranking.ts");
  const snapshot = buildCompositeSnapshot({
    scannedAt: "2026-08-28T00:00:00.000Z",
    ma30Oi: readyMa30(["BTCUSDT"]),
    reversal: readyReversal({ "1d": [{ symbol: "BTCUSDT", direction: "LONG" }, { symbol: "ETHUSDT", direction: "SHORT" }] }),
    multiTimeframe: readyVegas({ bullish: { "1h": ["BTCUSDT"] }, bearish: { "4h": ["ETHUSDT"] } }),
    radar: liveRadar([{ symbol: "BTCUSDT", participation: "SQUEEZE" }, { symbol: "ETHUSDT", top10Pct: 50, chipStage: "横盘整理" }]),
  });
  assert.deepEqual(snapshot.candidates.map((row) => [row.symbol, row.direction, row.conditionCount, row.priority]), [
    ["BTCUSDT", "LONG", 4, "CRITICAL"],
    ["ETHUSDT", "SHORT", 3, "HIGH"],
  ]);
  assert.ok(snapshot.candidates[1].conditions.some((condition) => condition.includes("筹码")));
});

test("includes short MA30/OI evidence in the composite ranking", async () => {
  const { buildCompositeSnapshot } = await import("../lib/radar/composite-ranking.ts");
  const snapshot = buildCompositeSnapshot({
    scannedAt: "2026-08-28T00:00:00.000Z",
    ma30Oi: {
      status: "ready",
      scannedAt: "2026-08-28T00:00:00.000Z",
      candidates: [{
        symbol: "BTCUSDT", direction: "SHORT", eligible: true, currentOi: 100,
        previousDayOi: 110, priorTenDayOiAverage: 100, oiExpansionPct: 10,
        consecutiveAboveMa: 0, consecutiveBelowMa: 7, ma30: 110, lastClose: 90,
        scannedAt: "2026-08-28T00:00:00.000Z",
      }],
    },
    reversal: readyReversal({ "1d": [{ symbol: "BTCUSDT", direction: "SHORT" }] }),
    multiTimeframe: readyVegas({ bearish: { "4h": ["BTCUSDT"] } }),
  });
  const candidate = snapshot.candidates.find((row) => row.symbol === "BTCUSDT" && row.direction === "SHORT");
  assert.ok(candidate);
  assert.ok(candidate.conditions.some((condition) => condition.includes("MA30×OI")));
});

test("does not promote neutral chips, opposite evidence, or unavailable sources alone", async () => {
  const { buildCompositeSnapshot } = await import("../lib/radar/composite-ranking.ts");
  const snapshot = buildCompositeSnapshot({
    scannedAt: "2026-08-28T00:00:00.000Z",
    ma30Oi: { ...readyMa30(["BTCUSDT"]), status: "degraded" },
    reversal: readyReversal({ "1d": [{ symbol: "BTCUSDT", direction: "LONG" }] }),
    multiTimeframe: { ...readyVegas({ bearish: { "4h": ["BTCUSDT"] } }), status: "degraded" },
    radar: { mode: "demo", observations: [{ symbol: "ETHUSDT", participation: "SQUEEZE" }, { symbol: "SOLUSDT", top10Pct: 50 }] },
  });
  assert.equal(snapshot.candidates.length, 0);
});

test("attaches neutral concentration only to an existing directional candidate", async () => {
  const { buildCompositeSnapshot } = await import("../lib/radar/composite-ranking.ts");
  const snapshot = buildCompositeSnapshot({
    scannedAt: "2026-08-28T00:00:00.000Z",
    ma30Oi: readyMa30([]),
    reversal: readyReversal({}),
    multiTimeframe: readyVegas({}),
    radar: liveRadar([{ symbol: "BTCUSDT", top10Pct: 50, chipStage: "吸筹" }, { symbol: "ETHUSDT", top10Pct: 50 }]),
  });
  assert.equal(snapshot.candidates.length, 0);
});

test("skips distribution and stale source observations", async () => {
  const { buildCompositeSnapshot } = await import("../lib/radar/composite-ranking.ts");
  const snapshot = buildCompositeSnapshot({
    scannedAt: "2026-08-28T00:00:00.000Z",
    ma30Oi: { ...readyMa30(["BTCUSDT"]), scannedAt: "2026-08-25T00:00:00.000Z" },
    reversal: readyReversal({ "1d": [{ symbol: "BTCUSDT", direction: "LONG" }] }),
    multiTimeframe: readyVegas({}),
    radar: liveRadar([{ symbol: "BTCUSDT", top10Pct: 50, chipStage: "派发中" }]),
  });
  assert.equal(snapshot.candidates.length, 0);
  assert.ok(snapshot.warnings.length > 0);
});

test("counts neutral concentration once as an attached condition", async () => {
  const { buildCompositeSnapshot } = await import("../lib/radar/composite-ranking.ts");
  const snapshot = buildCompositeSnapshot({
    scannedAt: "2026-08-28T00:00:00.000Z",
    ma30Oi: readyMa30([]),
    reversal: readyReversal({}),
    multiTimeframe: readyVegas({ bullish: { "1h": ["BTCUSDT"], "4h": ["BTCUSDT"] } }),
    radar: liveRadar([
      { symbol: "BTCUSDT", participation: "SQUEEZE", top10Pct: 50, chipStage: "吸筹" },
      { symbol: "BTCUSDT", top10Pct: 55, chipStage: "吸筹" },
    ]),
  });
  assert.deepEqual(snapshot.candidates.map(({ symbol, direction, conditionCount, priority }) => [symbol, direction, conditionCount, priority]), [["BTCUSDT", "LONG", 3, "HIGH"]]);
  assert.ok(snapshot.candidates[0].conditions.some((condition) => condition.includes("筹码")));
});

test("does not count a stale live radar observation", async () => {
  const { buildCompositeSnapshot } = await import("../lib/radar/composite-ranking.ts");
  const snapshot = buildCompositeSnapshot({
    scannedAt: "2026-08-28T00:00:00.000Z",
    ma30Oi: readyMa30(["BTCUSDT"]),
    reversal: readyReversal({}),
    multiTimeframe: readyVegas({}),
    radar: { mode: "live", updatedAt: "2026-08-25T00:00:00.000Z", observations: [{ symbol: "BTCUSDT", participation: "SQUEEZE", top10Pct: 50 }] },
  });
  assert.equal(snapshot.candidates.length, 0);
  assert.ok(snapshot.warnings.some((warning) => /过期|stale/i.test(warning)));
});
