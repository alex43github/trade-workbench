import assert from "node:assert/strict";
import test from "node:test";
import { filterTradableFuturesSymbols } from "../lib/trade/symbols.ts";

test("market symbol discovery keeps every tradable USDT and USDC perpetual", async () => {
  const symbols = filterTradableFuturesSymbols({ symbols: [
    { symbol: "BTCUSDT", baseAsset: "BTC", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" },
    { symbol: "BTCUSDC", baseAsset: "BTC", quoteAsset: "USDC", status: "TRADING", contractType: "PERPETUAL" },
    { symbol: "AAPLUSDT", baseAsset: "AAPL", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" },
    { symbol: "ETHBUSD", baseAsset: "ETH", quoteAsset: "BUSD", status: "TRADING", contractType: "PERPETUAL" },
    { symbol: "ETHUSDC_260925", baseAsset: "ETH", quoteAsset: "USDC", status: "TRADING", contractType: "CURRENT_QUARTER" },
  ] });
  assert.deepEqual(symbols, [
    { symbol: "AAPLUSDT", displayName: "AAPL", quoteAsset: "USDT", contractType: "PERPETUAL" },
    { symbol: "BTCUSDC", displayName: "BTC", quoteAsset: "USDC", contractType: "PERPETUAL" },
    { symbol: "BTCUSDT", displayName: "BTC", quoteAsset: "USDT", contractType: "PERPETUAL" },
  ]);
});

test("market symbol discovery filters by base symbol and quote asset", async () => {
  const symbols = filterTradableFuturesSymbols({ symbols: [
    { symbol: "BTCUSDC", baseAsset: "BTC", quoteAsset: "USDC", status: "TRADING", contractType: "PERPETUAL" },
    { symbol: "AAPLUSDT", baseAsset: "AAPL", quoteAsset: "USDT", status: "TRADING", contractType: "PERPETUAL" },
  ] }, "USDC");
  assert.deepEqual(symbols.map((item) => item.symbol), ["BTCUSDC"]);
});
