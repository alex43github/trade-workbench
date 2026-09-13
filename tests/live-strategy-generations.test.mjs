import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-strategy-generations-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const legacyConfig = {
  symbol: "BTCUSDT", side: "LONG", timeframe: "1h", totalMarginUsdt: 100,
  ma: { kind: "EMA", length: 30 }, atr: { length: 14, multiplier: 1 }, legCount: 5,
};

test("backfills five legacy entry orders into an immutable first generation without changing client ids", async () => {
  const { ensureLiveStrategySchema } = await import("../db/ensure.ts");
  const { getD1 } = await import("../db/index.ts");
  const { normalizeLiveStrategyDraft } = await import("../lib/trade/live-contracts.ts");
  await ensureLiveStrategySchema();
  const db = await getD1();
  const strategyId = "TW-L-S-LEGACY-1";
  const config = normalizeLiveStrategyDraft(legacyConfig);
  await db.prepare(`INSERT INTO live_strategies
    (id, confirmation_nonce, origin, status, symbol, side, timeframe, expires_at, config_json)
    VALUES (?, ?, 'WEB', 'ACTIVE', 'BTCUSDT', 'LONG', '1h', '2099-01-01T00:00:00.000Z', ?)`)
    .bind(strategyId, "legacy_generation_nonce", JSON.stringify(config)).run();
  for (let index = 1; index <= 5; index += 1) {
    const legId = `TW-L-LEG-LEGACY-${index}`;
    await db.batch([
      db.prepare(`INSERT INTO live_strategy_legs (id, strategy_id, website_order_id, atr_offset, margin_usdt)
        VALUES (?, ?, ?, ?, 20)`).bind(legId, strategyId, `web${1000 + index}`, index - 3),
      db.prepare(`INSERT INTO live_strategy_orders
        (id, strategy_id, leg_id, intent, client_order_id, exchange_order_id, status, symbol, side, type, time_in_force, price, quantity, executed_quantity)
        VALUES (?, ?, ?, 'ENTRY', ?, ?, 'SUBMITTED', 'BTCUSDT', 'BUY', 'LIMIT', 'GTX', '100', '1', '0')`)
        .bind(`TW-L-ORDER-LEGACY-${index}`, strategyId, legId, `webLegacy${index}`, `legacy-order-${index}`),
    ]);
  }

  const { getLiveStrategy } = await import("../lib/trade/live-strategies.ts");
  const strategy = await getLiveStrategy(strategyId);

  assert.equal(strategy?.currentGeneration?.generation, 1);
  assert.equal(strategy?.attempts.length, 5);
  assert.deepEqual(strategy?.attempts.map((attempt) => attempt.clientOrderId), [
    "webLegacy1", "webLegacy2", "webLegacy3", "webLegacy4", "webLegacy5",
  ]);
  assert.deepEqual((await db.prepare("SELECT client_order_id FROM live_strategy_orders WHERE strategy_id = ? ORDER BY id").bind(strategyId).all()).results.map((row) => row.client_order_id), [
    "webLegacy1", "webLegacy2", "webLegacy3", "webLegacy4", "webLegacy5",
  ]);
  assert.equal((await getLiveStrategy(strategyId))?.attempts.length, 5);
});

