import assert from "node:assert/strict";
import test from "node:test";

const { buildThreeLiveEntryOrders } = await import("../lib/trade/live-three-leg.ts");

const strategy = {
  symbol: "BTCUSDT",
  side: "LONG",
  totalMarginUsdt: 90,
  legs: [
    { websiteOrderId: "web0001", atrOffset: 1, marginUsdt: 30 },
    { websiteOrderId: "web0002", atrOffset: 0, marginUsdt: 30 },
    { websiteOrderId: "web0003", atrOffset: -1, marginUsdt: 30 },
  ],
};

const market = {
  symbol: "BTCUSDT",
  markPrice: 100,
  closedCandle: { ma: 100, atr: 10, tickSize: 0.1, stepSize: 0.01 },
};

const filters = [
  { filterType: "LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "1" },
];

test("builds exactly three LONG GTX orders around MA and ATR", () => {
  const orders = buildThreeLiveEntryOrders({
    strategy,
    market,
    filters,
    positionMode: "HEDGE",
    availableBalance: 100,
    clientOrderIds: ["webIN1", "webIN2", "webIN3"],
  });

  assert.equal(orders.length, 3);
  assert.deepEqual(orders.map((order) => [order.websiteOrderId, order.price, order.side, order.type, order.timeInForce]), [
    ["web0001", "110.0", "BUY", "LIMIT", "GTX"],
    ["web0002", "100.0", "BUY", "LIMIT", "GTX"],
    ["web0003", "90.0", "BUY", "LIMIT", "GTX"],
  ]);
  assert.deepEqual(orders.map((order) => order.positionSide), ["LONG", "LONG", "LONG"]);
  assert.deepEqual(orders.map((order) => order.quantity), ["0.27", "0.30", "0.33"]);
  assert.deepEqual(orders.map((order) => order.newClientOrderId), ["webIN1", "webIN2", "webIN3"]);
});

test("treats each leg amount as margin and applies the current leverage to order notional", () => {
  const orders = buildThreeLiveEntryOrders({
    strategy: {
      ...strategy,
      totalMarginUsdt: 30,
      legs: [
        { websiteOrderId: "web0001", atrOffset: 1, marginUsdt: 10 },
        { websiteOrderId: "web0002", atrOffset: 0, marginUsdt: 10 },
        { websiteOrderId: "web0003", atrOffset: -1, marginUsdt: 10 },
      ],
    },
    leverage: 10,
    market,
    filters: [{ filterType: "LOT_SIZE", stepSize: "0.01", minQty: "0.01" }, { filterType: "MIN_NOTIONAL", notional: "90" }],
    availableBalance: 30,
    clientOrderIds: ["webIN21", "webIN22", "webIN23"],
  });

  assert.deepEqual(orders.map((order) => order.quantity), ["0.90", "1.00", "1.11"]);
});

test("builds exactly three SHORT GTX orders with the same strategy prices", () => {
  const orders = buildThreeLiveEntryOrders({
    strategy: { ...strategy, side: "SHORT" },
    market,
    filters,
    positionMode: "HEDGE",
    availableBalance: 100,
    clientOrderIds: ["webIN4", "webIN5", "webIN6"],
  });

  assert.deepEqual(orders.map((order) => order.side), ["SELL", "SELL", "SELL"]);
  assert.deepEqual(orders.map((order) => order.positionSide), ["SHORT", "SHORT", "SHORT"]);
  assert.deepEqual(orders.map((order) => order.price), ["110.0", "100.0", "90.0"]);
});

test("builds the selected number of live GTX orders without imposing a three-leg test", () => {
  const orders = buildThreeLiveEntryOrders({
    strategy: {
      ...strategy,
      legs: [
        { websiteOrderId: "web0001", atrOffset: -1, marginUsdt: 22.5 },
        { websiteOrderId: "web0002", atrOffset: -0.33333333, marginUsdt: 22.5 },
        { websiteOrderId: "web0003", atrOffset: 0.33333333, marginUsdt: 22.5 },
        { websiteOrderId: "web0004", atrOffset: 1, marginUsdt: 22.5 },
      ],
    },
    market,
    filters,
    availableBalance: 100,
    clientOrderIds: ["webIN11", "webIN12", "webIN13", "webIN14"],
  });

  assert.equal(orders.length, 4);
  assert.deepEqual(orders.map((order) => order.newClientOrderId), ["webIN11", "webIN12", "webIN13", "webIN14"]);
});

test("rejects the complete batch when one leg is below an exchange minimum", () => {
  assert.throws(() => buildThreeLiveEntryOrders({
    strategy,
    market,
    filters: [
      { filterType: "LOT_SIZE", stepSize: "0.01", minQty: "0.31" },
      { filterType: "MIN_NOTIONAL", notional: "1" },
    ],
    availableBalance: 100,
    clientOrderIds: ["webIN7", "webIN8", "webIN9"],
  }), /最小数量/);
});

test("rejects the complete batch when available balance is insufficient", () => {
  assert.throws(() => buildThreeLiveEntryOrders({
    strategy,
    market,
    filters,
    availableBalance: 89.99,
    clientOrderIds: ["webIN10", "webIN11", "webIN12"],
  }), /可用余额/);
});

test("persists each live leg plan and transitions one strategy as a batch", async () => {
  const dbPath = `${process.env.TMPDIR || "/tmp"}/streetlight-live-three-leg-${process.pid}-${Date.now()}.sqlite`;
  process.env.STREETLIGHT_LOCAL_D1 = dbPath;
  const { createLiveStrategy, getLiveStrategy, markLiveStrategyStatus, recordLiveOrder, reserveLiveOrder } = await import("../lib/trade/live-strategies.ts");
  const strategyRecord = await createLiveStrategy({
    draft: { ...strategy, mode: "LIVE_ARMED", ma: { kind: "SMA", length: 30 }, atr: { length: 14, multiplier: 1 } },
    origin: "WEB",
    confirmationNonce: "live_batch_nonce_01",
  });
  const planned = await Promise.all(strategyRecord.legs.map((leg, index) => reserveLiveOrder(strategyRecord.id, leg.id, "ENTRY", {
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX",
    price: ["110.0", "100.0", "90.0"][index], quantity: ["0.27", "0.30", "0.33"][index],
  })));
  assert.deepEqual(planned.map((order) => order.price), ["110.0", "100.0", "90.0"]);
  await recordLiveOrder(planned[0].id, "123", "SUBMITTED", { executedQuantity: "0" });
  await recordLiveOrder(planned[1].id, null, "REJECTED", { error: "GTX 被拒绝" });
  await markLiveStrategyStatus(strategyRecord.id, "RECONCILIATION_REQUIRED");
  const persisted = await getLiveStrategy(strategyRecord.id);
  assert.equal(persisted?.status, "RECONCILIATION_REQUIRED");
  assert.equal(persisted?.orders[0].status, "SUBMITTED");
  assert.equal(persisted?.orders[0].exchangeOrderId, "123");
  assert.equal(persisted?.orders[1].status, "REJECTED");
  assert.equal(persisted?.orders[1].error, "GTX 被拒绝");
});
