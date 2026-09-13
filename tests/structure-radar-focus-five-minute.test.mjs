import assert from "node:assert/strict";
import test from "node:test";
import { buildFocusFiveMinuteBatches, parseClosedFiveMinuteKlineEvent, fetchClosedFiveMinuteKlines, FocusFiveMinuteCache } from "../services/structure-radar/focus-five-minute.ts";

test("focus five-minute stream batches subscribe only requested symbols to kline_5m", () => {
  assert.deepEqual(buildFocusFiveMinuteBatches(["ENAUSDT", "LSKUSDT"], 1), [
    ["enausdt@kline_5m"], ["lskusdt@kline_5m"],
  ]);
});

test("parser accepts a closed 5m Binance kline and rejects open/non-5m events", () => {
  const closed = { data: { e: "kline", s: "ENAUSDT", k: { i: "5m", x: true, t: 1_700_000_000_000, o: "1", h: "1.2", l: "0.9", c: "1.1", v: "10" } } };
  const parsed = parseClosedFiveMinuteKlineEvent(closed);
  assert.equal(parsed?.symbol, "ENAUSDT");
  assert.equal(parsed?.bar.time, 1_700_000_000);
  assert.equal(parsed?.bar.close, 1.1);
  assert.equal(parseClosedFiveMinuteKlineEvent({ data: { ...closed.data, k: { ...closed.data.k, x: false } } }), null);
  assert.equal(parseClosedFiveMinuteKlineEvent({ data: { ...closed.data, k: { ...closed.data.k, i: "15m" } } }), null);
});

test("focus five-minute cache replaces, appends and deduplicates closed bars", () => {
  const cache = new FocusFiveMinuteCache({ maxBars: 3 });
  const bar = (time, close) => ({ time, open: close, high: close + 0.1, low: close - 0.1, close, volume: 1, closed: true });
  cache.replace("ENAUSDT", [bar(300, 1), bar(600, 2)]);
  assert.equal(cache.append("ENAUSDT", bar(900, 3)).status, "appended");
  assert.equal(cache.append("ENAUSDT", bar(900, 3)).status, "duplicate");
  assert.deepEqual(cache.get("ENAUSDT").map((item) => item.time), [300, 600, 900]);
  assert.equal(cache.append("ENAUSDT", bar(1500, 4)).status, "gap");
});

test("five-minute backfill requests Binance 5m klines and drops still-open rows", async () => {
  let requested = "";
  const now = 1_700_000_400_000;
  const row = (openMs, closeMs, close) => [openMs, String(close), String(close + 0.1), String(close - 0.1), String(close), "10", closeMs];
  const fetcher = async (input) => {
    requested = String(input);
    return new Response(JSON.stringify([
      row(1_700_000_000_000, 1_700_000_299_999, 1),
      row(1_700_000_300_000, 1_700_000_599_999, 2),
    ]), { status: 200, headers: { "content-type": "application/json" } });
  };
  const bars = await fetchClosedFiveMinuteKlines("enausdt", 240, fetcher, now);
  assert.match(requested, /interval=5m/);
  assert.match(requested, /symbol=ENAUSDT/);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].time, 1_700_000_000);
});
