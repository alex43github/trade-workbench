import assert from "node:assert/strict";
import test from "node:test";

const maConfig = { entryRefresh: "CLOSED_CANDLE" };
const horizontalConfig = { entryRefresh: "NONE" };

test("refreshes only fully unfilled MA legs after a genuinely new closed candle and only when rounded values changed", async () => {
  const { refreshUnfilledLegs } = await import("../lib/trade/strategy-lifecycle.ts");

  assert.deepEqual(refreshUnfilledLegs({
    config: maConfig,
    isNewClosedCandle: true,
    closedCandleId: "1h-42",
    tickSize: 0.1,
    ma: 100,
    atr: 10,
    legs: [
      { id: "unchanged", atrOffset: 1, marginUsdt: 110, stepSize: 0.01, requestedQuantity: 1, filledQuantity: 0, price: 110 },
      { id: "partial", atrOffset: 0, marginUsdt: 100, stepSize: 0.01, requestedQuantity: 1, filledQuantity: 0.2, price: 99.8 },
    ],
  }), []);

  assert.deepEqual(refreshUnfilledLegs({
    config: maConfig,
    isNewClosedCandle: true,
    closedCandleId: "1h-43",
    tickSize: 0.1,
    ma: 100.06,
    atr: 10,
    legs: [
      { id: "move", atrOffset: 1, marginUsdt: 110.1, stepSize: 0.01, requestedQuantity: 1, filledQuantity: 0, price: 110 },
      { id: "partial", atrOffset: 0, marginUsdt: 100, stepSize: 0.01, requestedQuantity: 1, filledQuantity: 0.2, price: 99.8 },
    ],
  }), [{ legId: "move", closedCandleId: "1h-43", price: 110.1, quantity: 1 }]);
});

test("never generates a moving price for horizontal entries", async () => {
  const { refreshUnfilledLegs } = await import("../lib/trade/strategy-lifecycle.ts");

  assert.deepEqual(refreshUnfilledLegs({
    config: horizontalConfig,
    isNewClosedCandle: true,
    closedCandleId: "1h-44",
    tickSize: 0.1,
    ma: 150,
    atr: 10,
    legs: [{ id: "static", atrOffset: 0, marginUsdt: 100, stepSize: 0.01, requestedQuantity: 1, filledQuantity: 0, price: 100 }],
  }), []);
});

test("skips MA refreshes without a new closed candle and for a duplicate candle ID", async () => {
  const { refreshUnfilledLegs } = await import("../lib/trade/strategy-lifecycle.ts");
  const input = {
    config: maConfig,
    closedCandleId: "1h-45",
    tickSize: 0.1,
    ma: 101,
    atr: 10,
    legs: [{ id: "unfilled", atrOffset: 1, marginUsdt: 111, stepSize: 0.01, requestedQuantity: 1, filledQuantity: 0, price: 110 }],
  };

  assert.deepEqual(refreshUnfilledLegs(input), []);
  assert.deepEqual(refreshUnfilledLegs({ ...input, isNewClosedCandle: false }), []);
  assert.deepEqual(refreshUnfilledLegs({ ...input, isNewClosedCandle: true, lastProcessedClosedCandleId: "1h-45" }), []);
});

test("refreshes when either rounded price or step-rounded quantity changes", async () => {
  const { refreshUnfilledLegs } = await import("../lib/trade/strategy-lifecycle.ts");

  assert.deepEqual(refreshUnfilledLegs({
    config: maConfig,
    isNewClosedCandle: true,
    closedCandleId: "1h-46",
    tickSize: 0.1,
    ma: 100.04,
    atr: 0,
    legs: [{ id: "quantity-only", atrOffset: 0, marginUsdt: 100, stepSize: 0.1, requestedQuantity: 0.9, filledQuantity: 0, price: 100 }],
  }), [{ legId: "quantity-only", closedCandleId: "1h-46", price: 100, quantity: 1 }]);
});

test("creates one independent profit lot for each newly filled quantity", async () => {
  const { createProfitLot } = await import("../lib/trade/strategy-lifecycle.ts");

  assert.deepEqual(createProfitLot({
    id: "lot-1",
    strategyId: "TW-S-1",
    legId: "leg-1",
    websiteOrderId: "TW-1",
    entryPrice: 25,
    filledQuantity: 4,
  }), {
    id: "lot-1",
    strategyId: "TW-S-1",
    legId: "leg-1",
    websiteOrderId: "TW-1",
    entryPrice: 25,
    initialQuantity: 4,
    initialNotional: 100,
    exitedQuantity: 0,
    realizedGrossPnl: 0,
    completedProfitTargets: [],
  });
});

