import assert from "node:assert/strict";
import test from "node:test";

const { cancelAndConfirmOwnedExitOrders, reconcileOwnedExitOnlyOrders } = await import("../lib/trade/live-exit-reconciliation.ts");

const owned = (overrides = {}) => ({
  clientOrderId: "webExitStable1", eventId: "TW-L-S-1:GEN-2:TP-1", generation: 2,
  status: "SUBMITTED", symbol: "BTCUSDT", side: "SELL", positionSide: "LONG",
  type: "TAKE_PROFIT_MARKET", quantity: "3", price: null, stopPrice: "110",
  timeInForce: null, ...overrides,
});
const open = (overrides = {}) => ({
  symbol: "BTCUSDT", clientOrderId: "webExitStable1", side: "SELL", positionSide: "LONG",
  type: "TAKE_PROFIT_MARKET", timeInForce: null, stopPrice: "110", price: "0",
  status: "NEW", origQty: "3", executedQty: "0", ...overrides,
});

test("只清理语义完全匹配且账本已证明的 STOP_MARKET / TAKE_PROFIT_MARKET；外部同向减仓单永不被推断为归属", () => {
  const result = reconcileOwnedExitOnlyOrders({
    positionQuantity: "0",
    activeGeneration: 2,
    strategyTerminal: false,
    ownedOrders: [owned()],
    openOrders: [open(), open({ clientOrderId: "manual-sell", origQty: "99" })],
  });

  assert.deepEqual(result.cancelClientOrderIds, ["webExitStable1"]);
  assert.equal(result.reservedQuantity, "0");
});

test("条件单当前代次只按 origQty-executedQty 预留，旧代次退出单需要清理", () => {
  const result = reconcileOwnedExitOnlyOrders({
    positionQuantity: "5",
    activeGeneration: 2,
    strategyTerminal: false,
    ownedOrders: [owned(), owned({ clientOrderId: "webExitOld", eventId: "TW-L-S-1:GEN-1:TP-1", generation: 1 })],
    openOrders: [open({ origQty: "3", executedQty: "1" }), open({ clientOrderId: "webExitOld" })],
  });

  assert.equal(result.reservedQuantity, "2");
  assert.deepEqual(result.cancelClientOrderIds, ["webExitOld"]);
});

test("外部减仓造成当前代次超额预留时 fail closed，不擅自缩减或重定价 TP", () => {
  const result = reconcileOwnedExitOnlyOrders({
    positionQuantity: "1",
    activeGeneration: 2,
    strategyTerminal: false,
    ownedOrders: [owned()], openOrders: [open({ origQty: "3" })],
  });

  assert.equal(result.failClosed, true);
  assert.match(result.reason, /产品决策/);
  assert.deepEqual(result.cancelClientOrderIds, []);
});

test("STOP_MARKET / TAKE_PROFIT_MARKET 的未知状态或任一不可变语义不匹配均 fail closed，重复正常对账幂等", () => {
  for (const order of [
    open({ status: "UNKNOWN" }),
    open({ type: "STOP_MARKET", stopPrice: "90" }),
    open({ side: "BUY" }),
    open({ positionSide: "SHORT" }),
    open({ stopPrice: "111" }),
  ]) {
    const result = reconcileOwnedExitOnlyOrders({
      positionQuantity: "3", activeGeneration: 2, strategyTerminal: false, ownedOrders: [owned()], openOrders: [order],
    });
    assert.equal(result.failClosed, true);
    assert.deepEqual(result.cancelClientOrderIds, []);
  }
  const input = { positionQuantity: "3", activeGeneration: 2, strategyTerminal: false, ownedOrders: [owned()], openOrders: [open()] };
  assert.deepEqual(reconcileOwnedExitOnlyOrders(input), reconcileOwnedExitOnlyOrders(input));
});

test("终态条件单不预留，且没有可匹配账本的外部条件单永不归属", () => {
  const result = reconcileOwnedExitOnlyOrders({
    positionQuantity: "3", activeGeneration: 2, strategyTerminal: false, ownedOrders: [owned({ type: "STOP_MARKET", stopPrice: "90" })],
    openOrders: [
      open({ clientOrderId: "webExitStable1", type: "STOP_MARKET", stopPrice: "90", status: "FILLED", executedQty: "3" }),
      open({ clientOrderId: "manual-stop", type: "STOP_MARKET", stopPrice: "90", origQty: "99" }),
    ],
  });
  assert.equal(result.failClosed, false);
  assert.equal(result.reservedQuantity, "0");
  assert.deepEqual(result.cancelClientOrderIds, []);
});

test("仅账本选出的旧代次条件单在取消后复查为终态时才放行", async () => {
  const stale = owned({ clientOrderId: "webExitOld", eventId: "TW-L-S-1:GEN-1:SL", generation: 1, type: "STOP_MARKET", stopPrice: "90", exchangeOrderId: "900" });
  const reconciliation = reconcileOwnedExitOnlyOrders({
    positionQuantity: "3", activeGeneration: 2, strategyTerminal: false, ownedOrders: [owned(), stale],
    openOrders: [open(), open({ clientOrderId: stale.clientOrderId, type: stale.type, stopPrice: stale.stopPrice })],
  });
  let queries = 0;
  let cancels = 0;
  const result = await cancelAndConfirmOwnedExitOrders({ reconciliation, ownedOrders: [owned({ exchangeOrderId: "901" }), stale] }, {
    queryOrder: async () => ({ ...open({ clientOrderId: stale.clientOrderId, type: stale.type, stopPrice: stale.stopPrice, status: queries++ ? "CANCELED" : "NEW" }) }),
    cancelOrder: async () => { cancels += 1; return null; },
  });
  assert.equal(cancels, 1);
  assert.equal(result.failClosed, false);
  assert.deepEqual(result.cancelClientOrderIds, []);
});

test("取消失败、未知状态或取消后未确认终态均 fail closed", async () => {
  const stale = owned({ clientOrderId: "webExitOld", eventId: "TW-L-S-1:GEN-1:SL", generation: 1, type: "STOP_MARKET", stopPrice: "90", exchangeOrderId: "900" });
  const reconciliation = { reservedQuantity: "0", cancelClientOrderIds: [stale.clientOrderId], failClosed: false, reason: null };
  for (const response of [open({ clientOrderId: stale.clientOrderId, type: stale.type, stopPrice: stale.stopPrice, status: "UNKNOWN" }), open({ clientOrderId: stale.clientOrderId, type: stale.type, stopPrice: stale.stopPrice, status: "NEW" })]) {
    const result = await cancelAndConfirmOwnedExitOrders({ reconciliation, ownedOrders: [stale] }, {
      queryOrder: async () => response,
      cancelOrder: async () => { if (response.status === "NEW") throw new Error("cancel failed"); return null; },
    });
    assert.equal(result.failClosed, true);
  }
});
