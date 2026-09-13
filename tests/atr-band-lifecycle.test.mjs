import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ATR lifecycle scan exposes the persisted full-market scanner and three-hour scheduler", async () => {
  const [route, maintenance, page] = await Promise.all([
    readFile(new URL("../app/api/radar/atr-band/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/advisory/maintenance/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(route, /export async function runAtrLifecycleScan/);
  assert.match(route, /loadAtrLifecycleDashboard/);
  assert.match(maintenance, /runAtrLifecycleScan/);
  assert.match(maintenance, /MA30 ± 3 ATR 生命周期每 3 小时扫描/);
  assert.match(maintenance, /shanghaiHour\(\) % 3 === 0/);
  assert.match(page, /MA30 ± 3ATR 生命周期/);
  assert.match(page, /强势池/);
  assert.match(page, /前一根 K 线/);
});

function makeBars(closes, openInterest = []) {
  return closes.map((close, index) => ({
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    closeTime: (index + 1) * 3_600_000,
    ...(openInterest[index] === undefined ? {} : { openInterest: openInterest[index] }),
  }));
}

function flatThen(closes, openInterest) {
  return makeBars([...Array(30).fill(100), ...closes], openInterest);
}

function appendBars(previous, closes, openInterest = []) {
  const startIndex = previous.length;
  return [
    ...previous,
    ...closes.map((close, index) => ({
      open: close,
      high: close + 1,
      low: close - 1,
      close,
      closeTime: (startIndex + index + 1) * 3_600_000,
      ...(openInterest[index] === undefined ? {} : { openInterest: openInterest[index] }),
    })),
  ];
}

function observation(symbol, bars, openInterest) {
  return { symbol, bars, openInterest };
}

test("long lifecycle enters STRONG after three closed candles beyond the upper ATR band", async () => {
  const { deriveLifecycleSignal, transitionAtrBandLifecycle } = await import("../lib/radar/atr-band-lifecycle.ts");
  const bars = flatThen([130, 130, 130]);

  const signal = deriveLifecycleSignal(bars);
  assert.equal(signal?.direction, "LONG");
  assert.equal(signal?.status, "STRONG");
  assert.equal(signal?.consecutiveBars, 3);

  const lifecycle = transitionAtrBandLifecycle(null, observation("BTCUSDT", bars, 100));
  assert.equal(lifecycle?.symbol, "BTCUSDT");
  assert.equal(lifecycle?.direction, "LONG");
  assert.equal(lifecycle?.status, "STRONG");
  assert.equal(lifecycle?.entryTime, bars.at(-1).closeTime);
  assert.equal(lifecycle?.entryPrice, 130);
  assert.equal(lifecycle?.entryOpenPrice, 130);
  assert.equal(lifecycle?.outsideBandBars, 3);
  assert.equal(lifecycle?.lifecycleBars, 1);
  assert.equal(lifecycle?.currentPrice, 130);
  assert.equal(lifecycle?.entryOi, 100);
  assert.equal(lifecycle?.currentOi, 100);
  assert.equal(lifecycle?.peakOi, 100);
  assert.equal(lifecycle?.oiChangePct, 0);
});

test("long STRONG lifecycle becomes WARNING while price remains above MA30", async () => {
  const { transitionAtrBandLifecycle } = await import("../lib/radar/atr-band-lifecycle.ts");
  const entryBars = flatThen([130, 130, 130]);
  const entry = transitionAtrBandLifecycle(null, observation("ETHUSDT", entryBars, 100));
  assert.ok(entry);

  const continuationBars = appendBars(entryBars, [150], [140]);
  const continued = transitionAtrBandLifecycle(entry, observation("ETHUSDT", continuationBars, 140));
  assert.equal(continued?.status, "STRONG");

  const warningBars = appendBars(continuationBars, [110], [120]);
  const warning = transitionAtrBandLifecycle(continued, observation("ETHUSDT", warningBars, 120));
  assert.equal(warning?.status, "WARNING");
  assert.equal(warning?.warningTime, warningBars.at(-1).closeTime);
  assert.equal(warning?.endTime, null);
  assert.equal(warning?.outsideBandBars, 4);
  assert.equal(warning?.lifecycleBars, 3);
  assert.equal(warning?.currentPrice, 110);
  assert.equal(warning?.extremePrice, 151);
  assert.equal(warning?.peakOi, 140);
  assert.equal(warning?.currentOi, 120);
  assert.equal(warning?.oiChangePct, 20);
  assert.ok((warning?.maxFavorablePct ?? 0) > 15);
  assert.ok((warning?.maxAtrMultiple ?? 0) > 0);
  assert.ok((warning?.previousMa30DeviationPct ?? 0) > 0);
  assert.ok((warning?.previousBandDeviationPct ?? 0) > 0);
});

test("long WARNING lifecycle becomes HISTORY only after a close below MA30", async () => {
  const { transitionAtrBandLifecycle } = await import("../lib/radar/atr-band-lifecycle.ts");
  const entryBars = flatThen([130, 130, 130]);
  const entry = transitionAtrBandLifecycle(null, observation("SOLUSDT", entryBars, 100));
  const warningBars = appendBars(entryBars, [110], [120]);
  const warning = transitionAtrBandLifecycle(entry, observation("SOLUSDT", warningBars, 120));
  assert.equal(warning?.status, "WARNING");

  const historyBars = appendBars(warningBars, [100], [90]);
  const history = transitionAtrBandLifecycle(warning, observation("SOLUSDT", historyBars, 90));
  assert.equal(history?.status, "HISTORY");
  assert.equal(history?.endTime, historyBars.at(-1).closeTime);
  assert.equal(history?.currentPrice, 100);
  assert.equal(history?.warningTime, warningBars.at(-1).closeTime);
  assert.equal(history?.entryOi, 100);
  assert.equal(history?.currentOi, 90);
  assert.equal(history?.peakOi, 120);
  assert.equal(history?.oiChangePct, -10);
  assert.equal(history?.outsideBandBars, 3);
  assert.equal(history?.lifecycleBars, 3);
  assert.equal(history?.endOpenPrice, 100);
  assert.equal(history?.lifecycleReturnPct, -23.08);
});

test("short lifecycle mirrors the three-candle entry rule below the lower ATR band", async () => {
  const { deriveLifecycleSignal, transitionAtrBandLifecycle } = await import("../lib/radar/atr-band-lifecycle.ts");
  const bars = flatThen([70, 70, 70]);

  const signal = deriveLifecycleSignal(bars);
  assert.equal(signal?.direction, "SHORT");
  assert.equal(signal?.status, "STRONG");
  assert.equal(signal?.consecutiveBars, 3);

  const lifecycle = transitionAtrBandLifecycle(null, observation("XRPUSDT", bars, 200));
  assert.equal(lifecycle?.direction, "SHORT");
  assert.equal(lifecycle?.status, "STRONG");
  assert.equal(lifecycle?.entryPrice, 70);
  assert.equal(lifecycle?.currentPrice, 70);
  assert.equal(lifecycle?.entryOi, 200);
  assert.equal(lifecycle?.currentOi, 200);
  assert.equal(lifecycle?.peakOi, 200);
  assert.equal(lifecycle?.oiChangePct, 0);
  assert.ok((lifecycle?.maxFavorablePct ?? 0) > 0);
});

test("flat ATR data keeps lifecycle distance metrics finite", async () => {
  const { transitionAtrBandLifecycle } = await import("../lib/radar/atr-band-lifecycle.ts");
  const closes = [...Array(30).fill(100), ...Array(15).fill(110)];
  const bars = closes.map((close, index) => ({
    open: close,
    high: close,
    low: close,
    close,
    closeTime: (index + 1) * 3_600_000,
  }));

  const lifecycle = transitionAtrBandLifecycle(null, observation("ADAUSDT", bars, 50));
  assert.equal(lifecycle?.status, "STRONG");
  assert.equal(lifecycle?.maxAtrMultiple, 0);
  assert.ok(Number.isFinite(lifecycle?.maxSignedAtrDistance));
});

test("legacy completed lifecycle can show a directional return fallback from its stored prices", async () => {
  const { calculateLifecycleDirectionalReturn } = await import("../lib/radar/atr-band-lifecycle.ts");
  assert.equal(calculateLifecycleDirectionalReturn("LONG", 100, 85), -15);
  assert.equal(calculateLifecycleDirectionalReturn("SHORT", 100, 85), 15);
});

test("legacy lifecycle infers outside-band bars from hourly entry and warning timestamps", async () => {
  const { inferLegacyOutsideBandBars } = await import("../lib/radar/atr-band-lifecycle.ts");
  const hour = 3_600_000;
  assert.equal(inferLegacyOutsideBandBars({ status: "STRONG", entryTime: 10 * hour, lastUpdatedTime: 12 * hour, warningTime: null }), 5);
  assert.equal(inferLegacyOutsideBandBars({ status: "WARNING", entryTime: 10 * hour, lastUpdatedTime: 12 * hour, warningTime: 13 * hour }), 5);
  assert.equal(inferLegacyOutsideBandBars({ status: "HISTORY", entryTime: 10 * hour, lastUpdatedTime: 14 * hour, warningTime: 11 * hour }), 3);
});
