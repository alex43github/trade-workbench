import assert from "node:assert/strict";
import test from "node:test";

const math = () => import("../lib/trade/protection-math.ts");

test("computes long and short ROI trigger prices from entry and leverage", async () => {
  const { computeRoiTriggerPrice } = await math();
  assert.equal(computeRoiTriggerPrice({ side: "LONG", entryPrice: 100, leverage: 10, roiPct: 100, tickSize: 0.1 }), 110);
  assert.equal(computeRoiTriggerPrice({ side: "SHORT", entryPrice: 100, leverage: 10, roiPct: 200, tickSize: 0.1 }), 80);
});

test("rounds ROI trigger prices to tick size without crossing the profitable side", async () => {
  const { computeRoiTriggerPrice } = await math();
  assert.equal(computeRoiTriggerPrice({ side: "LONG", entryPrice: 100, leverage: 3, roiPct: 100, tickSize: 0.5 }), 133.5);
  assert.equal(computeRoiTriggerPrice({ side: "SHORT", entryPrice: 100, leverage: 3, roiPct: 100, tickSize: 0.5 }), 66.5);
});

test("calculates source-bound exit quantities by percentage and step size", async () => {
  const { sourceExitQuantity } = await math();
  assert.equal(sourceExitQuantity({ initialQuantity: 4, remainingQuantity: 4, percent: 25, stepSize: 0.01 }), 1);
  assert.equal(sourceExitQuantity({ initialQuantity: 4, remainingQuantity: 1.04, percent: 40, stepSize: 0.01 }), 1.04);
  assert.equal(sourceExitQuantity({ initialQuantity: 0.009, remainingQuantity: 0.009, percent: 50, stepSize: 0.001 }), 0.004);
});

test("validates fixed take-profit and support/resistance stop directions", async () => {
  const { validateFixedProtectionPrice } = await math();
  assert.doesNotThrow(() => validateFixedProtectionPrice({ side: "LONG", kind: "TP", price: 110, referencePrice: 100 }));
  assert.doesNotThrow(() => validateFixedProtectionPrice({ side: "SHORT", kind: "TP", price: 90, referencePrice: 100 }));
  assert.doesNotThrow(() => validateFixedProtectionPrice({ side: "LONG", kind: "SL", price: 90, referencePrice: 100 }));
  assert.doesNotThrow(() => validateFixedProtectionPrice({ side: "SHORT", kind: "SL", price: 110, referencePrice: 100 }));
  assert.throws(() => validateFixedProtectionPrice({ side: "LONG", kind: "TP", price: 90, referencePrice: 100 }), /盈利方向/);
  assert.throws(() => validateFixedProtectionPrice({ side: "SHORT", kind: "SL", price: 90, referencePrice: 100 }), /止损方向/);
});

test("uses the correct source prefix for every new protection client order id", async () => {
  const { nextProtectionClientOrderId } = await math();
  assert.match(nextProtectionClientOrderId({ origin: "ALEX", kind: "TP", sequence: 12 }), /^alexTP00000012$/);
  assert.match(nextProtectionClientOrderId({ origin: "TELEGRAM", kind: "SL", sequence: 13 }), /^teleSL00000013$/);
  assert.match(nextProtectionClientOrderId({ origin: "WEB", kind: "TP", sequence: 14 }), /^webTP00000014$/);
});
