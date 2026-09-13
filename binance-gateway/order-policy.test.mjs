import test from "node:test";
import assert from "node:assert/strict";
import { matchesExitOnlySemantics, validateOrderPayload } from "./order-policy.mjs";

function exitAuthority(positionRows, openOrders = []) {
  return { positionRows, openOrders, normalizedBody: null };
}

function orderBody(values) {
  return new URLSearchParams({ symbol: "BTCUSDT", type: "MARKET", quantity: "1", newClientOrderId: "webExitOnly001", workbenchOrderIntent: "EXIT_ONLY", ...values }).toString();
}

test("EXIT_ONLY 单向多头由权威仓位验证方向、模式并保留客户订单号", () => {
  const authority = exitAuthority([{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "2" }]);
  const error = validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true" }), "", authority);
  assert.equal(error, null);
  const params = new URLSearchParams(authority.normalizedBody);
  assert.equal(params.get("side"), "SELL");
  assert.equal(params.get("positionSide"), "BOTH");
  assert.equal(params.get("reduceOnly"), "true");
  assert.equal(params.get("quantity"), "1");
  assert.equal(params.get("newClientOrderId"), "webExitOnly001");
  assert.equal(params.has("workbenchOrderIntent"), false);
});

test("EXIT_ONLY 同一 clientOrderId 仅接受完全相同的逻辑退出语义", () => {
  const params = new URLSearchParams({ symbol: "BTCUSDT", side: "SELL", positionSide: "LONG", type: "LIMIT", quantity: "1.00", price: "101.0" });
  assert.equal(matchesExitOnlySemantics(params, { symbol: "BTCUSDT", side: "SELL", positionSide: "LONG", type: "LIMIT", origQty: "1", price: "101", stopPrice: "0" }), true);
  assert.equal(matchesExitOnlySemantics(params, { symbol: "BTCUSDT", side: "SELL", positionSide: "LONG", type: "LIMIT", origQty: "1", price: "102", stopPrice: "0" }), false);
});

test("EXIT_ONLY 单向空头拒绝会增加仓位的错误方向", () => {
  const authority = exitAuthority([{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "-2" }]);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true" }), "", authority), /方向/);
});

test("EXIT_ONLY 单向模式拒绝错误 positionSide 与零仓位", () => {
  let authority = exitAuthority([{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "2" }]);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "LONG", reduceOnly: "true" }), "", authority), /positionSide/);
  authority = exitAuthority([{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "0" }]);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true" }), "", authority), /可退出仓位/);
});

test("EXIT_ONLY 对明确退出语义在仓位缩小后安全 clamp，仓位内数量保持不变", () => {
  let authority = exitAuthority([{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "1" }]);
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true", quantity: "3" }), "", authority), null);
  assert.equal(new URLSearchParams(authority.normalizedBody).get("quantity"), "1");
  authority = exitAuthority([{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "1" }]);
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true", quantity: "1" }), "", authority), null);
  assert.equal(new URLSearchParams(authority.normalizedBody).get("quantity"), "1");
});

test("EXIT_ONLY 双向多空分别由权威仓位校验，且不携带 reduceOnly", () => {
  for (const item of [{ positionSide: "LONG", positionAmt: "3", side: "SELL" }, { positionSide: "SHORT", positionAmt: "-4", side: "BUY" }]) {
    const authority = exitAuthority([{ symbol: "BTCUSDT", positionSide: item.positionSide, positionAmt: item.positionAmt }]);
    assert.equal(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: item.side, positionSide: item.positionSide }), "", authority), null);
    const params = new URLSearchParams(authority.normalizedBody);
    assert.equal(params.get("positionSide"), item.positionSide);
    assert.equal(params.get("side"), item.side);
    assert.equal(params.has("reduceOnly"), false);
  }
});

test("EXIT_ONLY 双向模式拒绝错误 side、错误 positionSide 与上游非法 reduceOnly", () => {
  const positions = [{ symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "3" }, { symbol: "BTCUSDT", positionSide: "SHORT", positionAmt: "-4" }];
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "BUY", positionSide: "LONG" }), "", exitAuthority(positions)), /方向/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true" }), "", exitAuthority(positions)), /positionSide/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "LONG", reduceOnly: "true" }), "", exitAuthority(positions)), /reduceOnly/);
});

