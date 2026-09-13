import assert from "node:assert/strict";
import test from "node:test";
import * as strategyMath from "../app/trade/strategyMath.ts";

const bars = [
  { time: 100, open: 98, high: 106, low: 96, close: 102, volume: 1, closed: true },
  { time: 200, open: 102, high: 112, low: 100, close: 108, volume: 1, closed: true },
  { time: 300, open: 108, high: 116, low: 106, close: 112, volume: 1, closed: true },
];

test("成交标记使用买入绿、卖出红、平仓黄，并缩小到轻量尺寸", () => {
  const markers = strategyMath.buildFillMarkers(bars, [
    { id: "buy", time: 110, price: 100, side: "BUY", role: "ENTRY" },
    { id: "sell", time: 210, price: 109, side: "SELL", role: "ENTRY" },
    { id: "close", time: 310, price: 111, side: "SELL", role: "EXIT" },
    { id: "hedge-close", time: 320, price: 112, side: "BUY", role: "EXIT" },
  ]);

  assert.deepEqual(markers.map(({ id, color, size }) => ({ id, color, size })), [
    { id: "buy", color: "#16a34a", size: 1 },
    { id: "sell", color: "#dc2626", size: 1 },
    { id: "close", color: "#eab308", size: 1 },
    { id: "hedge-close", color: "#eab308", size: 1 },
  ]);
});

test("同一 TW-L-S 策略跨重挂代次按成交数量加权生成完整生命周期线", () => {
  assert.equal(typeof strategyMath.buildTradeLifecycleLines, "function");
  const fills = [
    { id: "entry-g1", orderId: "entry-order-g1", orderGroupId: "TW-L-S-42", time: 110, price: 100, quantity: 1, side: "BUY", role: "ENTRY" },
    { id: "entry-g2", orderId: "entry-order-g2", orderGroupId: "TW-L-S-42", time: 120, price: 106, quantity: 3, side: "BUY", role: "ENTRY" },
    { id: "exit-g1", orderId: "exit-order-g1", orderGroupId: "TW-L-S-42", time: 210, price: 104, quantity: 1, side: "SELL", role: "EXIT", realizedPnl: 4 },
    { id: "exit-g2", orderId: "exit-order-g2", orderGroupId: "TW-L-S-42", time: 310, price: 110, quantity: 3, side: "SELL", role: "EXIT", realizedPnl: 12 },
  ];

  const lines = strategyMath.buildTradeLifecycleLines(bars, fills);
  assert.deepEqual(lines, [{
    id: "TW-L-S-42",
    entryTime: 100,
    entryPrice: 104.5,
    exitTime: 300,
    exitPrice: 108.5,
    entryQuantity: 4,
    exitQuantity: 4,
    realizedPnl: 16,
    returnPct: 3.83,
    outcomeColor: "#16a34a",
  }]);
});

test("部分平仓不提前绘制完整订单曲线", () => {
  const lines = strategyMath.buildTradeLifecycleLines(bars, [
    { id: "entry", orderId: "entry-order", orderGroupId: "TW-L-S-43", time: 110, price: 100, quantity: 2, side: "BUY", role: "ENTRY" },
    { id: "partial-exit", orderId: "exit-order", orderGroupId: "TW-L-S-43", time: 210, price: 108, quantity: 1, side: "SELL", role: "EXIT" },
  ]);

  assert.deepEqual(lines, []);
});

test("非策略或缺少 TW-L-S 归属证据的成交不生成生命周期线", () => {
  const lines = strategyMath.buildTradeLifecycleLines(bars, [
    { id: "manual-entry", orderId: "manual-entry-order", orderGroupId: "order:11", time: 110, price: 100, quantity: 1, side: "BUY", role: "ENTRY" },
    { id: "manual-exit", orderId: "manual-exit-order", orderGroupId: "order:11", time: 210, price: 108, quantity: 1, side: "SELL", role: "EXIT", realizedPnl: 8 },
    { id: "unlinked-entry", orderId: "unlinked-entry-order", time: 120, price: 101, quantity: 1, side: "BUY", role: "ENTRY" },
    { id: "unlinked-exit", orderId: "unlinked-exit-order", time: 220, price: 107, quantity: 1, side: "SELL", role: "EXIT", realizedPnl: 6 },
  ]);

  assert.deepEqual(lines, []);
});

test("未关联策略时按历史订单元数据识别平仓", () => {
  const markers = strategyMath.buildFillMarkers(bars, [
    { id: "reduce-only", time: 210, price: 109, side: "SELL", reduceOnly: true },
    { id: "short-close", time: 310, price: 111, side: "BUY", positionSide: "SHORT", orderType: "LIMIT" },
  ]);

  assert.deepEqual(markers.map(({ id, color }) => ({ id, color })), [
    { id: "reduce-only", color: "#eab308" },
    { id: "short-close", color: "#eab308" },
  ]);
});
