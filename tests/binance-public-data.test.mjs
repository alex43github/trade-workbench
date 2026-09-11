import assert from "node:assert/strict";
import test from "node:test";
import { filterUsdtPerpetualSymbols, selectCompleteDailyOi } from "../lib/radar/binance-public.ts";

test("radar symbol discovery keeps only trading USDT perpetual contracts", () => {
  assert.deepEqual(filterUsdtPerpetualSymbols([
    { symbol: "BTCUSDT", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDT" },
    { symbol: "ETHUSDC", status: "TRADING", contractType: "PERPETUAL", quoteAsset: "USDC" },
    { symbol: "OLDUSDT", status: "BREAK", contractType: "PERPETUAL", quoteAsset: "USDT" },
    { symbol: "BTCUSDT_250627", status: "TRADING", contractType: "CURRENT_QUARTER", quoteAsset: "USDT" },
  ]), ["BTCUSDT"]);
});

test("uses only complete daily OI observations", () => {
  const now = new Date("2026-08-27T14:00:00.000Z");
  const rows = [
    { timestamp: Date.parse("2026-08-25T00:00:00.000Z"), sumOpenInterest: "100" },
    { timestamp: Date.parse("2026-08-26T00:00:00.000Z"), sumOpenInterest: "110" },
    { timestamp: Date.parse("2026-08-27T00:00:00.000Z"), sumOpenInterest: "120" },
  ];

  assert.deepEqual(selectCompleteDailyOi(rows, now), [100, 110]);
});
