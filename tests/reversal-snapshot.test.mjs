import assert from "node:assert/strict";
import test from "node:test";
import { buildReversalScan } from "../lib/radar/reversal-snapshot.ts";

test("scans the latest closed candle against the immediately preceding candle in both directions", async () => {
  const snapshot = await buildReversalScan({
    listSymbols: async () => ["BTCUSDT", "ETHUSDT"],
    fetchClosedBars: async (symbol) => symbol === "BTCUSDT" ? [
      { open: 100, high: 120, low: 90, close: 115, closeTime: 1 },
      { open: 96, high: 123, low: 80, close: 121, closeTime: 2 },
    ] : [
      { open: 100, high: 120, low: 90, close: 95, closeTime: 1 },
      { open: 105, high: 130, low: 90, close: 100, closeTime: 2 },
    ],
  }, "1d", new Date("2026-08-20T00:00:00.000Z"));

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.candidates.map((item) => item.direction), ["LONG", "SHORT"]);
  assert.equal(snapshot.candidates[0].signalTime, 2);
  assert.equal(snapshot.candidates[1].signalTime, 2);
});

test("degrades when a symbol has no two complete candles", async () => {
  const snapshot = await buildReversalScan({
    listSymbols: async () => ["BTCUSDT"],
    fetchClosedBars: async () => [{ open: 1, high: 2, low: 0.5, close: 1.5, closeTime: 1 }],
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
      { open: 100, high: 120, low: 90, close: 115, closeTime: 1 },
      { open: 96, high: 123, low: 80, close: 121, closeTime: 2 },
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
