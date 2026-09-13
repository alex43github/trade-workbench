import assert from "node:assert/strict";
import test from "node:test";
import { createPriceFormat, decimalPlacesForStep, formatPrice, inferPriceStep, resolvePriceTickSize } from "../app/trade/priceFormat.ts";

test("根据 K 线精度推导 KOMA 的最小价格步长", () => {
  assert.equal(inferPriceStep([0.014238, 0.0142, 0.014301]), 0.000001);
  assert.equal(formatPrice(0.014238, 0.000001), "0.014238");
});

test("币安 exchangeInfo 的 tickSize 优先于被四舍五入的 K 线数据", () => {
  assert.equal(inferPriceStep([0.01, 0.02, 0.03], 0.000001), 0.000001);
  assert.equal(decimalPlacesForStep(0.000001), 6);
  assert.equal(formatPrice(0.014238, 0.000001), "0.014238");
});

test("从币安 PRICE_FILTER 读取对应合约的价格步长", () => {
  assert.equal(resolvePriceTickSize({ symbols: [{ symbol: "KOMAUSDT", filters: [{ filterType: "PRICE_FILTER", tickSize: "0.000001" }] }] }, "KOMAUSDT"), 0.000001);
  assert.equal(resolvePriceTickSize({ symbols: [{ symbol: "BTCUSDT", filters: [{ filterType: "LOT_SIZE", stepSize: "0.001" }] }] }, "KOMAUSDT"), null);
  assert.equal(resolvePriceTickSize({ symbols: "invalid" }, "KOMAUSDT"), null);
});

test("没有价格数据时使用安全的默认步长", () => {
  assert.equal(inferPriceStep([]), 0.01);
});

test("极小价格只在坐标轴标签中使用科学计数法，详情值保留完整精度", () => {
  assert.equal(formatPrice(0.0000001234, 0.0000000001), "0.0000001234");
  assert.equal(formatPrice(0.0000001234, 0.0000000001, "axis"), "1.234e-7");
  assert.equal(createPriceFormat(0.0000000001).formatter(0.0000001234), "1.234e-7");
});
