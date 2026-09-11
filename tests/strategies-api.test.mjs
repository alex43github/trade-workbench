import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.STREETLIGHT_LOCAL_D1 = path.join(os.tmpdir(), `streetlight-strategies-${process.pid}-${Date.now()}.sqlite`);
delete process.env.STREETLIGHT_LOCAL_TEST_MODE;

const validDraft = {
  symbol: "AKEUSDT", side: "LONG", timeframe: "1h", style: "MA", totalMarginUsdt: 90,
  ma: { kind: "SMA", length: 30 }, atr: { length: 14 },
  legs: [{ atrOffset: 1 }, { atrOffset: 0 }, { atrOffset: -1 }],
  execution: "LIMIT_POST_ONLY", refreshOn: "CLOSED_CANDLE", expiryDays: 7,
};

function closedCandle({
  id,
  close,
  ma = 100,
  atr = 10,
  timeframe = "1h",
  maKind = "SMA",
  maLength = 30,
  atrLength = 14,
} = {}) {
  return {
    id,
    isNewClosedCandle: true,
    close,
    ma,
    atr,
    timeframe,
    maKind,
    maLength,
    atrLength,
    tickSize: 0.01,
    stepSize: 0.00000001,
  };
}

test("entry fills are source-idempotent and retain both concurrent quantities", async () => {
  const { createStrategy, getStrategy, recordEntryFill } = await import("../lib/trade/strategies.ts");
  const strategy = await createStrategy({ ...validDraft, idempotencyKey: "strategy-fill-cas-1" });
  const leg = strategy.legs[0];

  const [first, second] = await Promise.all([
    recordEntryFill(strategy.id, { legId: leg.id, quantity: 0.2, price: 100, sourceFillId: "reconcile-fill-a" }),
    recordEntryFill(strategy.id, { legId: leg.id, quantity: 0.3, price: 101, sourceFillId: "reconcile-fill-b" }),
  ]);
  const duplicate = await recordEntryFill(strategy.id, { legId: leg.id, quantity: 0.2, price: 100, sourceFillId: "reconcile-fill-a" });

  const persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.legs.find((candidate) => candidate.id === leg.id)?.filledQuantity, 0.5);
  assert.equal(persisted?.lots.length, 2);
  assert.equal(duplicate.id, first.id);
  assert.notEqual(first.id, second.id);
});

test("cancellation atomically stops pending legs and rejects later refreshes or entry fills", async () => {
  const { cancelStrategy, createStrategy, getStrategy, recordEntryFill, recordRefresh } = await import("../lib/trade/strategies.ts");
  const strategy = await createStrategy({ ...validDraft, idempotencyKey: "strategy-cancel-1" });
  const [firstLeg, secondLeg] = strategy.legs;
  const lot = await recordEntryFill(strategy.id, { legId: firstLeg.id, quantity: 0.1, price: 100, sourceFillId: "before-cancel" });
  await cancelStrategy(strategy.id, "USER_REQUEST");

  const canceled = await getStrategy(strategy.id);
  assert.equal(canceled?.legs.every((leg) => leg.status === "CANCELED"), true);
  assert.equal(canceled?.lots.some((candidate) => candidate.id === lot.id), true);
  await assert.rejects(() => recordRefresh(strategy.id, { legId: secondLeg.id, closedCandleId: "1h:43", price: 98, requestedQuantity: 0.3 }), /策略不可刷新/);
  await assert.rejects(() => recordEntryFill(strategy.id, { legId: firstLeg.id, quantity: 0.1, price: 100, sourceFillId: "after-cancel" }), /策略不可成交/);
});

test("entry fills reject expired and closed strategies", async () => {
  const { createStrategy, getStrategy, recordEntryFill } = await import("../lib/trade/strategies.ts");
  const { getD1 } = await import("../db/index.ts");
  const expired = await createStrategy({ ...validDraft, idempotencyKey: "strategy-expired-1" });
  const closed = await createStrategy({ ...validDraft, idempotencyKey: "strategy-closed-1" });
  const db = await getD1();
  await db.batch([
    db.prepare("UPDATE trade_strategies SET status = 'EXPIRED' WHERE id = ?").bind(expired.id),
    db.prepare("UPDATE trade_strategies SET status = 'CLOSED' WHERE id = ?").bind(closed.id),
  ]);

  await assert.rejects(() => recordEntryFill(expired.id, { legId: expired.legs[0].id, quantity: 0.1, price: 100, sourceFillId: "after-expiry" }), /策略不可成交/);
  await assert.rejects(() => recordEntryFill(closed.id, { legId: closed.legs[0].id, quantity: 0.1, price: 100, sourceFillId: "after-close" }), /策略不可成交/);
  assert.equal((await getStrategy(expired.id))?.lots.length, 0);
});

