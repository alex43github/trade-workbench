import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-quick-live-exits-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const { expandQuickLiveTemplate } = await import("../lib/trade/quick-live-template.ts");
const { evaluateQuickLiveExit } = await import("../lib/trade/quick-live-exits.ts");
const { createProtectionStrategy, getProtectionStrategy } = await import("../lib/trade/protection-strategies.ts");
const { runProtectionStrategyTick } = await import("../lib/trade/protection-executor.ts");

const market = {
  symbol: "BTCUSDT",
  closedCandle: {
    id: "source-candle",
    timeframe: "1h",
    maKind: "SMA",
    maLength: 30,
    atrLength: 14,
    ma: 100,
    atr: 10,
  },
};

function snapshot(templateId) {
  return expandQuickLiveTemplate({ symbol: "BTCUSDT", quickTemplateId: templateId }, { totalEquityUsdt: 400, market }).quickTemplateSnapshot;
}

function candle(id, values) {
  return { id, timeframe: "1h", close: 100, high: 110, low: 90, ...values };
}

test("balanced long counts independent closed-candle breaches and exits 50% then the rest", () => {
  const source = snapshot("BALANCED_LONG_1H");
  let state = {};

  const first = evaluateQuickLiveExit({ snapshot: source, candle: candle("long-breach-1", { close: 89 }), state });
  assert.equal(first.action, "PARTIAL_EXIT");
  assert.equal(first.exitPercent, 50);
  assert.equal(first.breachCount, 1);
  state = first.nextState;

  const recovery = evaluateQuickLiveExit({ snapshot: source, candle: candle("long-recovery", { close: 100 }), state });
  assert.equal(recovery.action, "NOOP");
  assert.equal(recovery.breachCount, 1);
  state = recovery.nextState;

  const second = evaluateQuickLiveExit({ snapshot: source, candle: candle("long-breach-2", { close: 89 }), state });
  assert.equal(second.action, "FULL_EXIT");
  assert.equal(second.exitPercent, 100);
  assert.equal(second.breachCount, 2);

  const duplicate = evaluateQuickLiveExit({ snapshot: source, candle: candle("long-breach-2", { close: 89 }), state: second.nextState });
  assert.equal(duplicate.action, "NOOP");
  assert.equal(duplicate.reason, "DUPLICATE_CANDLE");
  assert.equal(duplicate.breachCount, 2);
});

test("balanced short mirrors the independent breach rule", () => {
  const source = snapshot("BALANCED_SHORT_1H");
  let state = {};
  const first = evaluateQuickLiveExit({ snapshot: source, candle: candle("short-breach-1", { close: 111 }), state });
  assert.deepEqual({ action: first.action, exitPercent: first.exitPercent, breachCount: first.breachCount }, {
    action: "PARTIAL_EXIT", exitPercent: 50, breachCount: 1,
  });
  state = first.nextState;
  state = evaluateQuickLiveExit({ snapshot: source, candle: candle("short-recovery", { close: 100 }), state }).nextState;
  const second = evaluateQuickLiveExit({ snapshot: source, candle: candle("short-breach-2", { close: 111 }), state });
  assert.equal(second.action, "FULL_EXIT");
  assert.equal(second.breachCount, 2);
});

test("bull chase uses source levels for close stop and two touch targets", () => {
  const source = snapshot("BULL_CHASE_1H");
  const firstTarget = evaluateQuickLiveExit({
    snapshot: source,
    candle: candle("bull-target-1", { close: 130, high: 150 }),
  });
  assert.equal(firstTarget.action, "PARTIAL_EXIT");
  assert.equal(firstTarget.exitPercent, 50);
  assert.deepEqual(firstTarget.completedTargets, [5]);

  const secondTarget = evaluateQuickLiveExit({
    snapshot: source,
    candle: candle("bull-target-2", { close: 160, high: 170 }),
    state: firstTarget.nextState,
  });
  assert.equal(secondTarget.action, "FULL_EXIT");
  assert.equal(secondTarget.exitPercent, 100);
  assert.deepEqual(secondTarget.completedTargets, [5, 7]);

  const duplicate = evaluateQuickLiveExit({
    snapshot: source,
    candle: candle("bull-target-2", { close: 160, high: 170 }),
    state: secondTarget.nextState,
  });
  assert.equal(duplicate.action, "NOOP");
  assert.equal(duplicate.reason, "DUPLICATE_CANDLE");

  const stop = evaluateQuickLiveExit({ snapshot: source, candle: candle("bull-stop", { close: 124, high: 130 }) });
  assert.equal(stop.action, "FULL_EXIT");
  assert.equal(stop.reason, "STOP_CLOSE");
});

