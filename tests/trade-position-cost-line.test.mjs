import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const chartSource = fs.readFileSync(new URL("../app/trade/TradeChart.tsx", import.meta.url), "utf8");
const priceFormatSource = fs.readFileSync(new URL("../app/trade/priceFormat.ts", import.meta.url), "utf8");

test("交易终端提供独立的持仓成本显示开关", () => {
  assert.match(terminalSource, /持仓成本/);
  assert.match(terminalSource, /positionCost/);
  assert.match(terminalSource, /overlayVisibility\.positionCost/);
  assert.match(terminalSource, /account\.positions\.filter\(\(item\) => item\.symbol === symbol\)/);
});

test("持仓成本线使用黑色虚线并显示真实入场均价", () => {
  assert.match(terminalSource, /kind: "cost"/);
  assert.match(chartSource, /overlay\.kind === "cost"/);
  assert.match(chartSource, /#111827/);
  assert.match(chartSource, /lineStyle: LineStyle\.Dashed/);
  assert.match(terminalSource, /price: item\.entryPrice, kind: "cost"/);
});

test("图表使用币种自适应的价格精度和坐标轴简写", () => {
  assert.match(chartSource, /priceTickSize/);
  assert.match(chartSource, /priceFormat/);
  assert.match(chartSource, /createPriceFormat/);
  assert.match(priceFormatSource, /tickmarksFormatter/);
  assert.match(priceFormatSource, /formatPrice/);
});
