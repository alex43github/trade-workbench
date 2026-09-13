import assert from "node:assert/strict";
import test from "node:test";
import { refreshFocusPool } from "../services/structure-radar/focus-refresh.ts";

function repository(initial = []) {
  let values = structuredClone(initial);
  return {
    api: {
      listFocus: async () => structuredClone(values),
      saveFocus: async (record) => {
        const index = values.findIndex((item) => item.symbol === record.symbol);
        if (index >= 0) values[index] = structuredClone(record);
        else values.push(structuredClone(record));
      },
      deleteFocus: async (symbol) => { values = values.filter((item) => item.symbol !== symbol); },
    },
    values: () => values,
  };
}

test("refresh unions hourly trend, squeeze, positions and watchlist into canonical focus records", async () => {
  const store = repository();
  const result = await refreshFocusPool({
    repository: store.api,
    trends: [{ symbol: "ENAUSDT", stage: "ACTIONABLE", score: 88, signalState: "CONFIRMED" }],
    squeezes: [{ symbol: "ENAUSDT", stage: "SQUEEZE_ACTIVE", direction: "SHORT_SQUEEZE_LONG_BIAS" }],
    positions: [{ symbol: "ENAUSDT", quantity: 12 }, { symbol: "BTCUSDT", quantity: 0.01 }],
    watchlistSymbols: ["LSKUSDT"],
    now: "2026-09-13T10:00:00.000Z",
  });
  assert.deepEqual(result.map((item) => item.symbol).sort(), ["BTCUSDT", "ENAUSDT", "LSKUSDT"]);
  const ena = result.find((item) => item.symbol === "ENAUSDT");
  assert.deepEqual(ena.classifications, ["STRONG_TREND", "SHORT_SQUEEZE"]);
  assert.equal(ena.bias, "LONG");
  assert.ok(ena.sources.includes("HOURLY_TREND"));
  assert.ok(ena.sources.includes("HOURLY_SQUEEZE"));
  assert.ok(ena.sources.includes("POSITION"));
  assert.ok(ena.sources.includes("STICKY_72H"));
  assert.equal(result.find((item) => item.symbol === "BTCUSDT").bias, "UNKNOWN");
  assert.equal(result.find((item) => item.symbol === "LSKUSDT").bias, "UNKNOWN");
});

test("conflicting current trend and squeeze directions become NEUTRAL rather than inheriting stale LONG bias", async () => {
  const store = repository();
  await refreshFocusPool({
    repository: store.api,
    trends: [{ symbol: "ENAUSDT", stage: "ACTIONABLE", score: 90, signalState: "CONFIRMED" }],
    squeezes: [], positions: [], watchlistSymbols: [], now: "2026-09-13T10:00:00.000Z",
  });
  const result = await refreshFocusPool({
    repository: store.api,
    trends: [{ symbol: "ENAUSDT", stage: "ACTIONABLE", score: 90, signalState: "CONFIRMED" }],
    squeezes: [{ symbol: "ENAUSDT", stage: "ACTIONABLE", direction: "LONG_SQUEEZE_SHORT_BIAS" }],
    positions: [], watchlistSymbols: [], now: "2026-09-13T11:00:00.000Z",
  });
  assert.equal(result[0].bias, "NEUTRAL");
});

test("expired sticky-only records are removed when no live source remains", async () => {
  const store = repository();
  await refreshFocusPool({
    repository: store.api,
    trends: [{ symbol: "ENAUSDT", stage: "ACTIONABLE", score: 90, signalState: "CONFIRMED" }],
    squeezes: [], positions: [], watchlistSymbols: [], now: "2026-09-10T00:00:00.000Z",
  });
  const result = await refreshFocusPool({
    repository: store.api, trends: [], squeezes: [], positions: [], watchlistSymbols: [], now: "2026-09-13T00:00:01.000Z",
  });
  assert.equal(result.length, 0);
});
