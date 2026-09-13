import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const terminalSource = await readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const atrBandRouteSource = await readFile(new URL("../app/api/radar/atr-band/route.ts", import.meta.url), "utf8");

test("交易页不会截断已保存的自选币", () => {
  assert.doesNotMatch(terminalSource, /options\.length \? options\.slice\(0, 12\)/);
  assert.doesNotMatch(terminalSource, /\[\.\.\.current, favorite\]\.slice\(0, 12\)/);
});

test("仅已完成的 MA30 ± 3ATR 小时扫描同步强势币到持久自选", () => {
  assert.match(atrBandRouteSource, /syncHourlyStrongWatchlist/);
  assert.match(atrBandRouteSource, /await syncHourlyStrongWatchlist\(db, scan\)/);
  assert.doesNotMatch(atrBandRouteSource, /syncHourlyStrongWatchlist\(db, dashboard\)/);
});
