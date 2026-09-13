import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-order-archive-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const archive = () => import("../lib/trade/order-archive.ts");

test("replayed orders and fills stay idempotent while later status changes keep an audit trail", async () => {
  const { archiveHealth, upsertArchivedFill, upsertArchivedOrder } = await archive();
  const input = {
    accountId: "primary", symbol: "BTCUSDT", exchangeOrderId: "9001", clientOrderId: "teleIN0001",
    side: "BUY", positionSide: "LONG", type: "LIMIT", status: "NEW", quantity: "1", executedQuantity: "0",
    time: 1_725_000_000_000, rawPayload: { orderId: 9001, clientOrderId: "teleIN0001", apiKey: "must-not-persist" },
  };
  const first = await upsertArchivedOrder(input);
  const replay = await upsertArchivedOrder(input);
  assert.equal(replay.id, first.id);
  assert.equal(replay.rawClientOrderId, "teleIN0001");
  assert.equal(replay.source, "TELEGRAM");

  await upsertArchivedOrder({ ...input, status: "CANCELED", time: 1_725_000_000_500 });
  const fill = {
    accountId: "primary", symbol: "BTCUSDT", exchangeOrderId: "9001", tradeId: "7001",
    clientOrderId: "teleIN0001", side: "BUY", positionSide: "LONG", role: "ENTRY", quantity: "1", price: "60000",
    commission: "0.4", commissionAsset: "USDT", realizedPnl: "0", time: 1_725_000_000_100,
    rawPayload: { tradeId: 7001, secret: "must-not-persist" },
  };
  assert.equal((await upsertArchivedFill(fill)).id, (await upsertArchivedFill(fill)).id);

  const health = await archiveHealth({ accountId: "primary" });
  assert.deepEqual({ orders: health.orders, fills: health.fills, orderEvents: health.orderEvents }, { orders: 1, fills: 1, orderEvents: 2 });
});

test("archive preserves raw client ids and classifies source without inventing an ios prefix", async () => {
  const { upsertArchivedOrder } = await archive();
  const native = await upsertArchivedOrder({
    accountId: "primary", symbol: "ETHUSDT", exchangeOrderId: "9002", clientOrderId: "manual-ios-original",
    side: "BUY", positionSide: "BOTH", type: "MARKET", status: "FILLED", quantity: "1", executedQuantity: "1", time: 1,
  });
  assert.equal(native.rawClientOrderId, "manual-ios-original");
  assert.equal(native.source, "BINANCE_NATIVE");
});

test("later classifications cannot overwrite the first archived client-order evidence", async () => {
  const { upsertArchivedOrder } = await archive();
  const first = await upsertArchivedOrder({
    accountId: "primary", symbol: "XRPUSDT", exchangeOrderId: "9005", clientOrderId: "binance-original-client-id",
    side: "BUY", positionSide: "BOTH", type: "LIMIT", status: "NEW", quantity: "1", executedQuantity: "0", time: 1,
  });
  const replay = await upsertArchivedOrder({
    accountId: "primary", symbol: "XRPUSDT", exchangeOrderId: "9005", clientOrderId: "webIN-misclassified-later",
    side: "BUY", positionSide: "BOTH", type: "LIMIT", status: "FILLED", quantity: "1", executedQuantity: "1", time: 2,
  });

  assert.equal(first.rawClientOrderId, "binance-original-client-id");
  assert.equal(replay.rawClientOrderId, "binance-original-client-id");
  assert.equal(replay.source, "BINANCE_NATIVE");
});

test("overlapping native orders stay unpaired until a user creates a review group", async () => {
  const { createManualReviewGroup, linkArchivedFillToStrategy, upsertArchivedFill, upsertArchivedOrder } = await archive();
  await upsertArchivedOrder({
    accountId: "primary", symbol: "SOLUSDT", exchangeOrderId: "9003", clientOrderId: "native-one",
    side: "BUY", positionSide: "BOTH", type: "MARKET", status: "FILLED", quantity: "1", executedQuantity: "1", time: 1,
  });
  await upsertArchivedOrder({
    accountId: "primary", symbol: "SOLUSDT", exchangeOrderId: "9004", clientOrderId: "native-two",
    side: "BUY", positionSide: "BOTH", type: "MARKET", status: "FILLED", quantity: "1", executedQuantity: "1", time: 2,
  });
  const fill = await upsertArchivedFill({
    accountId: "primary", symbol: "SOLUSDT", exchangeOrderId: "9003", tradeId: "7003", clientOrderId: "native-one",
    side: "BUY", positionSide: "BOTH", role: "ENTRY", quantity: "1", price: "100", time: 3, nativeOrdersOverlap: true,
  });
  assert.equal(fill.confidence, "UNPAIRED");
  await assert.rejects(() => linkArchivedFillToStrategy({ fillId: fill.id, strategyId: "TW-L-S-1" }), /原生重叠/);

  const group = await createManualReviewGroup({ accountId: "primary", symbol: "SOLUSDT", side: "LONG", fillIds: [fill.id] });
  assert.equal(group.confidence, "EXACT");
});

test("verified strategy groups provide direct exact evidence", async () => {
  const { linkArchivedFillToStrategy, upsertArchivedFill } = await archive();
  const fill = await upsertArchivedFill({
    accountId: "primary", symbol: "BTCUSDT", exchangeOrderId: "9010", tradeId: "7010", clientOrderId: "webIN001",
    side: "BUY", positionSide: "LONG", role: "ENTRY", quantity: "1", price: "60000", time: 10,
  });
  const linked = await linkArchivedFillToStrategy({ fillId: fill.id, strategyId: "TW-L-S-42" });
  assert.equal(linked.confidence, "EXACT");
  assert.equal(linked.reviewGroupId, "TW-L-S-42");
});

test("a fill cannot be attributed to competing review groups", async () => {
  const { linkArchivedFillToStrategy, upsertArchivedFill } = await archive();
  const fill = await upsertArchivedFill({
    accountId: "primary", symbol: "BTCUSDT", exchangeOrderId: "9012", tradeId: "7012", clientOrderId: "webIN002",
    side: "BUY", positionSide: "LONG", role: "ENTRY", quantity: "1", price: "60000", time: 12,
  });

  await linkArchivedFillToStrategy({ fillId: fill.id, strategyId: "TW-L-S-44" });
  await assert.rejects(
    () => linkArchivedFillToStrategy({ fillId: fill.id, strategyId: "TW-L-S-45" }),
    /已归属到其他复盘组/,
  );
});

test("Alex fills cannot be attached to a Web or Telegram strategy group without direct strategy evidence", async () => {
  const { linkArchivedFillToStrategy, upsertArchivedFill } = await archive();
  const fill = await upsertArchivedFill({
    accountId: "primary", symbol: "BTCUSDT", exchangeOrderId: "9011", tradeId: "7011", clientOrderId: "alexMC001",
    side: "BUY", positionSide: "LONG", role: "ENTRY", quantity: "1", price: "60000", time: 11,
  });
  await assert.rejects(() => linkArchivedFillToStrategy({ fillId: fill.id, strategyId: "TW-L-S-43" }), /仅 Web 或 Telegram/);
});