test("records idempotent fills into lifecycle aggregates and rejects a competing refresh lease", async () => {
  const live = await import("../lib/trade/live-strategies.ts");
  const strategy = await live.createLiveStrategy({
    draft: { ...legacyConfig, legCount: 1 }, origin: "WEB", confirmationNonce: "generation_lifecycle_nonce",
  });
  const generation = await live.ensureLiveStrategyGeneration({ strategyId: strategy.id, generation: 1, refreshReason: "INITIAL" });
  const entry = await live.createLiveOrderAttempt({
    strategyId: strategy.id, generation: generation.generation, legId: strategy.legs[0].id,
    intent: "ENTRY", clientOrderId: "webAttemptEntry1", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "5",
  });
  await live.recordLiveOrderAttempt(entry.id, "exchange-entry-1", "SUBMITTED");
  await live.recordLiveExecutionFill({ strategyId: strategy.id, orderAttemptId: entry.id, role: "ENTRY", binanceFillId: "entry-fill-1", quantity: "1", price: "100", executedAt: "2026-08-29T00:00:00.000Z" });
  await live.recordLiveExecutionFill({ strategyId: strategy.id, orderAttemptId: entry.id, role: "ENTRY", binanceFillId: "entry-fill-2", quantity: "3", price: "110", executedAt: "2026-08-29T00:01:00.000Z" });
  await live.recordLiveExecutionFill({ strategyId: strategy.id, orderAttemptId: entry.id, role: "ENTRY", binanceFillId: "entry-fill-2", quantity: "3", price: "110", executedAt: "2026-08-29T00:01:00.000Z" });

  const firstLease = await live.claimLiveStrategyRefreshLease({ strategyId: strategy.id, generation: 1, leaseToken: "lease_owner_1" });
  const competingLease = await live.claimLiveStrategyRefreshLease({ strategyId: strategy.id, generation: 1, leaseToken: "lease_owner_2" });
  assert.equal(firstLease.acquired, true);
  assert.equal(competingLease.acquired, false);

  const frozen = await live.freezeLiveStrategyEntries(strategy.id, "ENTRY_FROZEN_BY_STOP");
  assert.equal(frozen.entryFreezeReason, "ENTRY_FROZEN_BY_STOP");
  await assert.rejects(() => live.createLiveOrderAttempt({
    strategyId: strategy.id, generation: 1, legId: strategy.legs[0].id,
    intent: "ENTRY", clientOrderId: "webAttemptEntry2", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "99", quantity: "1",
  }), /冻结/);

  const hydrated = await live.getLiveStrategy(strategy.id);
  assert.deepEqual(hydrated?.lifecycle, {
    entryQuantity: "4",
    entryVwap: "107.5",
    exitQuantity: "0",
    exitVwap: null,
    firstEntryAt: "2026-08-29T00:00:00.000Z",
    lastExitAt: null,
    targetStatus: "PENDING",
    entryFreezeReason: "ENTRY_FROZEN_BY_STOP",
  });
  assert.equal(hydrated?.executionFills.length, 2);
});

test("marks the current generation target complete only after every planned entry quantity has filled", async () => {
  const live = await import("../lib/trade/live-strategies.ts");
  const strategy = await live.createLiveStrategy({
    draft: { ...legacyConfig, legCount: 1 }, origin: "WEB", confirmationNonce: "generation_target_complete_nonce",
  });
  await live.ensureLiveStrategyGeneration({ strategyId: strategy.id, generation: 1, refreshReason: "INITIAL" });
  const entry = await live.createLiveOrderAttempt({
    strategyId: strategy.id, generation: 1, legId: strategy.legs[0].id,
    intent: "ENTRY", clientOrderId: "webTargetComplete1", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "2",
  });
  await live.recordLiveExecutionFill({ strategyId: strategy.id, orderAttemptId: entry.id, role: "ENTRY", binanceFillId: "target-fill-1", quantity: "1", price: "100", executedAt: "2026-08-29T00:00:00.000Z" });
  assert.equal((await live.liveStrategyLifecycle(strategy.id)).targetStatus, "PENDING");
  await live.recordLiveExecutionFill({ strategyId: strategy.id, orderAttemptId: entry.id, role: "ENTRY", binanceFillId: "target-fill-2", quantity: "1", price: "100", executedAt: "2026-08-29T00:01:00.000Z" });
  assert.equal((await live.liveStrategyLifecycle(strategy.id)).targetStatus, "TARGET_COMPLETE");
});

test("lists only confirmed WEB or TELE MA strategies with an automatic refresh cadence", async () => {
  const live = await import("../lib/trade/live-strategies.ts");
  const permitted = await Promise.all(["15m", "1h", "4h", "1d"].map((timeframe, index) => live.createLiveStrategy({
    draft: { ...legacyConfig, timeframe, style: "MA", mode: "LIVE_ARMED", legCount: 1 },
    origin: index % 2 ? "TELEGRAM" : "WEB",
    confirmationNonce: `refreshable_permitted_${index}`,
  })));
  const unsupportedPeriod = await live.createLiveStrategy({
    draft: { ...legacyConfig, timeframe: "5m", style: "MA", mode: "LIVE_ARMED", legCount: 1 },
    origin: "WEB",
    confirmationNonce: "refreshable_unsupported_period",
  });
  const horizontal = await live.createLiveStrategy({
    draft: { ...legacyConfig, timeframe: "1h", style: "HORIZONTAL", mode: "LIVE_ARMED", legCount: 1, horizontalEntry: { price: 100 } },
    origin: "WEB",
    confirmationNonce: "refreshable_horizontal_style",
  });

  const refreshable = await live.listRefreshableLiveStrategies(20);

  assert.ok(permitted.every((strategy) => refreshable.some((candidate) => candidate.id === strategy.id)));
  assert.ok(!refreshable.some((strategy) => strategy.id === unsupportedPeriod.id || strategy.id === horizontal.id));
  assert.ok(refreshable.every((strategy) => strategy.config.style === "MA" && ["15m", "1h", "4h", "1d"].includes(strategy.config.timeframe)));
});