test("creates distinct lots for separate fills on the same leg without sharing target state", async () => {
  const { createProfitLot, profitTargetState } = await import("../lib/trade/strategy-lifecycle.ts");
  const first = createProfitLot({
    id: "lot-first", strategyId: "TW-S-1", legId: "leg-1", websiteOrderId: "TW-1", entryPrice: 10, filledQuantity: 10,
  });
  const second = createProfitLot({
    id: "lot-second", strategyId: "TW-S-1", legId: "leg-1", websiteOrderId: "TW-1", entryPrice: 20, filledQuantity: 5,
  });

  assert.notEqual(first.id, second.id);
  assert.deepEqual(profitTargetState({ ...first, side: "LONG", markPrice: 20 }), { stage: 1, reduceQuantity: 2.5 });
  assert.equal(profitTargetState({ ...second, side: "LONG", markPrice: 20 }), null);
});

test("uses gross long and short lot PnL for one 25 percent then one 40 percent target", async () => {
  const { profitTargetState } = await import("../lib/trade/strategy-lifecycle.ts");

  assert.deepEqual(profitTargetState({
    side: "LONG",
    markPrice: 50,
    initialNotional: 100,
    entryPrice: 25,
    realizedGrossPnl: 0,
    initialQuantity: 4,
    exitedQuantity: 0,
    completedProfitTargets: [],
  }), { stage: 1, reduceQuantity: 1 });

  assert.deepEqual(profitTargetState({
    side: "SHORT",
    markPrice: 0,
    initialNotional: 100,
    entryPrice: 25,
    realizedGrossPnl: 0,
    initialQuantity: 4,
    exitedQuantity: 0,
    completedProfitTargets: [],
  }), { stage: 1, reduceQuantity: 1 });

  assert.deepEqual(profitTargetState({
    side: "LONG",
    markPrice: 100,
    initialNotional: 100,
    entryPrice: 25,
    realizedGrossPnl: 25,
    initialQuantity: 4,
    exitedQuantity: 1,
    completedProfitTargets: [1],
  }), { stage: 2, reduceQuantity: 1.6 });
});

test("triggers both long and short profit targets at exact 100 and 200 percent gross PnL boundaries", async () => {
  const { profitTargetState } = await import("../lib/trade/strategy-lifecycle.ts");
  const base = {
    initialNotional: 100,
    entryPrice: 25,
    initialQuantity: 4,
    exitedQuantity: 0,
    realizedGrossPnl: 0,
    completedProfitTargets: [],
  };

  assert.deepEqual(profitTargetState({ ...base, side: "LONG", markPrice: 50 }), { stage: 1, reduceQuantity: 1 });
  assert.deepEqual(profitTargetState({ ...base, side: "SHORT", markPrice: 0 }), { stage: 1, reduceQuantity: 1 });

  const secondStage = { ...base, exitedQuantity: 1, realizedGrossPnl: 50, completedProfitTargets: [1] };
  assert.deepEqual(profitTargetState({ ...secondStage, side: "LONG", markPrice: 75 }), { stage: 2, reduceQuantity: 1.6 });
  assert.deepEqual(profitTargetState({ ...secondStage, side: "SHORT", markPrice: 25, realizedGrossPnl: 200 }), { stage: 2, reduceQuantity: 1.6 });
});

test("does not backfill a completed profit lot and emits at most one target stage", async () => {
  const { profitTargetState } = await import("../lib/trade/strategy-lifecycle.ts");
  const completedFirstStage = {
    side: "LONG",
    markPrice: 100,
    initialNotional: 100,
    entryPrice: 25,
    realizedGrossPnl: 25,
    initialQuantity: 4,
    exitedQuantity: 1,
    completedProfitTargets: [1],
  };

  assert.deepEqual(profitTargetState(completedFirstStage), { stage: 2, reduceQuantity: 1.6 });
  assert.equal(profitTargetState({ ...completedFirstStage, completedProfitTargets: [1, 2], exitedQuantity: 2.6 }), null);
});

test("keeps partial exits live and cancels entries only after every lot has finally exited", async () => {
  const { canCancelRemainingEntries } = await import("../lib/trade/strategy-lifecycle.ts");

  assert.equal(canCancelRemainingEntries([]), false);
  assert.equal(canCancelRemainingEntries([{ initialQuantity: 1, exitedQuantity: 0.65 }]), false);
  assert.equal(canCancelRemainingEntries([{ initialQuantity: 1, exitedQuantity: 1 }, { initialQuantity: 2, exitedQuantity: 1.99 }]), false);
  assert.equal(canCancelRemainingEntries([{ initialQuantity: 1, exitedQuantity: 1 }, { initialQuantity: 2, exitedQuantity: 2 }]), true);
});

test("merges simultaneous guards by preserving only the smallest remaining target", async () => {
  const { mergeGuardTargetRemainingPct } = await import("../lib/trade/strategy-lifecycle.ts");

  assert.equal(mergeGuardTargetRemainingPct([]), null);
  assert.equal(mergeGuardTargetRemainingPct([50, 50]), 50);
  assert.equal(mergeGuardTargetRemainingPct([50, 0, null]), 0);
});
