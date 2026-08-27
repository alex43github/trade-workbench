import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const terminalSource = await readFile(new URL("app/trade/TradingTerminal.tsx", root), "utf8");
const paperRouteSource = await readFile(new URL("app/api/paper/route.ts", root), "utf8");

test("交易页不再轮询模拟盘，模拟接口已退役", () => {
  assert.doesNotMatch(terminalSource, /lastPaperClosedCandleRef|PendingPaperClosedCandle|\/api\/paper|模拟盘/);
  assert.match(paperRouteSource, /paperSimulationRetired/);
});

test("交易页图表仍以真实账户数据为唯一交易状态来源", () => {
  assert.match(terminalSource, /api\/account\?symbol=/);
  assert.match(terminalSource, /TradeChart bars=\{bars\} fills=\{account\.fills\}/);
  assert.doesNotMatch(terminalSource, /setPaper|paperRevision|accountView/);
});
