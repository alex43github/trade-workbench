import assert from "node:assert/strict";
import test from "node:test";

import { isStablecoinUsdtPerpetual, runMa30FullMarketScan, selectMa30ShortWatch } from "../lib/radar/ma30-scanner.ts";

const HOUR = 3_600_000;

function closedBars({ now, rate = 0.0005, count = 120 }) {
  const boundary = Math.floor(now.getTime() / HOUR) * HOUR;
  return Array.from({ length: count }, (_, index) => {
    const closeTime = boundary - (count - 1 - index) * HOUR - 1;
    const close = 100 * Math.exp(rate * index);
    return { open: close, high: close, low: close, close, closeTime, volume: 1 };
  });
}

test("full-market runner retries transient symbol failures after the first pass and can recover to FULL", async () => {
  const now = new Date("2026-09-14T04:19:00.000Z");
  const symbols = Array.from({ length: 12 }, (_, i) => `S${String(i).padStart(2, "0")}USDT`);
  symbols[4] = "STABLEUSDT";
  const attempts = new Map();

  const result = await runMa30FullMarketScan({
    now,
    fetchers: {
      listSymbols: async () => symbols,
      fetchClosedBars: async (symbol) => {
        const attempt = (attempts.get(symbol) ?? 0) + 1;
        attempts.set(symbol, attempt);
        if (symbol === "STABLEUSDT" && attempt === 1) throw new Error("transient network error");
        const index = symbols.indexOf(symbol);
        return closedBars({ now, rate: 0.0001 + index * 0.00008 });
      },
    },
  });

  assert.equal(result.status, "FULL");
  assert.equal(result.coverage.universe, 12);
  assert.equal(result.coverage.fetchedSuccessfully, 12);
  assert.equal(result.coverage.slopeQualified, 12);
  assert.equal(result.coverage.failed, 0);
  assert.equal(result.coverage.staleLastCandle, 0);
  assert.equal(attempts.get("STABLEUSDT"), 2);
  assert.equal(result.a.length, 10);
  assert.equal(result.a[0].symbol, "S11USDT");
  assert.ok(result.ai.length <= 5);
});

