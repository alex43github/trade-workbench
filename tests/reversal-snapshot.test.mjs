import assert from "node:assert/strict";
import test from "node:test";
import { buildReversalScan, REVERSAL_INTERVALS, saveReversalScan } from "../lib/radar/reversal-snapshot.ts";

test("scans the latest closed candle against the five-bar structure in both directions", async () => {
  const snapshot = await buildReversalScan({
    listSymbols: async () => ["BTCUSDT", "ETHUSDT"],
    fetchClosedBars: async (symbol) => symbol === "BTCUSDT" ? [
      { open: 110, high: 112, low: 105, close: 107, closeTime: 1 }, { open: 107, high: 109, low: 102, close: 104, closeTime: 2 }, { open: 104, high: 106, low: 99, close: 101, closeTime: 3 }, { open: 101, high: 103, low: 96, close: 98, closeTime: 4 }, { open: 98, high: 100, low: 94, close: 95, closeTime: 5 }, { open: 94, high: 106, low: 91, close: 105, closeTime: 6 },
    ] : [
      { open: 90, high: 95, low: 88, close: 93, closeTime: 1 }, { open: 93, high: 98, low: 91, close: 96, closeTime: 2 }, { open: 96, high: 101, low: 94, close: 99, closeTime: 3 }, { open: 99, high: 104, low: 97, close: 102, closeTime: 4 }, { open: 102, high: 106, low: 100, close: 105, closeTime: 5 }, { open: 107, high: 110, low: 93, close: 94, closeTime: 6 },
    ],
  }, "1d", new Date("2026-08-20T00:00:00.000Z"));

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(new Set(snapshot.candidates.map((item) => item.direction)), new Set(["LONG", "SHORT"]));
  assert.ok(snapshot.candidates.every((item) => item.signalTime === 6));
});

test("scans every closed candle in the requested signal window instead of only the latest candle", async () => {
  const snapshot = await buildReversalScan({
    listSymbols: async () => ["BTCUSDT"],
    fetchClosedBars: async () => [
      { open: 110, high: 112, low: 105, close: 107, closeTime: 1 },
      { open: 107, high: 109, low: 102, close: 104, closeTime: 2 },
      { open: 104, high: 106, low: 99, close: 101, closeTime: 3 },
      { open: 101, high: 103, low: 96, close: 98, closeTime: 4 },
      { open: 98, high: 100, low: 94, close: 95, closeTime: 5 },
      { open: 94, high: 106, low: 91, close: 105, closeTime: 6 },
      { open: 105, high: 106, low: 103, close: 104, closeTime: 7 },
    ],
  }, "15m", new Date("2026-08-20T00:00:00.000Z"), { signalWindowBars: 2 });

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.candidates.map((candidate) => [candidate.symbol, candidate.signalTime, candidate.direction]), [["BTCUSDT", 6, "LONG"]]);
});

test("archives only the configured intervals while still saving every scan snapshot", async () => {
  const statements = [];
  const db = {
    prepare(sql) {
      statements.push(sql);
      return { bind: () => ({ run: async () => undefined }) };
    },
  };
  const candidate = {
    symbol: "BTCUSDT", interval: "15m", direction: "LONG", signalTime: 6, signalClose: 105,
    priorLow: 94, priorHigh: 112, reclaimLevel: "HIGH", wickRatio: 0.2, breakRatio: 0.1,
    bodyRatio: 2, breakoutLookbackBars: 5, breakoutLookbackCapped: false,
    closeBreakoutLookbackBars: 14, closeBreakoutLookbackCapped: false, strengthArrows: 2, isSuperStrong: true, score: 90,
  };
  const snapshot = (interval) => ({
    status: "ready", scannedAt: "2026-09-02T08:05:00.000Z", interval, source: "periodic", candidates: [{ ...candidate, interval }],
    scannedSymbols: 1, successfulSymbols: 1, failedSymbols: 0,
    progress: { totalSymbols: 1, scannedSymbols: 1, matchedSymbols: 1, remainingSymbols: 0, percent: 100, currentSymbol: null },
  });

  await saveReversalScan(db, snapshot("15m"), { archiveIntervals: ["1h", "4h"] });
  await saveReversalScan(db, snapshot("1h"), { archiveIntervals: ["1h", "4h"] });

  assert.equal(statements.filter((sql) => sql.includes("INSERT INTO radar_reversal_archives")).length, 1);
});

test("accepts the Binance weekly interval for structural scans", async () => {
  const requestedIntervals = [];
  const snapshot = await buildReversalScan({
    listSymbols: async () => ["BTCUSDT"],
    fetchClosedBars: async (_symbol, interval) => {
      requestedIntervals.push(interval);
      return [
        { open: 110, high: 112, low: 105, close: 107, closeTime: 1 }, { open: 107, high: 109, low: 102, close: 104, closeTime: 2 }, { open: 104, high: 106, low: 99, close: 101, closeTime: 3 }, { open: 101, high: 103, low: 96, close: 98, closeTime: 4 }, { open: 98, high: 100, low: 94, close: 95, closeTime: 5 }, { open: 94, high: 106, low: 91, close: 105, closeTime: 6 },
      ];
    },
  }, "1w", new Date("2026-08-20T00:00:00.000Z"));

  assert.ok(REVERSAL_INTERVALS.includes("1w"));
  assert.equal(snapshot.interval, "1w");
  assert.deepEqual(requestedIntervals, ["1w"]);
});

test("degrades when a symbol has no two complete candles", async () => {
  const snapshot = await buildReversalScan({
    listSymbols: async () => ["BTCUSDT"],
    fetchClosedBars: async () => Array.from({ length: 5 }, (_, index) => ({ open: 1, high: 2, low: 0.5, close: 1.5, closeTime: index + 1 })),
  }, "4h", new Date("2026-08-20T00:00:00.000Z"));

  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.candidates.length, 0);
  assert.match(snapshot.warning ?? "", /数据不足/);
});

test("keeps the transport diagnosis when the symbol list request fails", async () => {
  const snapshot = await buildReversalScan({
    listSymbols: async () => { throw Object.assign(new Error("Binance 公共行情不可达"), { status: 503, hint: "请检查服务器出口" }); },
    fetchClosedBars: async () => [],
  }, "4h", new Date("2026-08-20T00:00:00.000Z"));

  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.diagnostic?.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(snapshot.diagnostic?.detail, "Binance 公共行情不可达：请检查服务器出口");
});

test("reports deterministic progress while scanning symbols", async () => {
  const updates = [];
  const snapshot = await buildReversalScan({
    listSymbols: async () => ["AAAUSDT", "BBBUSDT"],
    fetchClosedBars: async () => [
      { open: 110, high: 112, low: 105, close: 107, closeTime: 1 }, { open: 107, high: 109, low: 102, close: 104, closeTime: 2 }, { open: 104, high: 106, low: 99, close: 101, closeTime: 3 }, { open: 101, high: 103, low: 96, close: 98, closeTime: 4 }, { open: 98, high: 100, low: 94, close: 95, closeTime: 5 }, { open: 94, high: 106, low: 91, close: 105, closeTime: 6 },
    ],
  }, "1d", new Date("2026-08-20T00:00:00.000Z"), {
    onProgress: (progress) => updates.push(progress),
  });

  assert.equal(updates[0].totalSymbols, 2);
  assert.equal(updates.at(-1).scannedSymbols, 2);
  assert.equal(updates.at(-1).remainingSymbols, 0);
  assert.equal(updates.at(-1).matchedSymbols, 2);
  assert.equal(updates.at(-1).percent, 100);
  assert.equal(snapshot.progress.percent, 100);
});
