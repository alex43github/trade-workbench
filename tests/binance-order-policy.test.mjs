import assert from "node:assert/strict";
import test from "node:test";

const oneWayAuthority = {
  positionRows: [{ symbol: "BTCUSDT", positionSide: "BOTH", positionAmt: "1" }],
  openOrders: [],
};
const hedgeAuthority = {
  positionRows: [{ symbol: "ETHUSDC", positionSide: "LONG", positionAmt: "1.346" }],
  openOrders: [],
};

test("allows only reduce-only market and native protective conditional order payloads", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const market = new URLSearchParams({ symbol: "BTCUSDT", side: "SELL", type: "MARKET", quantity: "0.01", reduceOnly: "true", newClientOrderId: "alexSL00000001", workbenchOrderIntent: "EXIT_ONLY" }).toString();
  const takeProfit = new URLSearchParams({ symbol: "BTCUSDT", side: "SELL", type: "TAKE_PROFIT_MARKET", stopPrice: "110", quantity: "0.01", reduceOnly: "true", newClientOrderId: "alexTP00000001", workbenchOrderIntent: "EXIT_ONLY" }).toString();
  const stop = new URLSearchParams({ symbol: "BTCUSDT", side: "SELL", type: "STOP_MARKET", stopPrice: "90", quantity: "0.01", reduceOnly: "true", newClientOrderId: "alexSL00000002", workbenchOrderIntent: "EXIT_ONLY" }).toString();
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", market, "", { ...oneWayAuthority }), null);
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", takeProfit, "", { ...oneWayAuthority }), null);
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", stop, "", { ...oneWayAuthority }), null);
});

test("allows a Hedge Mode market close with an explicit position side and no reduceOnly", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const market = new URLSearchParams({ symbol: "ETHUSDC", side: "SELL", type: "MARKET", quantity: "1.346", positionSide: "LONG", newClientOrderId: "alexMC1234567890123456789012345678", workbenchOrderIntent: "EXIT_ONLY" }).toString();
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", market, "", { ...hedgeAuthority }), null);
});

test("allows Hedge Mode protective orders with positionSide and without reduceOnly", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const stop = new URLSearchParams({ symbol: "ETHUSDC", side: "SELL", type: "STOP_MARKET", stopPrice: "2400", quantity: "1.346", positionSide: "LONG", newClientOrderId: "webSL1234567890123456789012345678", workbenchOrderIntent: "EXIT_ONLY" }).toString();
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", stop, "", { ...hedgeAuthority }), null);
});

test("allows a Unicode Binance symbol for a short breakout stop and preserves the encoded symbol", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const authority = { positionRows: [{ symbol: "龙虾USDT", positionSide: "BOTH", positionAmt: "-1123" }], openOrders: [] };
  const stop = new URLSearchParams({
    symbol: "龙虾USDT", side: "BUY", type: "STOP_MARKET", stopPrice: "0.12", quantity: "1123",
    reduceOnly: "true", newClientOrderId: "alexSL00000088", workbenchOrderIntent: "EXIT_ONLY",
  }).toString();
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", stop, "", authority), null);
  const normalized = new URLSearchParams(authority.normalizedBody);
  assert.equal(normalized.get("symbol"), "龙虾USDT");
  assert.equal(normalized.get("side"), "BUY");
  assert.equal(normalized.get("reduceOnly"), "true");
  assert.equal(normalized.get("workbenchOrderIntent"), null);
});

test("allows only server-marked market entries for Hedge Mode", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const entry = new URLSearchParams({
    symbol: "BTCUSDT", side: "BUY", type: "MARKET", quantity: "0.01", positionSide: "LONG",
    newClientOrderId: "webMKabcdef0123456789abcdef012345", workbenchOrderIntent: "ENTRY",
  }).toString();
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", entry), null);
  const unmarked = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(entry)) });
  unmarked.delete("workbenchOrderIntent");
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", unmarked.toString()), /ENTRY/);
  const arbitrary = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(entry)), newClientOrderId: "webINabcdef0123456789abcdef012345" }).toString();
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", arbitrary), /订单参数/);
  const oneWay = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(entry)), positionSide: "BOTH" }).toString();
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", oneWay), /订单参数/);
  const reduceOnly = new URLSearchParams({ ...Object.fromEntries(new URLSearchParams(entry)), reduceOnly: "false" }).toString();
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", reduceOnly), /订单参数|不得携带/);
});

test("requires an explicit position side on every Post Only entry order", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const base = { symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.01", newClientOrderId: "webIN10000001", workbenchOrderIntent: "ENTRY" };
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", new URLSearchParams(base).toString()), /订单参数/);
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", new URLSearchParams({ ...base, positionSide: "LONG" }).toString()), null);
  assert.equal(validateOrderPayload("POST", "/fapi/v1/order", new URLSearchParams({ ...base, positionSide: "BOTH" }).toString()), null);
});

test("rejects conditional orders without reduce-only protection or trigger price", async () => {
  const { validateOrderPayload } = await import("../binance-gateway/order-policy.mjs");
  const base = { symbol: "BTCUSDT", side: "SELL", quantity: "0.01", newClientOrderId: "alexTP00000003", workbenchOrderIntent: "EXIT_ONLY" };
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", new URLSearchParams({ ...base, type: "TAKE_PROFIT_MARKET", reduceOnly: "false", stopPrice: "110" }).toString(), "", { ...oneWayAuthority }), /必须 reduceOnly/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", new URLSearchParams({ ...base, type: "STOP_MARKET", reduceOnly: "true" }).toString(), "", { ...oneWayAuthority }), /stopPrice/);
  assert.match(validateOrderPayload("POST", "/fapi/v1/order", new URLSearchParams({ ...base, type: "TRAILING_STOP_MARKET", reduceOnly: "true" }).toString(), "", { ...oneWayAuthority }), /不被允许/);
});
