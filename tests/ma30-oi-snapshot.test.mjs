import assert from "node:assert/strict";
import test from "node:test";
import { buildMa30OiSnapshot } from "../lib/radar/ma30-oi-snapshot.ts";

const flat = (value, count) => Array.from({ length: count }, () => value);

test("builds a ready snapshot with eligible candidates sorted by current OI", async () => {
  const snapshot = await buildMa30OiSnapshot({
    listSymbols: async () => ["AAAUSDT", "BBBUSDT"],
    fetchClosedHourlyCloses: async (symbol) => symbol === "AAAUSDT" ? [...flat(100, 30), ...flat(110, 7)] : [...flat(100, 30), 90, ...flat(110, 6)],
    fetchDailyOi: async () => [...flat(100, 10), 120],
    fetchCurrentOi: async (symbol) => symbol === "AAAUSDT" ? 500 : 800,
  }, new Date("2026-08-20T00:30:00.000Z"));

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(snapshot.candidates.map((item) => item.symbol), ["AAAUSDT"]);
  assert.equal(snapshot.candidates[0].consecutiveAboveMa, 7);
  assert.equal(snapshot.candidates[0].oiExpansionPct, 20);
});

test("marks a scan degraded when every symbol is missing required data", async () => {
  const snapshot = await buildMa30OiSnapshot({
    listSymbols: async () => ["AAAUSDT"],
    fetchClosedHourlyCloses: async () => flat(100, 12),
    fetchDailyOi: async () => flat(100, 10),
    fetchCurrentOi: async () => 100,
  }, new Date("2026-08-20T00:30:00.000Z"));

  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.candidates.length, 0);
  assert.match(snapshot.warning ?? "", /数据不足/);
});

test("only fetches current OI after price and historical OI filters pass", async () => {
  const currentOiSymbols = [];
  const snapshot = await buildMa30OiSnapshot({
    listSymbols: async () => ["FLATUSDT", "PASSUSDT"],
    fetchClosedHourlyCloses: async (symbol) => symbol === "FLATUSDT"
      ? flat(100, 37)
      : [...flat(100, 30), ...flat(110, 7)],
    fetchDailyOi: async () => [...flat(100, 10), 120],
    fetchCurrentOi: async (symbol) => {
      currentOiSymbols.push(symbol);
      return 800;
    },
  }, new Date("2026-08-20T00:30:00.000Z"));

  assert.equal(snapshot.status, "ready");
  assert.deepEqual(currentOiSymbols, ["PASSUSDT"]);
});

test("keeps the transport diagnosis when the symbol list request fails", async () => {
  const snapshot = await buildMa30OiSnapshot({
    listSymbols: async () => { throw Object.assign(new Error("Binance 公共行情不可达"), { status: 503, hint: "请检查服务器出口" }); },
    fetchClosedHourlyCloses: async () => [],
    fetchDailyOi: async () => [],
    fetchCurrentOi: async () => 0,
  }, new Date("2026-08-20T00:30:00.000Z"));

  assert.equal(snapshot.status, "degraded");
  assert.equal(snapshot.diagnostic?.code, "UPSTREAM_UNAVAILABLE");
  assert.equal(snapshot.diagnostic?.detail, "Binance 公共行情不可达：请检查服务器出口");
});

test("reports progress and uses the previous total when the list is not known yet", async () => {
  const updates = [];
  const snapshot = await buildMa30OiSnapshot({
    listSymbols: async () => ["AAAUSDT", "BBBUSDT"],
    fetchClosedHourlyCloses: async () => flat(100, 37),
    fetchDailyOi: async () => [...flat(100, 10), 120],
    fetchCurrentOi: async () => 100,
  }, new Date("2026-08-20T00:30:00.000Z"), {
    expectedTotalSymbols: 9,
    onProgress: (progress) => updates.push(progress),
  });

  assert.equal(updates[0].totalSymbols, 2);
  assert.equal(updates.at(-1).scannedSymbols, 2);
  assert.equal(updates.at(-1).remainingSymbols, 0);
  assert.equal(updates.at(-1).percent, 100);
  assert.equal(snapshot.progress.scannedSymbols, 2);
});
