import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const terminalSource = await readFile(new URL("app/trade/TradingTerminal.tsx", root), "utf8");
const paperRouteSource = await readFile(new URL("app/api/paper/route.ts", root), "utf8");
const paperSource = await readFile(new URL("lib/paper.ts", root), "utf8");

test("交易页不再轮询旧模拟盘，遗留模拟接口仍保留已收盘 K 线兼容字段", () => {
  assert.doesNotMatch(terminalSource, /lastPaperClosedCandleRef|PendingPaperClosedCandle|\/api\/paper|模拟盘/);
  assert.match(paperRouteSource, /close: url\.searchParams\.get\("closedCandleClose"\)/);
  assert.match(paperRouteSource, /timeframe: url\.searchParams\.get\("closedCandleTimeframe"\)/);
  assert.match(paperRouteSource, /maKind: url\.searchParams\.get\("closedCandleMaKind"\)/);
  assert.match(paperRouteSource, /maLength: url\.searchParams\.get\("closedCandleMaLength"\)/);
  assert.match(paperRouteSource, /atrLength: url\.searchParams\.get\("closedCandleAtrLength"\)/);
  assert.match(paperSource, /close\?: unknown;/);
  assert.match(paperSource, /timeframe\?: unknown;/);
  assert.match(paperSource, /maKind\?: unknown;/);
  assert.match(paperSource, /maLength\?: unknown;/);
  assert.match(paperSource, /atrLength\?: unknown;/);
  assert.match(paperSource, /const close = Number\(candidate\.close\);/);
  assert.match(paperSource, /const normalizedClose = Number\.isFinite\(close\) && close > 0 \? close : undefined;/);
  assert.match(paperSource, /\.\.\.\(normalizedClose === undefined \? \{\} : \{ close: normalizedClose \}\)/);
});

test("交易页图表仍以真实账户数据为唯一交易状态来源", () => {
  assert.match(terminalSource, /api\/account\?symbol=/);
  assert.match(terminalSource, /TradeChart bars=\{bars\} fills=\{account\.fills\}/);
  assert.doesNotMatch(terminalSource, /setPaper|paperRevision|accountView/);
});