test("concurrent lot exits preserve all quantity and realized profit", async () => {
  const { createStrategy, getStrategy, recordEntryFill, recordLotExit } = await import("../lib/trade/strategies.ts");
  const strategy = await createStrategy({ ...validDraft, idempotencyKey: "strategy-lot-cas-1" });
  const lot = await recordEntryFill(strategy.id, { legId: strategy.legs[0].id, quantity: 0.8, price: 100, sourceFillId: "lot-cas-fill" });

  await Promise.all([
    recordLotExit(strategy.id, { lotId: lot.id, quantity: 0.3, realizedGrossPnl: 30, sourceExitId: "lot-cas-exit-a" }),
    recordLotExit(strategy.id, { lotId: lot.id, quantity: 0.4, realizedGrossPnl: 40, sourceExitId: "lot-cas-exit-b" }),
  ]);

  const persisted = await getStrategy(strategy.id);
  const exited = persisted?.lots.find((candidate) => candidate.id === lot.id);
  assert.equal(exited?.exitedQuantity, 0.7);
  assert.equal(exited?.realizedGrossPnl, 70);
});

test("expired entry and refresh actions atomically expire the strategy and cancel unfinished legs", async () => {
  const { createStrategy, getStrategy, recordEntryFill, recordRefresh } = await import("../lib/trade/strategies.ts");
  const { getD1 } = await import("../db/index.ts");
  const entryStrategy = await createStrategy({ ...validDraft, idempotencyKey: "strategy-expire-entry-1" });
  const refreshStrategy = await createStrategy({ ...validDraft, idempotencyKey: "strategy-expire-refresh-1" });
  const db = await getD1();
  await db.batch([
    db.prepare("UPDATE trade_strategies SET expires_at = '1970-01-01 00:00:00' WHERE id = ?").bind(entryStrategy.id),
    db.prepare("UPDATE trade_strategies SET expires_at = '1970-01-01 00:00:00' WHERE id = ?").bind(refreshStrategy.id),
  ]);

  await assert.rejects(() => recordEntryFill(entryStrategy.id, {
    legId: entryStrategy.legs[0].id, quantity: 0.1, price: 100, sourceFillId: "after-runtime-expiry-fill",
  }), /策略不可成交/);
  await assert.rejects(() => recordRefresh(refreshStrategy.id, {
    legId: refreshStrategy.legs[0].id, closedCandleId: "1h:expired", price: 99, requestedQuantity: 0.3,
  }), /策略不可刷新/);

  for (const strategyId of [entryStrategy.id, refreshStrategy.id]) {
    const persisted = await getStrategy(strategyId);
    assert.equal(persisted?.status, "EXPIRED");
    assert.equal(persisted?.legs.every((leg) => leg.status === "CANCELED"), true);
    assert.equal(persisted?.events.filter((event) => event.type === "EXPIRED").length, 1);
  }
});

test("lot exits are source-idempotent and reject a new exit after the lot is closed", async () => {
  const { createStrategy, getStrategy, recordEntryFill, recordLotExit } = await import("../lib/trade/strategies.ts");
  const strategy = await createStrategy({ ...validDraft, idempotencyKey: "strategy-exit-idempotency-1" });
  const lot = await recordEntryFill(strategy.id, {
    legId: strategy.legs[0].id, quantity: 0.5, price: 100, sourceFillId: "exit-idempotency-fill",
  });
  await recordLotExit(strategy.id, {
    lotId: lot.id, quantity: 0.5, realizedGrossPnl: 50, sourceExitId: "exit-idempotency-1",
  });
  await recordLotExit(strategy.id, {
    lotId: lot.id, quantity: 0.1, realizedGrossPnl: 999, sourceExitId: "exit-idempotency-1",
  });

  const afterDuplicate = await getStrategy(strategy.id);
  const exited = afterDuplicate?.lots.find((candidate) => candidate.id === lot.id);
  assert.equal(exited?.exitedQuantity, 0.5);
  assert.equal(exited?.realizedGrossPnl, 50);
  assert.equal(afterDuplicate?.events.filter((event) => event.type === "LOT_EXIT_RECORDED").length, 1);
  await assert.rejects(() => recordLotExit(strategy.id, {
    lotId: lot.id, quantity: 0.1, realizedGrossPnl: 10, sourceExitId: "exit-after-close",
  }), /成交批次不可退出/);
});

