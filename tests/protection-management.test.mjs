import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-protection-management-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

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

const deps = {
  readPosition: async (symbol) => ({ symbol, positionAmt: "4", entryPrice: "100", markPrice: "101" }),
  readExchangeInfo: async (symbol) => ({ symbols: [{ symbol, filters }] }),
  placeOrder: async () => { throw new Error("management tests must not place exchange orders"); },
};

async function createStop(symbol, sourceOrderId, strategyType = "MA_SL") {
  const { createProtectionStrategy } = await import("../lib/trade/protection-strategies.ts");
  return createProtectionStrategy({
    env,
    origin: "ALEX",
    source: {
      candidateId: `candidate-${symbol}`,
      symbol,
      side: "LONG",
      quantity: 2,
      entryPrice: 100,
      markPrice: 101,
      leverage: 10,
      sourceOrderIds: [sourceOrderId],
    },
    strategyType,
    ...(strategyType === "MA_SL" ? { timeframe: "1h" } : { fixedPrice: 90 }),
    idempotencyKey: `manage-${symbol}-${strategyType}`,
  }, deps);
}

test("manager lists only live stop-loss protections and untouched strategy can edit condition and shrink bound quantity", async () => {
  const created = await createStop("BTCUSDT", "manual-manager-btc");
  const {
    listManagedStopStrategies,
    editManagedStopStrategy,
    managedStopStrategyCanEdit,
  } = await import("../lib/trade/protection-management.ts");

  const listed = await listManagedStopStrategies();
  const strategy = listed.find((item) => item.id === created.strategy.id);
  assert.ok(strategy);
  assert.equal(strategy.strategyType, "MA_SL");
  assert.equal(managedStopStrategyCanEdit(strategy), true);

  const edited = await editManagedStopStrategy({
    id: strategy.id,
    expectedRevision: strategy.revision,
    timeframe: "4h",
    targetQuantity: 1.5,
  });
  assert.equal(edited.config.timeframe, "4h");
  assert.equal(edited.initialQuantity, 1.5);
  assert.equal(edited.remainingQuantity, 1.5);
  assert.ok(edited.revision > strategy.revision);
});

test("manager refuses to enlarge an existing bound quantity in place", async () => {
  const created = await createStop("ETHUSDT", "manual-manager-eth");
  const { editManagedStopStrategy } = await import("../lib/trade/protection-management.ts");
  await assert.rejects(() => editManagedStopStrategy({
    id: created.strategy.id,
    expectedRevision: created.strategy.revision,
    targetQuantity: 3,
  }), /扩大|重新建立|不能增加/);
});

test("after first stop-loss trigger editing is forbidden but stopping the old strategy remains allowed", async () => {
  const created = await createStop("SOLUSDT", "manual-manager-sol", "LEVEL_SL");
  const { getD1 } = await import("../db/index.ts");
  const db = await getD1();
  await db.prepare(`UPDATE trade_protection_strategies
    SET status = 'PARTIALLY_PROTECTED', invalid_candle_count = 1, remaining_quantity = 1,
        revision = revision + 1, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?`).bind(created.strategy.id).run();

  const { getProtectionStrategy } = await import("../lib/trade/protection-strategies.ts");
  const triggered = await getProtectionStrategy(created.strategy.id);
  assert.ok(triggered);

  const {
    editManagedStopStrategy,
    stopManagedStopStrategy,
    managedStopStrategyCanEdit,
  } = await import("../lib/trade/protection-management.ts");

  assert.equal(managedStopStrategyCanEdit(triggered), false);
  await assert.rejects(() => editManagedStopStrategy({
    id: triggered.id,
    expectedRevision: triggered.revision,
    fixedPrice: 92,
  }), /已触发|不可修改|停止.*重新/);

  const stopped = await stopManagedStopStrategy({ id: triggered.id, expectedRevision: triggered.revision });
  assert.equal(stopped.status, "CANCELED");
  assert.equal(stopped.remainingQuantity, 1);
});

test("stop action is optimistic-concurrency protected and never deletes audit history", async () => {
  const created = await createStop("XRPUSDT", "manual-manager-xrp");
  const { stopManagedStopStrategy, listManagedStopStrategies } = await import("../lib/trade/protection-management.ts");

  await assert.rejects(() => stopManagedStopStrategy({
    id: created.strategy.id,
    expectedRevision: created.strategy.revision + 99,
  }), /版本|变化|刷新/);

  const stopped = await stopManagedStopStrategy({ id: created.strategy.id, expectedRevision: created.strategy.revision });
  assert.equal(stopped.status, "CANCELED");
  const active = await listManagedStopStrategies();
  assert.equal(active.some((item) => item.id === created.strategy.id), false);

  const { getProtectionStrategy } = await import("../lib/trade/protection-strategies.ts");
  const audit = await getProtectionStrategy(created.strategy.id);
  assert.equal(audit?.status, "CANCELED");
});
