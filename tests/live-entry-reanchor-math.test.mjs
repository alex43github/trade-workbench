import assert from "node:assert/strict";
import test from "node:test";

const math = () => import("../lib/trade/reanchor-math.ts");

test("uses the next closed 1h candle for a 1h MA entry refresh", async () => {
  const { isReanchorDue, refreshCadence } = await math();
  const anchor = 1_700_000_000_000;

  assert.equal(refreshCadence("15m"), 2);
  assert.equal(refreshCadence("1h"), 1);
  assert.equal(refreshCadence("4h"), 1);
  assert.equal(refreshCadence("1d"), 1);
  assert.equal(refreshCadence("5m"), null);

  assert.equal(isReanchorDue({ timeframe: "15m", anchorCandleOpenTime: anchor, latestClosedCandleOpenTime: anchor + 1_800_000 }), true);
  assert.equal(isReanchorDue({ timeframe: "1h", anchorCandleOpenTime: anchor, latestClosedCandleOpenTime: anchor + 3_600_000 }), true);
  assert.equal(isReanchorDue({ timeframe: "4h", anchorCandleOpenTime: anchor, latestClosedCandleOpenTime: anchor + 14_400_000 }), true);
  assert.equal(isReanchorDue({ timeframe: "1d", anchorCandleOpenTime: anchor, latestClosedCandleOpenTime: anchor + 86_400_000 }), true);
});

test("does not reanchor for duplicate, stale, unsupported, or not-yet-due candles", async () => {
  const { isReanchorDue } = await math();
  const anchor = 1_700_000_000_000;

  assert.equal(isReanchorDue({ timeframe: "1h", anchorCandleOpenTime: anchor, latestClosedCandleOpenTime: anchor }), false);
  assert.equal(isReanchorDue({ timeframe: "1h", anchorCandleOpenTime: anchor, latestClosedCandleOpenTime: anchor - 3_600_000 }), false);
  assert.equal(isReanchorDue({ timeframe: "5m", anchorCandleOpenTime: anchor, latestClosedCandleOpenTime: anchor + 3_600_000 }), false);
  assert.equal(isReanchorDue({ timeframe: "1h", anchorCandleOpenTime: anchor, latestClosedCandleOpenTime: anchor + 1_800_000 }), false);
});

test("does not treat a non-period-aligned candle timestamp as a due candle", async () => {
  const { isReanchorDue } = await math();
  const anchor = 1_700_000_000_000;

  assert.equal(isReanchorDue({
    timeframe: "1h",
    anchorCandleOpenTime: anchor,
    latestClosedCandleOpenTime: anchor + 7_200_001,
  }), false);
});

test("subtracts only the executed quantity from the target quantity", async () => {
  const { remainingTargetQuantity } = await math();

  assert.equal(remainingTargetQuantity({ targetQuantity: 10, executedQuantity: 2.75 }), 7.25);
});

test("preserves a decimal step at the remaining-quantity boundary", async () => {
  const { orderSignature, remainingTargetQuantity } = await math();

  const remaining = remainingTargetQuantity({ targetQuantity: 0.3, executedQuantity: 0.1 });
  assert.equal(remaining, 0.2);
  assert.equal(orderSignature({ side: "LONG", price: 100, quantity: remaining, tickSize: 0.01, stepSize: 0.01 }), "LONG|100|0.2");
});

test("treats multiple small decimal fills as the exact executed target", async () => {
  const { remainingTargetQuantity } = await math();

  const executed = [0.1, 0.1, 0.1].reduce((total, fill) => total + fill, 0);
  assert.equal(remainingTargetQuantity({ targetQuantity: 0.3, executedQuantity: executed }), 0);
});

test("reports executed quantity above target with a reconciliation error code", async () => {
  const { remainingTargetQuantity } = await math();

  assert.throws(
    () => remainingTargetQuantity({ targetQuantity: 0.3, executedQuantity: 0.31 }),
    (error) => error?.code === "EXECUTED_QUANTITY_EXCEEDS_TARGET" && /exceeds target quantity/.test(error.message),
  );
});

test("calculates a quantity-weighted average for unequal fills", async () => {
  const { weightedAverage } = await math();

  assert.equal(weightedAverage([
    { price: 100, quantity: 0.1 },
    { price: 110, quantity: 0.3 },
  ]), 107.5);
});

test("normalizes rounded price and quantity in LONG and SHORT order signatures", async () => {
  const { orderSignature } = await math();

  assert.equal(orderSignature({ side: "LONG", price: 100.04, quantity: 1.237, tickSize: 0.1, stepSize: 0.01 }), "LONG|100|1.23");
  assert.equal(orderSignature({ side: "SHORT", price: 99.96, quantity: 1.237, tickSize: 0.1, stepSize: 0.01 }), "SHORT|100|1.23");
});
