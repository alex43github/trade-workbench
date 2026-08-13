import assert from "node:assert/strict";
import test from "node:test";

import {
  buildKlineStreamBatches,
  fetchClosedKlines,
  listUsdtPerpetuals,
  parseClosedKlineEvent,
} from "../services/structure-radar/binance-public.ts";
import { BarCache } from "../services/structure-radar/bar-cache.ts";
import { RadarScanner } from "../services/structure-radar/scanner.ts";

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("keeps only trading USDT perpetual contracts", async () => {
  const fetcher = async () => jsonResponse({ symbols: [
    { symbol: "BTCUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT", marginAsset: "USDT" },
    { symbol: "ETHUSDT_260925", status: "TRADING", contractType: "CURRENT_QUARTER", quoteAsset: "USDT" },
    { symbol: "BTCDOMUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT", marginAsset: "USDT", underlyingType: "INDEX" },
    { symbol: "DELISTUSDT", status: "SETTLING", contractType: "PERPETUAL", quoteAsset: "USDT" },
    { symbol: "BTCUSDC", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDC" },
  ] });
  assert.deepEqual((await listUsdtPerpetuals(fetcher)).map((item) => item.symbol), ["BTCUSDT"]);
});

test("normalizes REST klines and drops the still-open candle", async () => {
  const now = 10_000;
  const rows = [
    [1_000, "100", "102", "99", "101", "10", 4_999],
    [5_000, "101", "103", "100", "102", "20", 10_001],
  ];
  const bars = await fetchClosedKlines("BTCUSDT", "1h", 2, async () => jsonResponse(rows), now);
  assert.equal(bars.length, 1);
  assert.deepEqual(bars[0], { time: 1, open: 100, high: 102, low: 99, close: 101, volume: 10, closed: true });
});

test("parses only final websocket klines", () => {
  const base = { e: "kline", s: "BTCUSDT", k: { t: 1_000, i: "1h", o: "100", h: "102", l: "99", c: "101", v: "10", x: true } };
  assert.equal(parseClosedKlineEvent({ stream: "btcusdt@kline_1h", data: base })?.bar.closed, true);
  assert.equal(parseClosedKlineEvent({ ...base, k: { ...base.k, x: false } }), null);
});

test("batches streams below a configured connection limit", () => {
  const batches = buildKlineStreamBatches(["BTCUSDT", "ETHUSDT"], ["15m", "1h", "4h"], 4);
  assert.deepEqual(batches.map((batch) => batch.length), [4, 2]);
  assert.equal(batches[0][0], "btcusdt@kline_15m");
});

test("bar cache deduplicates replay and reports gaps before accepting a later bar", () => {
  const cache = new BarCache({ maxBars: 5 });
  const bar = { time: 1_000, open: 100, high: 101, low: 99, close: 100, volume: 1, closed: true };
  assert.equal(cache.append("BTCUSDT", "1h", bar).status, "appended");
  assert.equal(cache.append("BTCUSDT", "1h", { ...bar }).status, "duplicate");
  assert.equal(cache.append("BTCUSDT", "1h", { ...bar, time: 1_000 + 7_200 }).status, "gap");
  assert.equal(cache.get("BTCUSDT", "1h").length, 1);
});

test("bar cache identifies stale series", () => {
  const cache = new BarCache();
  cache.replace("BTCUSDT", "1h", [{ time: 1_000, open: 100, high: 101, low: 99, close: 100, volume: 1, closed: true }]);
  assert.equal(cache.quality("BTCUSDT", "1h", 1_000 + 7_201).status, "stale");
});

test("scanner persists a closed-bar candidate before publishing it downstream", async () => {
  const order = [];
  const cache = new BarCache();
  const history = Array.from({ length: 48 }, (_, index) => ({
    time: 1_000 + index * 3_600, open: 100, high: 101, low: 99, close: 100, volume: 1, closed: true,
  }));
  cache.replace("BTCUSDT", "1h", history);
  const scanner = new RadarScanner({
    cache,
    detectors: [async () => ({
      symbol: "BTCUSDT", timeframe: "1h", setup: "PLATFORM_RECLAIM", state: "CANDIDATE",
      detectedAt: history.at(-1).time + 3_600, score: 80, anchorHash: "abc",
    })],
    store: { async get() { return null; }, async save(signal) { order.push(`save:${signal.state}`); } },
    async onSignal(signal) { order.push(`emit:${signal.state}`); },
  });
  const event = { e: "kline", s: "BTCUSDT", k: {
    t: (history.at(-1).time + 3_600) * 1_000, i: "1h", o: "100", h: "102", l: "99", c: "101", v: "20", x: true,
  } };
  assert.equal((await scanner.handleRawEvent(event)).status, "candidate");
  assert.deepEqual(order, ["save:CANDIDATE", "emit:CANDIDATE"]);
});

test("scanner ignores open and duplicate websocket events", async () => {
  let scans = 0;
  const cache = new BarCache();
  const scanner = new RadarScanner({
    cache,
    detectors: [async () => { scans += 1; return null; }],
    store: { async get() { return null; }, async save() {} },
  });
  const event = { e: "kline", s: "BTCUSDT", k: { t: 1_000_000, i: "1h", o: "100", h: "101", l: "99", c: "100", v: "1", x: false } };
  assert.equal((await scanner.handleRawEvent(event)).status, "ignored");
  event.k.x = true;
  assert.equal((await scanner.handleRawEvent(event)).status, "scanned");
  assert.equal((await scanner.handleRawEvent(event)).status, "duplicate");
  assert.equal(scans, 1);
});

test("scanner backfills a gap before detecting on the newest bar", async () => {
  const cache = new BarCache();
  const first = { time: 1_000, open: 100, high: 101, low: 99, close: 100, volume: 1, closed: true };
  cache.replace("BTCUSDT", "1h", [first]);
  let backfills = 0;
  let scannedLength = 0;
  const missing = { ...first, time: 4_600 };
  const latest = { ...first, time: 8_200 };
  const scanner = new RadarScanner({
    cache,
    async backfill() { backfills += 1; return [first, missing, latest]; },
    detectors: [async (bars) => { scannedLength = bars.length; return null; }],
    store: { async get() { return null; }, async save() {} },
  });
  const result = await scanner.handleClosedBar("BTCUSDT", "1h", latest);
  assert.equal(result.status, "scanned");
  assert.equal(backfills, 1);
  assert.equal(scannedLength, 3);
});