test("EXIT_ONLY 限价保护单必须使用 GTC，ENTRY 保持 GTX 且不能伪装为退出", () => {
  const authority = exitAuthority([{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "2" }]);
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true", type: "LIMIT", price: "100", timeInForce: "GTC" }), "", authority), null);
  assert.equal(new URLSearchParams(authority.normalizedBody).get("timeInForce"), "GTC");
  const entry = new URLSearchParams({ symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "99", quantity: "1", positionSide: "BOTH", newClientOrderId: "webEntry001", workbenchOrderIntent: "ENTRY" }).toString();
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", entry), null);
  const maliciousEntry = new URLSearchParams({ symbol: "BTCUSDT", side: "SELL", type: "LIMIT", timeInForce: "GTX", price: "99", quantity: "1", positionSide: "BOTH", reduceOnly: "true", newClientOrderId: "webEntry002", workbenchOrderIntent: "ENTRY" }).toString();
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", maliciousEntry), /ENTRY/);
});

test("EXIT_ONLY 从未成交剩余量预留聚合 GTC 退出，并且只安全 clamp 可用部分", () => {
  const authority = exitAuthority(
    [{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "10" }],
    [
      { symbol: "BTCUSDT", positionSide: "BOTH", side: "SELL", reduceOnly: true, origQty: "4", executedQty: "0", status: "NEW" },
      { symbol: "BTCUSDT", positionSide: "BOTH", side: "SELL", reduceOnly: true, origQty: "3", executedQty: "0", status: "PARTIALLY_FILLED" },
    ],
  );
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true", quantity: "10" }), "", authority), null);
  assert.equal(new URLSearchParams(authority.normalizedBody).get("quantity"), "3");
});

test("EXIT_ONLY 拒绝已预留全部仓位、无法量化订单和 closePosition 订单", () => {
  const rows = [{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "10" }];
  const request = orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true", quantity: "1" });
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", request, "", exitAuthority(rows, [
    { symbol: "BTCUSDT", positionSide: "BOTH", side: "SELL", reduceOnly: true, origQty: "10", executedQty: "0", status: "NEW" },
  ])), /可用退出仓位/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", request, "", exitAuthority(rows, [
    { symbol: "BTCUSDT", positionSide: "BOTH", side: "SELL", reduceOnly: true, origQty: "4", executedQty: "NaN", status: "NEW" },
  ])), /openOrders/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", request, "", exitAuthority(rows, [
    { symbol: "BTCUSDT", positionSide: "BOTH", side: "SELL", reduceOnly: true, closePosition: true, status: "NEW" },
  ])), /openOrders/);
});

test("EXIT_ONLY 遇到无法判定终态的权威 openOrder 必须 fail closed", () => {
  const rows = [{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "10" }];
  const request = orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true", quantity: "1" });
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", request, "", exitAuthority(rows, [
    { symbol: "BTCUSDT", positionSide: "BOTH", side: "SELL", reduceOnly: true, origQty: "4", executedQty: "0", status: "UNKNOWN" },
  ])), /openOrders/);
});

test("EXIT_ONLY 使用部分成交后的剩余数量，取消和完全成交订单不预留", () => {
  const authority = exitAuthority(
    [{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "10" }],
    [
      { symbol: "BTCUSDT", positionSide: "BOTH", side: "SELL", reduceOnly: true, origQty: "4", executedQty: "1.5", status: "PARTIALLY_FILLED" },
      { symbol: "BTCUSDT", positionSide: "BOTH", side: "SELL", reduceOnly: true, origQty: "5", executedQty: "0", status: "CANCELED" },
      { symbol: "BTCUSDT", positionSide: "BOTH", side: "SELL", reduceOnly: true, origQty: "2", executedQty: "2", status: "FILLED" },
    ],
  );
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true", quantity: "10" }), "", authority), null);
  assert.equal(new URLSearchParams(authority.normalizedBody).get("quantity"), "7.5");
});

test("EXIT_ONLY 对重复或冲突权威仓位行及 closePosition 请求 fail closed", () => {
  const request = orderBody({ side: "SELL", positionSide: "BOTH", reduceOnly: "true", quantity: "1" });
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", request, "", exitAuthority([
    { symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "10" },
    { symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "10" },
  ])), /权威仓位/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", request, "", exitAuthority([
    { symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "10" },
    { symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "10" },
  ])), /权威仓位/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", `${request}&closePosition=true`, "", exitAuthority([
    { symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "10" },
  ])), /closePosition/);
});
