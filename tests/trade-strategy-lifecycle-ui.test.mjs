import assert from "node:assert/strict";
import test from "node:test";
import * as strategyMath from "../app/trade/strategyMath.ts";

const bars = [
  { time: 1_700_000_000, open: 98, high: 112, low: 96, close: 108, volume: 1, closed: true },
];

test("同一根 K 线内完成的订单不伪造生命周期连线", () => {
  assert.equal(typeof strategyMath.buildLifecycleChartSeries, "function");
  const lifecycleLines = strategyMath.buildTradeLifecycleLines(bars, [
    { id: "entry", orderGroupId: "TW-L-S-same-second", time: 1_700_000_000_125, price: 100, quantity: 1, side: "BUY", role: "ENTRY" },
    { id: "exit", orderGroupId: "TW-L-S-same-second", time: 1_700_000_000_875, price: 108, quantity: 1, side: "SELL", role: "EXIT", realizedPnl: 8 },
  ]);

  assert.deepEqual(strategyMath.buildLifecycleChartSeries(lifecycleLines), []);
});

test("真实退出时间早于入场时拒绝生命周期图表数据", () => {
  assert.deepEqual(strategyMath.buildLifecycleChartSeries([{
    id: "TW-L-S-reversed",
    entryTime: 200,
    entryPrice: 100,
    exitTime: 199,
    exitPrice: 99,
    entryQuantity: 1,
    exitQuantity: 1,
    realizedPnl: -1,
    returnPct: -1,
    outcomeColor: "#dc2626",
  }]), []);
});

test("生命周期连线只使用当前周期实际存在的 K 线时间", () => {
  const lifecycleLines = strategyMath.buildTradeLifecycleLines([
    { time: 100, open: 98, high: 105, low: 96, close: 102, volume: 1, closed: true },
    { time: 200, open: 102, high: 110, low: 100, close: 108, volume: 1, closed: true },
    { time: 300, open: 108, high: 115, low: 106, close: 112, volume: 1, closed: true },
  ], [
    { id: "entry", orderGroupId: "TW-L-S-chart-times", time: 110, price: 100, quantity: 1, side: "BUY", role: "ENTRY" },
    { id: "exit", orderGroupId: "TW-L-S-chart-times", time: 310, price: 110, quantity: 1, side: "SELL", role: "EXIT", realizedPnl: 10 },
  ]);

  assert.deepEqual(strategyMath.buildLifecycleChartSeries(lifecycleLines), [{
    id: "TW-L-S-chart-times",
    color: "#16a34a",
    entry: { time: 100, value: 100 },
    exit: { time: 300, value: 110 },
  }]);
});