test("lot exits accept finite losses but reject NaN and Infinity gross PnL", async () => {
  const { createStrategy, recordEntryFill, recordLotExit } = await import("../lib/trade/strategies.ts");
  const strategy = await createStrategy({ ...validDraft, idempotencyKey: "strategy-signed-pnl-1" });
  const lot = await recordEntryFill(strategy.id, {
    legId: strategy.legs[0].id, quantity: 0.5, price: 100, sourceFillId: "signed-pnl-fill",
  });

  await recordLotExit(strategy.id, {
    lotId: lot.id, quantity: 0.1, realizedGrossPnl: -1, sourceExitId: "signed-pnl-loss",
  });
  await assert.rejects(() => recordLotExit(strategy.id, {
    lotId: lot.id, quantity: 0.1, realizedGrossPnl: Number.NaN, sourceExitId: "signed-pnl-nan",
  }), /已实现毛利润不正确/);
  await assert.rejects(() => recordLotExit(strategy.id, {
    lotId: lot.id, quantity: 0.1, realizedGrossPnl: Number.POSITIVE_INFINITY, sourceExitId: "signed-pnl-infinity",
  }), /已实现毛利润不正确/);
});

test("refreshing an already handled closed candle is a no-op without another audit event", async () => {
  const { createStrategy, getStrategy, recordRefresh } = await import("../lib/trade/strategies.ts");
  const strategy = await createStrategy({ ...validDraft, idempotencyKey: "strategy-refresh-idempotency-1" });
  const leg = strategy.legs[0];
  await recordRefresh(strategy.id, { legId: leg.id, closedCandleId: "1h:60", price: 99, requestedQuantity: 0.3 });
  await recordRefresh(strategy.id, { legId: leg.id, closedCandleId: "1h:60", price: 97, requestedQuantity: 0.4 });

  const persisted = await getStrategy(strategy.id);
  const refreshedLeg = persisted?.legs.find((candidate) => candidate.id === leg.id);
  assert.equal(refreshedLeg?.lastClosedCandleId, "1h:60");
  assert.equal(refreshedLeg?.price, 99);
  assert.equal(refreshedLeg?.requestedQuantity, 0.3);
  assert.equal(persisted?.events.filter((event) => event.type === "REFRESHED").length, 1);
});

test("PAPER executor refreshes on a closed candle, fills resting limits, and only cancels entries after every lot exits", async () => {
  const { createStrategy, getStrategy, recordLotExit } = await import("../lib/trade/strategies.ts");
  const { runPaperStrategyTick } = await import("../lib/trade/paper-strategy-executor.ts");
  const strategy = await createStrategy({ ...validDraft, idempotencyKey: "paper-executor-lifecycle-1" });

  const filled = await runPaperStrategyTick({
    strategyId: strategy.id,
    symbol: "AKEUSDT",
    markPrice: 105,
    closedCandle: closedCandle({ id: "1h:paper-1" }),
  });
  assert.equal(filled.filledLegs.length, 1);
  assert.equal(filled.refreshedLegs.length, 3);

  let persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.lots.length, 1);
  assert.equal(persisted?.legs.filter((leg) => leg.status === "WAITING").length, 2);

  const targeted = await runPaperStrategyTick({ strategyId: strategy.id, symbol: "AKEUSDT", markPrice: 220 });
  assert.equal(targeted.exitedLots.length, 1);
  persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.legs.some((leg) => leg.status === "WAITING"), true);

  const lot = persisted?.lots[0];
  assert.ok(lot);
  await recordLotExit(strategy.id, {
    lotId: lot.id,
    quantity: lot.initialQuantity - lot.exitedQuantity,
    realizedGrossPnl: 0,
    sourceExitId: "paper-executor-final-manual-exit",
  });
  const closed = await runPaperStrategyTick({ strategyId: strategy.id, symbol: "AKEUSDT", markPrice: 220 });
  assert.deepEqual(closed.canceledStrategyIds, [strategy.id]);
  persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.legs.every((leg) => leg.status !== "WAITING"), true);
});

