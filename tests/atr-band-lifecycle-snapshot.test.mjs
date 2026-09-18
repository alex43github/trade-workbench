import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-atr-lifecycle-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const snapshotModule = await import("../lib/radar/atr-band-lifecycle-snapshot.ts").catch((error) => error);

function api() {
  if (snapshotModule instanceof Error) {
    assert.fail(`ATR lifecycle snapshot module is unavailable: ${snapshotModule.message}`);
  }
  return snapshotModule;
}

const HOUR = 3_600_000;

function makeBars(closes) {
  return closes.map((close, index) => ({
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    closeTime: (index + 1) * HOUR,
  }));
}

function appendBars(previous, closes) {
  const start = previous.length;
  return previous.concat(closes.map((close, index) => ({
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    closeTime: (start + index + 1) * HOUR,
  })));
}

function oiPoints(bars, values) {
  return bars.map((bar, index) => ({ timestamp: bar.closeTime, openInterest: values[index] }));
}

function fetchers(bars, values) {
  return {
    listSymbols: async () => ["BTCUSDT"],
    fetchClosedBars: async () => bars,
    fetchClosedHourlyOi: async () => oiPoints(bars, values),
  };
}

test("groups strong, warning, and history while replaying every unseen closed candle", async () => {
  const { buildAtrLifecycleScan } = api();
  const entryBars = makeBars([...Array(30).fill(100), 130, 130, 130]);
  const entryOi = [...Array(30).fill(80), 100, 100, 100];
  const entered = await buildAtrLifecycleScan(
    fetchers(entryBars, entryOi),
    new Date("2026-09-01T00:10:00.000Z"),
  );

  assert.equal(entered.strong.length, 1);
  assert.equal(entered.warning.length, 0);
  assert.equal(entered.history.length, 0);
  assert.equal(entered.strong[0].entryPrice, 130);
  assert.equal(entered.strong[0].entryOi, 100);

  const warningBars = appendBars(entryBars, [150, 110]);
  const warningOi = [...entryOi, 140, 120];
  const warning = await buildAtrLifecycleScan(
    fetchers(warningBars, warningOi),
    entered.strong,
    new Date("2026-09-01T03:10:00.000Z"),
  );

  assert.equal(warning.strong.length, 0);
  assert.equal(warning.warning.length, 1);
  assert.equal(warning.warning[0].status, "WARNING");
  assert.equal(warning.warning[0].extremePrice, 151);
  assert.equal(warning.warning[0].peakOi, 140);
  assert.equal(warning.warning[0].currentOi, 120);

  const historyBars = appendBars(warningBars, [100]);
  const historyOi = [...warningOi, 90];
  const completed = await buildAtrLifecycleScan(
    fetchers(historyBars, historyOi),
    warning.warning,
    new Date("2026-09-01T06:10:00.000Z"),
  );

  assert.equal(completed.strong.length, 0);
  assert.equal(completed.warning.length, 0);
  assert.equal(completed.history.length, 1);
  assert.equal(completed.history[0].status, "HISTORY");
  assert.equal(completed.history[0].endTime, historyBars.at(-1).closeTime);
  assert.equal(completed.history[0].extremePrice, 151);
  assert.equal(completed.history[0].peakOi, 140);
  assert.equal(completed.history[0].currentOi, 90);
  assert.equal(completed.history[0].oiChangePct, -10);
});

test("persists a completed lifecycle and keeps it in the historical dashboard", async () => {
  const { buildAtrLifecycleScan, loadAtrLifecycleDashboard, saveAtrLifecycle } = api();
  const { ensureAtrBandLifecycleSchema } = await import("../db/ensure.ts");
  const { getD1 } = await import("../db/index.ts");
  const entryBars = makeBars([...Array(30).fill(100), 130, 130, 130]);
  const entry = await buildAtrLifecycleScan(
    fetchers(entryBars, [...Array(30).fill(80), 100, 100, 100]),
    new Date("2026-09-01T00:10:00.000Z"),
  );
  const warningBars = appendBars(entryBars, [150, 110]);
  const warning = await buildAtrLifecycleScan(
    fetchers(warningBars, [...Array(30).fill(80), 100, 100, 100, 140, 120]),
    entry.strong,
    new Date("2026-09-01T03:10:00.000Z"),
  );
  const historyBars = appendBars(warningBars, [100]);
  const completed = await buildAtrLifecycleScan(
    fetchers(historyBars, [...Array(30).fill(80), 100, 100, 100, 140, 120, 90]),
    warning.warning,
    new Date("2026-09-01T06:10:00.000Z"),
  );

  const db = await getD1();
  await ensureAtrBandLifecycleSchema();
  await saveAtrLifecycle(db, entry.strong[0], entry.scanBucket);
  await saveAtrLifecycle(db, warning.warning[0], warning.scanBucket);
  await saveAtrLifecycle(db, completed.history[0], completed.scanBucket);

  const dashboard = await loadAtrLifecycleDashboard(db);
  assert.equal(dashboard.strong.length, 0);
  assert.equal(dashboard.warning.length, 0);
  assert.equal(dashboard.history.length, 1);
  assert.equal(dashboard.history[0].status, "HISTORY");
  assert.equal(dashboard.history[0].entryTime, entry.strong[0].entryTime);
  assert.equal(dashboard.history[0].maxFavorablePct, completed.history[0].maxFavorablePct);

  const rows = await db.prepare("SELECT COUNT(*) AS total FROM radar_atr_band_lifecycles").bind().first();
  assert.equal(Number(rows.total), 1);
});

