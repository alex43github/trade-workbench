import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-order-archive-sync-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const sync = () => import("../lib/trade/order-archive-sync.ts");

const order = (overrides = {}) => ({
  orderId: "9001", clientOrderId: "manual-native-order", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH",
  type: "LIMIT", timeInForce: "GTX", price: "60000", stopPrice: "0", origQty: "1", executedQty: "1",
  status: "FILLED", reduceOnly: false, time: 1_725_000_000_000, updateTime: 1_725_000_000_100,
  ...overrides,
});

const trade = (overrides = {}) => ({
  id: "7001", orderId: "9001", symbol: "BTCUSDT", side: "BUY", positionSide: "BOTH", price: "60000", qty: "1",
  commission: "0.2", commissionAsset: "USDT", realizedPnl: "0", time: 1_725_000_000_100, ...overrides,
});

test("replayed ORDER_TRADE_UPDATE keeps immutable orders and fills idempotent", async () => {
  const { archiveUserDataEvent, getOrderArchiveSyncState } = await sync();
  const event = {
    e: "ORDER_TRADE_UPDATE", E: 1_725_000_000_100,
    o: { i: 9001, c: "manual-native-order", s: "BTCUSDT", S: "BUY", ps: "BOTH", o: "LIMIT", f: "GTX", p: "60000", sp: "0", q: "1", z: "1", X: "FILLED", R: false, T: 1_725_000_000_100, t: 7001, l: "1", L: "60000", n: "0.2", N: "USDT", rp: "0" },
  };
  const first = await archiveUserDataEvent(event, { accountId: "primary" });
  const replay = await archiveUserDataEvent(event, { accountId: "primary" });

  assert.deepEqual({ orders: replay.orders, fills: replay.fills }, { orders: 1, fills: 1 });
  assert.equal(first.watermark, replay.watermark);
  assert.equal((await getOrderArchiveSyncState({ accountId: "primary" })).status, "CURRENT");
});

test("read-only reconciliation backfills a dropped event without write-capable gateway calls", async () => {
  const { syncOrderArchive } = await sync();
  const requested = [];
  const result = await syncOrderArchive({
    accountId: "primary", symbols: ["BTCUSDT"], now: 1_725_000_010_000,
    readOrders: async (input) => { requested.push({ kind: "orders", ...input }); return [order()]; },
    readTrades: async (input) => { requested.push({ kind: "trades", ...input }); return [trade()]; },
  });

  assert.deepEqual({ orders: result.orders, fills: result.fills, gaps: result.gaps, stale: result.stale }, { orders: 1, fills: 1, gaps: 0, stale: false });
  assert.equal(result.reconciliationRequired, false);
  assert.deepEqual(requested.map((item) => item.kind), ["orders", "trades"]);
  assert.ok(requested.every((item) => item.symbol === "BTCUSDT" && item.limit <= 1000));
});

test("injected reconciliation never performs a real network request", async () => {
  const { syncOrderArchive } = await sync();
  const fetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("network access is forbidden in this test");
  };
  try {
    const result = await syncOrderArchive({
      accountId: "primary", symbols: ["ADAUSDT"], now: 1_725_000_015_000,
      readOrders: async () => [order({ orderId: "9006", symbol: "ADAUSDT" })],
      readTrades: async () => [trade({ orderId: "9006", id: "7006", symbol: "ADAUSDT" })],
    });
    assert.equal(result.reconciliationRequired, false);
  } finally {
    globalThis.fetch = fetch;
  }
  assert.equal(networkCalls, 0);
});

test("failed read preserves the prior watermark and records a stale reconciliation-required gap", async () => {
  const { getOrderArchiveSyncState, syncOrderArchive } = await sync();
  await syncOrderArchive({
    accountId: "primary", symbols: ["ETHUSDT"], now: 1_725_000_020_000,
    readOrders: async () => [order({ orderId: "9002", symbol: "ETHUSDT" })],
    readTrades: async () => [trade({ orderId: "9002", id: "7002", symbol: "ETHUSDT" })],
  });
  const before = await getOrderArchiveSyncState({ accountId: "primary", symbol: "ETHUSDT" });
  const failed = await syncOrderArchive({
    accountId: "primary", symbols: ["ETHUSDT"], now: 1_725_000_030_000,
    readOrders: async () => { throw new Error("gateway secret=should-not-escape"); },
    readTrades: async () => [],
  });
  const after = await getOrderArchiveSyncState({ accountId: "primary", symbol: "ETHUSDT" });

  assert.equal(failed.stale, true);
  assert.equal(failed.reconciliationRequired, true);
  assert.equal(failed.gaps, 1);
  assert.equal(after.status, "RECONCILIATION_REQUIRED");
  assert.equal(after.watermark, before.watermark);
  assert.equal(after.retries, 1);
  assert.doesNotMatch(JSON.stringify(after), /secret=should-not-escape/);
});

test("an order-read failure does not start the follow-up trade request", async () => {
  const { syncOrderArchive } = await sync();
  const requests = [];
  const result = await syncOrderArchive({
    accountId: "primary", symbols: ["BNBUSDT"], now: 1_725_000_035_000,
    readOrders: async () => {
      requests.push("orders");
      throw new Error("controlled read failure");
    },
    readTrades: async () => {
      requests.push("trades");
      return [];
    },
  });

  assert.equal(result.reconciliationRequired, true);
  assert.deepEqual(requests, ["orders"]);
});

test("native fills remain unpaired instead of being invented into complete review groups", async () => {
  const { syncOrderArchive } = await sync();
  const result = await syncOrderArchive({
    accountId: "primary", symbols: ["SOLUSDT"], nativeOrdersOverlapSymbols: ["SOLUSDT"], now: 1_725_000_040_000,
    readOrders: async () => [order({ orderId: "9003", symbol: "SOLUSDT", clientOrderId: "binance-app-order" })],
    readTrades: async () => [trade({ orderId: "9003", id: "7003", clientOrderId: "binance-app-order", symbol: "SOLUSDT", side: "BUY" })],
  });

  assert.equal(result.fills, 1);
  assert.equal(result.unpaired, 1);
});