test("paper snapshot does not apply a closed candle that lacks strategy indicator context", async () => {
  const { createStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
  const { getPaperSnapshot } = await import("../lib/paper.ts");
  const strategy = await createStrategy({ ...validDraft, symbol: "BTCUSDT", idempotencyKey: "paper-snapshot-executor-1" });
  const completeCandle = closedCandle({ id: "1h:paper-snapshot-1" });
  const { timeframe, maKind, maLength, atrLength, ...incompleteCandle } = completeCandle;
  const snapshot = await getPaperSnapshot({
    symbol: "BTCUSDT", quotedPrice: 105, quoteMode: "live",
    closedCandle: incompleteCandle,
  });

  assert.equal(snapshot.mode, "paper");
  assert.equal((await getStrategy(strategy.id))?.lots.length, 0);
});

test("PAPER executor fills a horizontal resting limit without moving it on a candle", async () => {
  const { createStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
  const { runPaperStrategyTick } = await import("../lib/trade/paper-strategy-executor.ts");
  const strategy = await createStrategy({
    ...validDraft,
    symbol: "ETHUSDT",
    style: "HORIZONTAL",
    horizontalEntry: { price: 100 },
    legs: [{ atrOffset: 0 }],
    idempotencyKey: "paper-executor-horizontal-1",
  });

  const outcome = await runPaperStrategyTick({ strategyId: strategy.id, symbol: "ETHUSDT", markPrice: 100 });
  assert.equal(outcome.filledLegs.length, 1);
  assert.equal((await getStrategy(strategy.id))?.lots.length, 1);
});

test("PAPER executor expires every idle runnable strategy before filtering the tick symbol", async () => {
  const { createStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
  const { getD1 } = await import("../db/index.ts");
  const { runPaperStrategyTick } = await import("../lib/trade/paper-strategy-executor.ts");
  const strategy = await createStrategy({ ...validDraft, symbol: "SOLUSDT", idempotencyKey: "paper-executor-idle-expiry-1" });
  await (await getD1()).prepare("UPDATE trade_strategies SET expires_at = '1970-01-01 00:00:00' WHERE id = ?").bind(strategy.id).run();

  const outcome = await runPaperStrategyTick({ symbol: "BTCUSDT", markPrice: 100 });
  const expired = await getStrategy(strategy.id);
  assert.deepEqual(outcome.expiredStrategyIds, [strategy.id]);
  assert.equal(expired?.status, "EXPIRED");
  assert.equal(expired?.legs.every((leg) => leg.status === "CANCELED"), true);
  assert.equal(expired?.events.filter((event) => event.type === "EXPIRED").length, 1);
});

async function createAndFillGuardStrategy(overrides = {}) {
  const { createStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
  const { runPaperStrategyTick } = await import("../lib/trade/paper-strategy-executor.ts");
  const strategy = await createStrategy({
    ...validDraft,
    symbol: "GUARDUSDT",
    style: "HORIZONTAL",
    horizontalEntry: { price: 100 },
    legs: [{ atrOffset: 0 }],
    idempotencyKey: `guard-${crypto.randomUUID()}`,
    ...overrides,
  });
  await runPaperStrategyTick({ strategyId: strategy.id, symbol: "GUARDUSDT", markPrice: 100 });
  const filled = await getStrategy(strategy.id);
  assert.equal(filled?.lots.length, 1);
  return { strategy: filled, runPaperStrategyTick, getStrategy };
}

test("PAPER dynamic MA guard uses only closed-candle closes, resets after safety, and exits LONG on the second new violation", async () => {
  const { strategy, runPaperStrategyTick, getStrategy } = await createAndFillGuardStrategy({
    dynamicGuard: { atrMultiplier: 1 },
  });
  assert.ok(strategy);

  const closed = (id, close) => runPaperStrategyTick({
    strategyId: strategy.id,
    symbol: "GUARDUSDT",
    markPrice: 100,
    closedCandle: closedCandle({ id, close }),
  });

  await closed("1h:guard-long-1", 89);
  let persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.lots[0].exitedQuantity, persisted?.lots[0].initialQuantity / 2);

  await closed("1h:guard-long-safe", 91);
  await closed("1h:guard-long-after-reset-1", 89);
  persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.lots[0].exitedQuantity, persisted?.lots[0].initialQuantity / 2);

  await closed("1h:guard-long-after-reset-2", 89);
  persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.lots[0].exitedQuantity, persisted?.lots[0].initialQuantity);
  assert.equal(persisted?.events.filter((event) => String(event.payload.sourceExitId).includes("guard:dynamic")).length, 2);
});

test("PAPER dynamic MA guard exits SHORT only after two higher closed candles", async () => {
  const { strategy, runPaperStrategyTick, getStrategy } = await createAndFillGuardStrategy({
    side: "SHORT",
    dynamicGuard: { atrMultiplier: 1 },
  });
  assert.ok(strategy);

  const closed = (id, close) => runPaperStrategyTick({
    strategyId: strategy.id,
    symbol: "GUARDUSDT",
    markPrice: 100,
    closedCandle: closedCandle({ id, close }),
  });
  await closed("1h:guard-short-1", 111);
  let persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.lots[0].exitedQuantity, persisted?.lots[0].initialQuantity / 2);
  await closed("1h:guard-short-2", 111);
  persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.lots[0].exitedQuantity, persisted?.lots[0].initialQuantity);
});