test("runner stays PARTIAL and exposes the exact symbol when retry also fails", async () => {
  const now = new Date("2026-09-14T04:19:00.000Z");
  const result = await runMa30FullMarketScan({
    now,
    fetchers: {
      listSymbols: async () => ["GOODUSDT", "BADUSDT"],
      fetchClosedBars: async (symbol) => {
        if (symbol === "BADUSDT") throw new Error("still unavailable");
        return closedBars({ now });
      },
    },
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.coverage.universe, 2);
  assert.equal(result.coverage.failed, 1);
  assert.equal(result.failures[0].symbol, "BADUSDT");
});

test("runner marks a symbol stale when its latest candle is not the latest fully closed 1H candle", async () => {
  const now = new Date("2026-09-14T04:19:00.000Z");
  const bars = closedBars({ now });
  bars.at(-1).closeTime -= HOUR;

  const result = await runMa30FullMarketScan({
    now,
    fetchers: {
      listSymbols: async () => ["STALEUSDT"],
      fetchClosedBars: async () => bars,
    },
  });

  assert.equal(result.status, "PARTIAL");
  assert.equal(result.coverage.staleLastCandle, 1);
  assert.equal(result.stale[0].symbol, "STALEUSDT");
  assert.equal(result.coverage.slopeQualified, 0);
});

test("user-visible short watch is capped and strongly prefers candidates closer to MA30", () => {
  const rows = [
    { symbol: "FARUSDT", stage: "EARLY_DOWN_ACCELERATION", slope20: -0.5, slope6Acceleration: -0.8, priceVsMa30Pct: -11.5 },
    { symbol: "NEAR1USDT", stage: "EARLY_DOWN_ACCELERATION", slope20: -0.2, slope6Acceleration: -0.3, priceVsMa30Pct: -1.0 },
    { symbol: "NEAR2USDT", stage: "EARLY_DOWN_ACCELERATION", slope20: -0.25, slope6Acceleration: -0.35, priceVsMa30Pct: -2.0 },
    { symbol: "N3USDT", stage: "EARLY_DOWN_ACCELERATION", slope20: -0.1, slope6Acceleration: -0.2, priceVsMa30Pct: -3.0 },
    { symbol: "N4USDT", stage: "EARLY_DOWN_ACCELERATION", slope20: -0.1, slope6Acceleration: -0.19, priceVsMa30Pct: -4.0 },
    { symbol: "N5USDT", stage: "EARLY_DOWN_ACCELERATION", slope20: -0.1, slope6Acceleration: -0.18, priceVsMa30Pct: -5.0 },
    { symbol: "N6USDT", stage: "EARLY_DOWN_ACCELERATION", slope20: -0.1, slope6Acceleration: -0.17, priceVsMa30Pct: -6.0 },
  ];

  const selected = selectMa30ShortWatch(rows, 5);
  assert.equal(selected.length, 5);
  assert.equal(selected.some((row) => row.symbol === "FARUSDT"), false);
  assert.equal(selected[0].symbol, "NEAR2USDT");
});


test("stablecoin USDT perpetuals are excluded before ranking and API fetch", async () => {
  const now = new Date("2026-09-14T04:19:00.000Z");
  const fetched = [];
  const result = await runMa30FullMarketScan({
    now,
    fetchers: {
      listSymbols: async () => ["USDCUSDT", "FDUSDUSDT", "BTCUSDT", "KOMAUSDT"],
      fetchClosedBars: async (symbol) => {
        fetched.push(symbol);
        return closedBars({ now, rate: symbol === "BTCUSDT" ? 0.0005 : 0.0008 });
      },
    },
  });
  assert.equal(isStablecoinUsdtPerpetual("USDCUSDT"), true);
  assert.equal(isStablecoinUsdtPerpetual("FDUSDUSDT"), true);
  assert.equal(isStablecoinUsdtPerpetual("BTCUSDT"), false);
  assert.deepEqual(fetched.sort(), ["BTCUSDT", "KOMAUSDT"]);
  assert.equal(result.coverage.universe, 2);
  assert.equal(result.coverage.excludedStablecoins, 2);
  assert.equal(result.a.some((row) => row.symbol === "USDCUSDT"), false);
  assert.equal(result.b.some((row) => row.symbol === "USDCUSDT"), false);
  assert.equal(result.c.some((row) => row.symbol === "USDCUSDT"), false);
  assert.equal(result.ai.some((row) => row.symbol === "USDCUSDT"), false);
});


test("D-class keeps LONG top20 and SHORT top10 by raw 1H MA30 slope", async () => {
  const now = new Date("2026-09-14T04:19:00.000Z");
  const longs = Array.from({ length: 25 }, (_, i) => `L${String(i).padStart(2, "0")}USDT`);
  const shorts = Array.from({ length: 15 }, (_, i) => `Q${String(i).padStart(2, "0")}USDT`);
  const symbols = [...longs, ...shorts];
  const result = await runMa30FullMarketScan({
    now,
    fetchers: {
      listSymbols: async () => symbols,
      fetchClosedBars: async (symbol) => {
        const li = longs.indexOf(symbol);
        const si = shorts.indexOf(symbol);
        return closedBars({ now, rate: li >= 0 ? 0.0002 + li * 0.00003 : -(0.0002 + si * 0.00003) });
      },
    },
  });
  assert.equal(result.dLong.length, 20);
  assert.equal(result.dShort.length, 10);
  assert.ok(result.dLong.every((row) => row.slope20 > 0 && row.direction === "LONG"));
  assert.ok(result.dShort.every((row) => row.slope20 < 0 && row.direction === "SHORT"));
  assert.ok(result.dLong[0].slope20 >= result.dLong.at(-1).slope20);
  assert.ok(result.dShort[0].slope20 <= result.dShort.at(-1).slope20);
});
