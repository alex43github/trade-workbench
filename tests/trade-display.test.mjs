import assert from "node:assert/strict";
import test from "node:test";
import { formatTradeNumber } from "../lib/trade/display-number.ts";
import { sumRealizedPnlBySymbol } from "../lib/trade/realized-pnl.ts";

test("formats MA and ATR values without floating-point noise", () => {
  assert.equal(formatTradeNumber("0.13513333333333327"), "0.135133");
  assert.equal(formatTradeNumber("0.001423939588208773"), "0.00142394");
  assert.equal(formatTradeNumber("123.456789"), "123.4568");
});

test("sums Binance realized PnL independently for each symbol", () => {
  const totals = sumRealizedPnlBySymbol([
    { symbol: "ENAUSDT", realizedPnl: "1.25" },
    { symbol: "ENAUSDT", realizedPnl: "-0.45" },
    { symbol: "BRUSDT", realizedPnl: "2.1" },
    { symbol: "BRUSDT", realizedPnl: "invalid" },
  ]);
  assert.equal(totals.get("ENAUSDT"), 0.8);
  assert.equal(totals.get("BRUSDT"), 2.1);
});