test("PAPER guards persist adverse LONG and SHORT losses while later gross-profit targets still work", async () => {
  const { createStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
  const { runPaperStrategyTick } = await import("../lib/trade/paper-strategy-executor.ts");

  for (const { side, adversePrice, close } of [
    { side: "LONG", adversePrice: 89, close: 89 },
    { side: "SHORT", adversePrice: 111, close: 111 },
  ]) {
    const strategy = await createStrategy({
      ...validDraft,
      symbol: `${side}LOSSUSDT`,
      side,
      style: "HORIZONTAL",
      horizontalEntry: { price: 100 },
      legs: [{ atrOffset: 0 }],
      dynamicGuard: { atrMultiplier: 1 },
      idempotencyKey: `paper-${side.toLowerCase()}-loss-${crypto.randomUUID()}`,
    });

    await runPaperStrategyTick({ strategyId: strategy.id, symbol: strategy.config.symbol, markPrice: 100 });
    await runPaperStrategyTick({
      strategyId: strategy.id,
      symbol: strategy.config.symbol,
      markPrice: adversePrice,
      closedCandle: closedCandle({ id: `1h:${side}:loss`, close }),
    });

    let persisted = await getStrategy(strategy.id);
    assert.equal(persisted?.lots[0].realizedGrossPnl, -4.95);

    if (side !== "LONG") continue;
    await runPaperStrategyTick({ strategyId: strategy.id, symbol: strategy.config.symbol, markPrice: 400 });
    persisted = await getStrategy(strategy.id);
    assert.equal(persisted?.lots[0].completedProfitTargets.includes(1), true);
    assert.equal(persisted?.lots[0].realizedGrossPnl, 62.55);
  }
});

test("PAPER dynamic guard restores its per-strategy confirmation from the audit trail", async () => {
  const { getD1 } = await import("../db/index.ts");
  const { strategy, runPaperStrategyTick, getStrategy } = await createAndFillGuardStrategy({
    dynamicGuard: { atrMultiplier: 1 },
  });
  assert.ok(strategy);
  await (await getD1()).prepare(`INSERT INTO trade_strategy_events (id, strategy_id, type, payload_json)
    VALUES (?, ?, 'GUARD_CHECKED', ?)`).bind(
    crypto.randomUUID(), strategy.id,
    JSON.stringify({ guard: "DYNAMIC_MA", closedCandleId: "1h:before-restart", violated: true, confirmationCount: 1 }),
  ).run();

  await runPaperStrategyTick({
    strategyId: strategy.id, symbol: "GUARDUSDT", markPrice: 100,
    closedCandle: closedCandle({ id: "1h:after-restart", close: 89 }),
  });
  const persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.lots[0].exitedQuantity, persisted?.lots[0].initialQuantity);
});

