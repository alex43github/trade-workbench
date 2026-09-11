import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("terminal persists and labels equity points per selected exchange", async () => {
  const [terminal, chart] = await Promise.all([
    readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/trade/EquityChart.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(terminal, /streetlight-equity-v1:BINANCE/);
  assert.match(terminal, /streetlight-equity-v1:BYBIT/);
  assert.match(terminal, /\{selectedExchange\} EQUITY/);
  assert.match(chart, /exchange: "BINANCE" \| "BYBIT"/);
});