test("uses one stable Beijing scan bucket for each hourly closed-candle window", async () => {
  const { buildAtrLifecycleScan } = api();
  const bars = makeBars([...Array(30).fill(100), 130, 130, 130]);
  const values = [...Array(30).fill(80), 100, 100, 100];
  const beforeBoundary = await buildAtrLifecycleScan(
    fetchers(bars, values),
    new Date("2026-09-01T06:59:00.000Z"),
  );
  const afterBoundary = await buildAtrLifecycleScan(
    fetchers(bars, values),
    new Date("2026-09-01T05:00:00.000Z"),
  );

  assert.equal(beforeBoundary.scanBucket, "2026-09-01-14");
  assert.equal(afterBoundary.scanBucket, "2026-09-01-13");
  assert.notEqual(beforeBoundary.scanBucket, afterBoundary.scanBucket);
});

test("confirms only the 1H-qualified pool with 4H bars at Beijing four-hour closes", async () => {
  const { buildAtrLifecycleScan } = api();
  const oneHourBars = makeBars([...Array(30).fill(100), 130, 130, 130]);
  const fourHourBars = makeBars([...Array(30).fill(100), 130, 130, 130]);
  let fourHourRequests = 0;
  const scan = await buildAtrLifecycleScan({
    ...fetchers(oneHourBars, [...Array(30).fill(80), 100, 100, 100]),
    fetchClosedFourHourBars: async () => {
      fourHourRequests += 1;
      return fourHourBars;
    },
  }, new Date("2026-09-01T00:10:00.000Z"), { multiplier: 1 });

  assert.equal(scan.strong.length, 1);
  assert.equal(fourHourRequests, 1);
  assert.equal(scan.strong[0].fourHourConfirmed, true);
  assert.equal(scan.strong[0].fourHourConfirmedAt, Date.parse("2026-09-01T00:10:00.000Z"));
});

test("scans each normalized full-market symbol and persists the scan bucket", async () => {
  const { buildAtrLifecycleScan, hasAtrLifecycleScanBucket, loadAtrLifecycleDashboard, saveAtrLifecycle } = api();
  const { ensureAtrBandLifecycleSchema } = await import("../db/ensure.ts");
  const { getD1 } = await import("../db/index.ts");
  const bars = makeBars([...Array(30).fill(100), 130, 130, 130]);
  const values = [...Array(30).fill(80), 100, 100, 100];
  const requested = [];
  const scan = await buildAtrLifecycleScan({
    listSymbols: async () => ["btcusdt", "BTCUSDT", "ETHUSDT"],
    fetchClosedBars: async (symbol) => {
      requested.push(symbol);
      return bars;
    },
    fetchClosedHourlyOi: async () => oiPoints(bars, values),
  }, new Date("2026-09-01T07:10:00.000Z"));

  assert.equal(scan.scannedSymbols, 2);
  assert.equal(scan.successfulSymbols, 2);
  assert.deepEqual(requested.toSorted(), ["BTCUSDT", "ETHUSDT"]);
  assert.equal(scan.strong.length, 2);

  const db = await getD1();
  await ensureAtrBandLifecycleSchema();
  await saveAtrLifecycle(db, scan);
  assert.equal(await hasAtrLifecycleScanBucket(db, scan.scanBucket), true);
  const dashboard = await loadAtrLifecycleDashboard(db);
  assert.equal(dashboard.scanBucket, scan.scanBucket);
  assert.equal(dashboard.strong.filter((lifecycle) => ["BTCUSDT", "ETHUSDT"].includes(lifecycle.symbol)).length, 2);
});


function linearBars(step, count = 80) {
  return makeBars(Array.from({ length: count }, (_, i) => 100 + step * i));
}

test("splits current ATR persistence into mutually exclusive C5 C3 C1 and builds slope Focus Pool", async () => {
  const c5Bars = linearBars(1.0);
  const c3Bars = linearBars(0.6);
  const c1Bars = linearBars(0.3);
  const barsBySymbol = { C5USDT: c5Bars, C3USDT: c3Bars, C1USDT: c1Bars };
  const scan = await api().buildAtrLifecycleScan({
    listSymbols: async () => Object.keys(barsBySymbol),
    fetchClosedBars: async (symbol) => barsBySymbol[symbol],
    fetchClosedHourlyOi: async (symbol) => barsBySymbol[symbol].map((bar) => ({ timestamp: bar.closeTime, openInterest: 100 })),
  }, new Date("2026-09-01T07:10:00.000Z"), { multiplier: 1 });

  assert.deepEqual(scan.c5.map((row) => row.symbol), ["C5USDT"]);
  assert.deepEqual(scan.c3.map((row) => row.symbol), ["C3USDT"]);
  assert.deepEqual(scan.c1.map((row) => row.symbol), ["C1USDT"]);
  assert.equal(new Set(scan.cFocus.map((row) => row.symbol)).size, 3);
  assert.ok(scan.cFocus.every((row) => row.focusRank === 1));
});