test("PAPER horizontal guard confirms only distinct matching closed candles", async () => {
  const one = await createAndFillGuardStrategy({
    horizontalGuard: { price: 90, confirmationCandles: 1 },
  });
  assert.ok(one.strategy);
  await one.runPaperStrategyTick({ strategyId: one.strategy.id, symbol: "GUARDUSDT", markPrice: 89 });
  await one.runPaperStrategyTick({ strategyId: one.strategy.id, symbol: "GUARDUSDT", markPrice: 89 });
  let onePersisted = await one.getStrategy(one.strategy.id);
  assert.equal(onePersisted?.lots[0].exitedQuantity, 0);
  await one.runPaperStrategyTick({
    strategyId: one.strategy.id,
    symbol: "GUARDUSDT",
    markPrice: 89,
    closedCandle: closedCandle({ id: "1h:horizontal-one", close: 89 }),
  });
  onePersisted = await one.getStrategy(one.strategy.id);
  assert.equal(onePersisted?.lots[0].exitedQuantity, onePersisted?.lots[0].initialQuantity);

  const two = await createAndFillGuardStrategy({
    horizontalGuard: { price: 90, confirmationCandles: 2 },
  });
  assert.ok(two.strategy);
  const tick = (id, close) => two.runPaperStrategyTick({
    strategyId: two.strategy.id,
    symbol: "GUARDUSDT",
    markPrice: close,
    closedCandle: closedCandle({ id, close }),
  });
  await tick("1h:horizontal-two-first", 89);
  let twoPersisted = await two.getStrategy(two.strategy.id);
  assert.equal(twoPersisted?.lots[0].exitedQuantity, twoPersisted?.lots[0].initialQuantity / 2);
  await tick("1h:horizontal-two-first", 89);
  twoPersisted = await two.getStrategy(two.strategy.id);
  assert.equal(twoPersisted?.lots[0].exitedQuantity, twoPersisted?.lots[0].initialQuantity / 2);
  await tick("1h:horizontal-two-safe", 91);
  await tick("1h:horizontal-two-after-reset-first", 89);
  twoPersisted = await two.getStrategy(two.strategy.id);
  assert.equal(twoPersisted?.lots[0].exitedQuantity, twoPersisted?.lots[0].initialQuantity / 2);
  await tick("1h:horizontal-two-after-reset-second", 89);
  twoPersisted = await two.getStrategy(two.strategy.id);
  assert.equal(twoPersisted?.lots[0].exitedQuantity, twoPersisted?.lots[0].initialQuantity);
});

