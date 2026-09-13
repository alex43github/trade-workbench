import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

const chartSource = fs.readFileSync(new URL("../app/trade/TradeChart.tsx", import.meta.url), "utf8");
const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const positionAnalysisSource = fs.readFileSync(new URL("../lib/trade/position-analysis.ts", import.meta.url), "utf8");

test("实时 K 线更新保留用户已经放大的可视范围", () => {
  assert.match(chartSource, /getVisibleLogicalRange\(\)/);
  assert.match(chartSource, /setVisibleLogicalRange\(/);
  assert.match(chartSource, /fitContent\(\)/);
  assert.match(chartSource, /visibleLogicalRange/);
});

test("切换周期时复用管理员成交与订单图层，不销毁图表序列", () => {
  assert.match(chartSource, /lifecycleLines: new Map\(\)/);
  assert.match(chartSource, /priceLines: new Map\(\)/);
  assert.doesNotMatch(chartSource, /lifecycleLines\.forEach\(\(line\) => refs\.chart\.removeSeries\(line\)\)/);
  assert.doesNotMatch(chartSource, /priceLines = overlays\.filter/);
});

test("切换周期更新多序列前先清除十字线，规避 Lightweight Charts 5.2.0 时间轴竞态", () => {
  const clearCrosshairIndex = chartSource.indexOf("refs.chart.clearCrosshairPosition()");
  const firstSeriesUpdateIndex = chartSource.indexOf("refs.candles.applyOptions({ priceFormat");

  assert.notEqual(clearCrosshairIndex, -1);
  assert.notEqual(firstSeriesUpdateIndex, -1);
  assert.ok(clearCrosshairIndex < firstSeriesUpdateIndex);
  assert.match(chartSource, /setHoverPrice\(null\);\s*setHoverCandle\(null\);/);
});

test("图表支持点击放置单根人工水平止损线", () => {
  assert.match(chartSource, /subscribeClick/);
  assert.match(chartSource, /coordinateToPrice/);
  assert.match(chartSource, /onManualLineChange/);
  assert.match(chartSource, /overlay\.kind === \"manual\"/);
  assert.match(terminalSource, /画横线/);
  assert.match(terminalSource, /跌破止损/);
  assert.match(terminalSource, /涨破止损/);
  assert.match(terminalSource, /清除/);
});

test("人工水平线会随持仓分析上下文传给 AI", () => {
  assert.match(positionAnalysisSource, /horizontalStopLine/);
  assert.match(terminalSource, /horizontalStopLine/);
  assert.match(terminalSource, /\/api\/trade\/position-analysis/);
});

test("人工水平线只接受正数价格和明确的突破方向", async () => {
  const { normalizeHorizontalStopLine, horizontalStopLineInstruction } = await import("../lib/trade/horizontal-stop-line.ts");
  const { normalizePositionContext } = await import("../lib/trade/position-analysis.ts");
  assert.deepEqual(normalizeHorizontalStopLine({ price: "100.5", trigger: "BELOW" }), { price: 100.5, trigger: "BELOW" });
  assert.equal(normalizeHorizontalStopLine({ price: 0, trigger: "BELOW" }), null);
  assert.equal(normalizeHorizontalStopLine({ price: 100, trigger: "SIDEWAYS" }), null);
  assert.match(horizontalStopLineInstruction({ price: 100.5, trigger: "BELOW" }), /跌破/);
  assert.deepEqual(normalizePositionContext({ source: "binance", side: "LONG", quantity: 1, entryPrice: 100, markPrice: 101, unrealizedPnl: 1, leverage: 10, horizontalStopLine: { price: 99, trigger: "BELOW" } })?.horizontalStopLine, { price: 99, trigger: "BELOW" });
});