test("range short and range long use touch take-profits and closed-candle stops", () => {
  const short = snapshot("RANGE_SHORT_1H");
  const shortTakeProfit = evaluateQuickLiveExit({ snapshot: short, candle: candle("range-short-tp", { close: 70, low: 60 }) });
  assert.equal(shortTakeProfit.action, "FULL_EXIT");
  assert.equal(shortTakeProfit.reason, "TAKE_PROFIT_TOUCH");
  const shortStop = evaluateQuickLiveExit({ snapshot: short, candle: candle("range-short-sl", { close: 151, high: 155 }) });
  assert.equal(shortStop.action, "FULL_EXIT");
  assert.equal(shortStop.reason, "STOP_CLOSE");

  const long = snapshot("RANGE_LONG_1H");
  const longTakeProfit = evaluateQuickLiveExit({ snapshot: long, candle: candle("range-long-tp", { close: 130, high: 140 }) });
  assert.equal(longTakeProfit.action, "FULL_EXIT");
  assert.equal(longTakeProfit.reason, "TAKE_PROFIT_TOUCH");
  const longStop = evaluateQuickLiveExit({ snapshot: long, candle: candle("range-long-sl", { close: 49, low: 45 }) });
  assert.equal(longStop.action, "FULL_EXIT");
  assert.equal(longStop.reason, "STOP_CLOSE");
});

test("only a new completed 1h candle can change quick-exit state", () => {
  const source = snapshot("RANGE_LONG_1H");
  assert.throws(() => evaluateQuickLiveExit({ snapshot: source, candle: candle("open", { timeframe: "15m", high: 140 }) }), /1h/);
  const first = evaluateQuickLiveExit({ snapshot: source, candle: candle("touch", { high: 140 }) });
  const replay = evaluateQuickLiveExit({ snapshot: source, candle: candle("touch", { high: 140 }), state: first.nextState });
  assert.equal(replay.action, "NOOP");
  assert.deepEqual(replay.nextState, first.nextState);
});

test("quick protection persists the source snapshot and uses the existing reduce-only exit path", async () => {
  const env = {
    NODE_ENV: "test",
    BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
    BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
    BINANCE_GATEWAY_TRADING: "true",
    WORKBENCH_LIVE_TRADING_ENABLED: "true",
  };
  const filters = [
    { filterType: "PRICE_FILTER", tickSize: "0.1" },
    { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
    { filterType: "MIN_NOTIONAL", notional: "5" },
  ];
  const sourceSnapshot = snapshot("BALANCED_LONG_1H");
  const created = await createProtectionStrategy({
    env,
    origin: "WEB",
    source: {
      candidateId: "quick-source-1",
      symbol: "BTCUSDT",
      side: "LONG",
      quantity: 2,
      entryPrice: 100,
      markPrice: 100,
      leverage: 10,
      sourceOrderIds: ["webquick001"],
    },
    strategyType: "MA_SL",
    timeframe: "1h",
    marketConfig: { ma: { kind: "SMA", length: 30 }, atr: { length: 14 }, atrMultiplier: 1 },
    quickTemplateId: "BALANCED_LONG_1H",
    quickExitRule: "BALANCED_MA_1H",
    quickTemplateSnapshot: sourceSnapshot,
    idempotencyKey: "quick-exit-source-1",
  }, {
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: "2", markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
  });
  assert.equal(created.ok, true);
  assert.equal(created.strategy.config.quickTemplateSnapshot.ma, 100);
  assert.equal(created.strategy.quickBreachCount, 0);
  assert.deepEqual(created.strategy.quickProcessedCandleIds, []);

  let amount = 2;
  let currentCandle = candle("exec-breach-1", { close: 89 });
  const placed = [];
  const dependencies = {
    readMarket: async () => ({ closedCandle: currentCandle }),
    readPosition: async () => ({ symbol: "BTCUSDT", positionAmt: String(amount), markPrice: "100" }),
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    freezeLinkedEntries: async () => ({ frozen: true, reconciliationRequired: false }),
    placeOrder: async (order) => {
      placed.push(order);
      amount -= Number(order.quantity);
      return { orderId: `quick-exit-${placed.length}`, clientOrderId: order.newClientOrderId, status: "FILLED", executedQty: order.quantity };
    },
  };

  assert.equal((await runProtectionStrategyTick(created.strategy.id, dependencies)).action, "PARTIAL_EXIT");
  assert.equal(placed[0].reduceOnly, true);
  assert.equal(placed[0].workbenchOrderIntent, "EXIT_ONLY");
  assert.equal(placed[0].side, "SELL");
  assert.equal(placed[0].type, "MARKET");
  assert.equal(placed[0].stage, "QUICK_STOP_FIRST");
  let persisted = await getProtectionStrategy(created.strategy.id);
  assert.equal(persisted.quickBreachCount, 1);
  assert.deepEqual(persisted.quickProcessedCandleIds, ["exec-breach-1"]);

  currentCandle = candle("exec-recovery", { close: 100 });
  assert.equal((await runProtectionStrategyTick(created.strategy.id, dependencies)).action, "NOOP");
  currentCandle = candle("exec-breach-2", { close: 89 });
  assert.equal((await runProtectionStrategyTick(created.strategy.id, dependencies)).action, "FULL_EXIT");
  persisted = await getProtectionStrategy(created.strategy.id);
  assert.equal(persisted.quickBreachCount, 2);
  assert.equal(persisted.quickExitCompleted, true);
  assert.deepEqual(persisted.quickProcessedCandleIds, ["exec-breach-1", "exec-recovery", "exec-breach-2"]);
  assert.equal(placed.length, 2);
  assert.equal((await runProtectionStrategyTick(created.strategy.id, dependencies)).action, "NOOP");
  assert.equal(placed.length, 2);
});