test("PAPER executor never shares a closed candle across timeframe or indicator strategies", async () => {
  const { createStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
  const { runPaperStrategyTick } = await import("../lib/trade/paper-strategy-executor.ts");
  const oneHourSma = await createStrategy({ ...validDraft, idempotencyKey: `candle-match-1h-sma-${crypto.randomUUID()}` });
  const fourHourSma = await createStrategy({ ...validDraft, timeframe: "4h", idempotencyKey: `candle-match-4h-sma-${crypto.randomUUID()}` });
  const oneHourEma = await createStrategy({ ...validDraft, ma: { kind: "EMA", length: 30 }, idempotencyKey: `candle-match-1h-ema-${crypto.randomUUID()}` });
  const oneHourSma60 = await createStrategy({ ...validDraft, ma: { kind: "SMA", length: 60 }, idempotencyKey: `candle-match-1h-sma60-${crypto.randomUUID()}` });
  const oneHourSmaAtr20 = await createStrategy({ ...validDraft, atr: { length: 20 }, idempotencyKey: `candle-match-1h-sma-atr20-${crypto.randomUUID()}` });
  const oppositeOneHourSma = await createStrategy({ ...validDraft, side: "SHORT", idempotencyKey: `candle-match-1h-short-${crypto.randomUUID()}` });

  const input = {
    symbol: "AKEUSDT",
    markPrice: 105,
    closedCandle: closedCandle({ id: "1h:matching-only", timeframe: "1h", maKind: "SMA", maLength: 30, atrLength: 14 }),
  };
  const outcome = await runPaperStrategyTick(input);
  assert.deepEqual(outcome.refreshedLegs.filter(({ strategyId }) => strategyId === oneHourSma.id).length, 3);
  assert.equal((await getStrategy(oneHourSma.id))?.lots.length, 1);

  const matchingOpposite = await getStrategy(oppositeOneHourSma.id);
  assert.equal(matchingOpposite?.legs.every((leg) => leg.lastClosedCandleId === "1h:matching-only"), true);
  assert.equal(matchingOpposite?.lots.length, 2);

  for (const strategy of [fourHourSma, oneHourEma, oneHourSma60, oneHourSmaAtr20]) {
    const persisted = await getStrategy(strategy.id);
    assert.equal(persisted?.lots.length, 0);
    assert.equal(persisted?.legs.every((leg) => leg.lastClosedCandleId === null), true);
  }

  const mismatchedTarget = await runPaperStrategyTick({ ...input, strategyId: fourHourSma.id });
  assert.equal(mismatchedTarget.refreshedLegs.length, 0);
  assert.equal((await getStrategy(fourHourSma.id))?.legs.every((leg) => leg.lastClosedCandleId === null), true);
});

test("PAPER guard retries the same closed candle's pending half exit after a transient ledger failure", async () => {
  const { getD1 } = await import("../db/index.ts");
  const { strategy, runPaperStrategyTick, getStrategy } = await createAndFillGuardStrategy({ dynamicGuard: { atrMultiplier: 1 } });
  assert.ok(strategy);
  const db = await getD1();
  await db.prepare(`CREATE TRIGGER fail_guard_exit_once BEFORE INSERT ON trade_strategy_lot_exits
    WHEN NEW.source_exit_id LIKE 'paper:exit:%:guard:%'
    BEGIN SELECT RAISE(ABORT, 'simulated guard exit failure'); END`).run();
  const tick = () => runPaperStrategyTick({
    strategyId: strategy.id,
    symbol: "GUARDUSDT",
    markPrice: 89,
    closedCandle: closedCandle({ id: "1h:guard-retry-same-candle", close: 89 }),
  });
  try {
    await assert.rejects(tick, /simulated guard exit failure/);
  } finally {
    await db.prepare("DROP TRIGGER fail_guard_exit_once").run();
  }

  await tick();
  const persisted = await getStrategy(strategy.id);
  assert.equal(persisted?.lots[0].exitedQuantity, persisted?.lots[0].initialQuantity / 2);
  assert.equal(persisted?.events.filter((event) => String(event.payload.sourceExitId).includes("guard:dynamic")).length, 1);
});

test("PAPER guard merge uses the lowest remaining target and a partial guard exit keeps waiting entries", async () => {
  const { createStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
  const { runPaperStrategyTick } = await import("../lib/trade/paper-strategy-executor.ts");
  const merged = await createAndFillGuardStrategy({
    dynamicGuard: { atrMultiplier: 1 },
    horizontalGuard: { price: 90, confirmationCandles: 1 },
  });
  assert.ok(merged.strategy);
  await merged.runPaperStrategyTick({
    strategyId: merged.strategy.id, symbol: "GUARDUSDT", markPrice: 89,
    closedCandle: closedCandle({ id: "1h:guard-merge", close: 89 }),
  });
  const mergedPersisted = await merged.getStrategy(merged.strategy.id);
  assert.equal(mergedPersisted?.lots[0].exitedQuantity, mergedPersisted?.lots[0].initialQuantity);

  const partial = await createStrategy({
    ...validDraft,
    symbol: "PARTIALUSDT",
    idempotencyKey: `guard-partial-${crypto.randomUUID()}`,
    dynamicGuard: { atrMultiplier: 1 },
  });
  await runPaperStrategyTick({
    strategyId: partial.id, symbol: "PARTIALUSDT", markPrice: 105,
    closedCandle: closedCandle({ id: "1h:partial-entry", close: 100 }),
  });
  await runPaperStrategyTick({
    strategyId: partial.id, symbol: "PARTIALUSDT", markPrice: 105,
    closedCandle: closedCandle({ id: "1h:partial-guard", close: 89 }),
  });
  const persisted = await getStrategy(partial.id);
  assert.equal(persisted?.lots[0].exitedQuantity, persisted?.lots[0].initialQuantity / 2);
  assert.equal(persisted?.legs.filter((leg) => leg.status === "WAITING").length, 2);
});
