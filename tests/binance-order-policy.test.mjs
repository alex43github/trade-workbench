import assert from "node:assert/strict";
import test from "node:test";

test("allows only reduce-only market and native protective conditional order payloads", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const market = new URLSearchParams({ symbol: "BTCUSDT", side: "SELL", type: "MARKET", quantity: "0.01", reduceOnly: "true", newClientOrderId: "alexSL00000001" }).toString();
  const takeProfit = new URLSearchParams({ symbol: "BTCUSDT", side: "SELL", type: "TAKE_PROFIT_MARKET", stopPrice: "110", quantity: "0.01", reduceOnly: "true", newClientOrderId: "alexTP00000001" }).toString();
  const stop = new URLSearchParams({ symbol: "BTCUSDT", side: "SELL", type: "STOP_MARKET", stopPrice: "90", quantity: "0.01", reduceOnly: "true", newClientOrderId: "alexSL00000002" }).toString();
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", market), null);
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", takeProfit), null);
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", stop), null);
});

test("allows a Hedge Mode market close with an explicit position side and no reduceOnly", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const market = new URLSearchParams({ symbol: "ETHUSDC", side: "SELL", type: "MARKET", quantity: "1.346", positionSide: "LONG", newClientOrderId: "webMC1234567890123456789012345678" }).toString();
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", market), null);
});

test("rejects conditional orders without reduce-only protection or trigger price", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const base = { symbol: "BTCUSDT", side: "SELL", quantity: "0.01", newClientOrderId: "alexTP00000003" };
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", new URLSearchParams({ ...base, type: "TAKE_PROFIT_MARKET", reduceOnly: "false", stopPrice: "110" }).toString()), /订单参数/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", new URLSearchParams({ ...base, type: "STOP_MARKET", reduceOnly: "true" }).toString()), /订单参数/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", new URLSearchParams({ ...base, type: "TRAILING_STOP_MARKET", reduceOnly: "true" }).toString()), /订单参数/);
});
