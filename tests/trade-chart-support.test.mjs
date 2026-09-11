import assert from "node:assert/strict";
import test from "node:test";

const { createPriceFormat, formatPrice, inferPriceStep } = await import("../app/trade/priceFormat.ts");
const { buildLifecycleChartSeries, buildTradeLifecycleLines } = await import("../app/trade/strategyMath.ts");
const { normalizeHorizontalStopLine } = await import("../lib/trade/horizontal-stop-line.ts");

test("价格格式从交易所步长推导精度并稳定展示", () => {
  assert.equal(inferPriceStep([0.012345, 0.012355], 0.00001), 0.00001);
  assert.deepEqual(createPriceFormat(0.00001), { type: "price", precision: 5, minMove: 0.00001 });
  assert.equal(formatPrice(0.01234567, 0.00001), "0.01235");
});

test("成交生命周期仅连接同一订单的开仓与平仓", () => {
  const bars = [
    { time: 1, open: 10, high: 11, low: 9, close: 10, volume: 1, closed: true },
    { time: 2, open: 11, high: 12, low: 10, close: 11, volume: 1, closed: true },
  ];
  const lifecycle = buildTradeLifecycleLines(bars, [
    { id: "entry", orderId: "strategy-1", time: 1, price: 10, quantity: 2, side: "BUY" },
    { id: "exit", orderId: "strategy-1", time: 2, price: 11, quantity: 2, side: "SELL" },
    { id: "unpaired", orderId: "strategy-2", time: 2, price: 12, quantity: 1, side: "BUY" },
  ]);
  assert.equal(lifecycle.length, 1);
  assert.equal(lifecycle[0].realizedPnl, 2);
  assert.deepEqual(buildLifecycleChartSeries(lifecycle)[0].entry, { time: 1, value: 10 });
});

test("人工水平止损线拒绝无效价格与触发方向", () => {
  assert.deepEqual(normalizeHorizontalStopLine({ price: 100, trigger: "BELOW" }), { price: 100, trigger: "BELOW" });
  assert.equal(normalizeHorizontalStopLine({ price: 0, trigger: "BELOW" }), null);
  assert.equal(normalizeHorizontalStopLine({ price: 100, trigger: "SIDEWAYS" }), null);
});
