import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { normalizeIndicatorSettings } from "../lib/trade/indicator-settings.ts";

const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const chartSource = fs.readFileSync(new URL("../app/trade/TradeChart.tsx", import.meta.url), "utf8");

test("indicator settings normalize per-symbol ATR values and line styles", () => {
  const settings = normalizeIndicatorSettings("cotiusdt", {
    basis: "ema",
    maLength: 55,
    entryAtrUpper: 1.75,
    entryAtrLower: 0.6,
    trendAtrEnabled: true,
    trendAtrMultiplier: 3,
    atr: { upperColor: "#12ABCD", lowerColor: "#345678", upperLineWidth: 4, lowerLineWidth: 2 },
  });
  assert.deepEqual(settings, {
    symbol: "COTIUSDT",
    basis: "ema",
    maLength: 55,
    entryAtrUpper: 1.75,
    entryAtrLower: 0.6,
    trendAtrEnabled: true,
    trendAtrMultiplier: 3,
    atr: { upperColor: "#12abcd", lowerColor: "#345678", upperLineWidth: 4, lowerLineWidth: 2 },
    vegas: { enabled: true, fastLength: 144, slowLength: 169, outerFastLength: 576, outerSlowLength: 676, firstColor: "#f59e0b", secondColor: "#ec4899", lineWidth: 2 },
  });
});

test("invalid values fall back safely and invalid symbols are rejected", () => {
  const settings = normalizeIndicatorSettings("COTIUSDT", {
    maLength: 9999,
    entryAtrUpper: -3,
    entryAtrLower: "not-a-number",
    atr: { upperColor: "red", lowerColor: "#123", upperLineWidth: 99, lowerLineWidth: 0 },
  });
  assert.equal(settings?.maLength, 500);
  assert.equal(settings?.entryAtrUpper, 0);
  assert.equal(settings?.entryAtrLower, 1);
 assert.deepEqual(settings?.atr, { upperColor: "#111827", lowerColor: "#111827", upperLineWidth: 4, lowerLineWidth: 1 });
  assert.deepEqual(settings?.vegas, { enabled: true, fastLength: 144, slowLength: 169, outerFastLength: 576, outerSlowLength: 676, firstColor: "#f59e0b", secondColor: "#ec4899", lineWidth: 2 });
 assert.equal(normalizeIndicatorSettings("BTC", {}), null);
});

test("trade UI persists ATR settings and applies custom line styles", () => {
  assert.match(terminalSource, /api\/trade\/indicator-settings/);
  assert.match(terminalSource, /ATR上方线颜色/);
  assert.match(terminalSource, /趋势 ATR/);
  assert.match(terminalSource, /trendAtrMultiplier/);
  assert.match(terminalSource, /ATR下方线粗细/);
  assert.match(chartSource, /indicators\.atr\.upperColor/);
  assert.match(chartSource, /indicators\.atr\.lowerLineWidth/);
  assert.match(chartSource, /trendAtrEnabled/);
  for (const line of ["vegas144", "vegas169", "vegas576", "vegas676"]) assert.match(chartSource, new RegExp(line));
  assert.match(terminalSource, /EMA144\/EMA169/);
  assert.match(terminalSource, /limit=1000/);
});
