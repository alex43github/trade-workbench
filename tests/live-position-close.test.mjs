import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-live-position-close-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;
const { buildMarketCloseOrder } = await import("../lib/trade/live-position-close.ts");
const { createLivePositionClosePost } = await import("../app/api/trade/positions/close/route.ts");

const filters = [
  { filterType: "MARKET_LOT_SIZE", stepSize: "0.01", minQty: "0.01" },
  { filterType: "MIN_NOTIONAL", notional: "5" },
];

test("真实多仓按百分比生成反向市价减仓单，并按步长向下取整", () => {
  const order = buildMarketCloseOrder({
    position: { symbol: "BTCUSDT", positionAmt: "12.345", positionSide: "BOTH", markPrice: "100" },
    percent: 25,
    filters,
    clientOrderId: "alexMC1234567890123456789012345678",
  });

  assert.deepEqual(order, {
    symbol: "BTCUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: "3.08",
    reduceOnly: true,
    workbenchOrderIntent: "EXIT_ONLY",
    newClientOrderId: "alexMC1234567890123456789012345678",
  });
});

test("Hedge Mode 只有多仓时指定 LONG 平仓方向，并省略 reduceOnly", () => {
  const order = buildMarketCloseOrder({
    position: { symbol: "ETHUSDC", positionAmt: "1.346", positionSide: "LONG", markPrice: "2500" },
    percent: 100,
    filters: [
      { filterType: "MARKET_LOT_SIZE", stepSize: "0.001", minQty: "0.001" },
      { filterType: "MIN_NOTIONAL", notional: "5" },
    ],
    clientOrderId: "alexMC1234567890123456789012345678",
  });

  assert.deepEqual(order, {
    symbol: "ETHUSDC",
    side: "SELL",
    type: "MARKET",
    quantity: "1.346",
    positionSide: "LONG",
    workbenchOrderIntent: "EXIT_ONLY",
    newClientOrderId: "alexMC1234567890123456789012345678",
  });
});

test("真实空仓使用 BUY，且低于最小名义价值时拒绝下单", () => {
  assert.equal(buildMarketCloseOrder({
    position: { symbol: "DOGEUSDT", positionAmt: "-10", positionSide: "BOTH", markPrice: "10" },
    percent: 10,
    filters: [
      { filterType: "MARKET_LOT_SIZE", stepSize: "1", minQty: "1" },
      { filterType: "MIN_NOTIONAL", notional: "5" },
    ],
    clientOrderId: "alexMC1234567890123456789012345678",
  }).side, "BUY");

  assert.throws(() => buildMarketCloseOrder({
    position: { symbol: "DOGEUSDT", positionAmt: "-10", positionSide: "BOTH", markPrice: "1" },
    percent: 10,
    filters,
    clientOrderId: "alexMC1234567890123456789012345678",
  }), /最小名义价值/);
});

test("真实平仓只接受 10/25/50/75/100 百分比", () => {
  assert.throws(() => buildMarketCloseOrder({
    position: { symbol: "BTCUSDT", positionAmt: "1", positionSide: "BOTH", markPrice: "100" },
    percent: 30,
    filters,
    clientOrderId: "alexMC1234567890123456789012345678",
  }), /平仓比例/);
});

function closeRequest(body) {
  return new Request("http://localhost/api/trade/positions/close", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("服务端重新读取持仓，不信任浏览器数量，并记录真实平仓结果", async () => {
  const orders = [];
  const audits = [];
  const POST = createLivePositionClosePost({
    env: {
      NODE_ENV: "test",
      BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
      BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
      BINANCE_GATEWAY_TRADING: "true",
      WORKBENCH_LIVE_TRADING_ENABLED: "true",
    },
    readPositionRisk: async () => [{ symbol: "BTCUSDT", positionAmt: "4", positionSide: "BOTH", markPrice: "100" }],
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    placeOrder: async (order) => { orders.push(order); return { orderId: 99, clientOrderId: order.newClientOrderId, status: "FILLED", executedQty: order.quantity }; },
    audit: async (record) => { audits.push(record); },
  });

  const response = await POST(closeRequest({
    symbol: "BTCUSDT",
    percent: 25,
    positionSide: "BOTH",
    quantity: 999,
    liveSwitchOn: true,
    confirmation: "CLOSE_MARKET",
    idempotencyKey: "manual-close-server-read-0099",
  }));

  assert.equal(response.status, 200);
  assert.equal(orders[0].quantity, "1");
  assert.equal(orders[0].reduceOnly, true);
  assert.equal(orders[0].workbenchOrderIntent, "EXIT_ONLY");
  assert.equal(audits[0].symbol, "BTCUSDT");
  assert.equal(audits[0].requestedPercent, 25);
});

test("Hedge Mode 平仓请求向 Binance 传递 LONG 持仓方向而不传 reduceOnly", async () => {
  const orders = [];
  const POST = createLivePositionClosePost({
    env: {
      NODE_ENV: "test",
      BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
      BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
      BINANCE_GATEWAY_TRADING: "true",
      WORKBENCH_LIVE_TRADING_ENABLED: "true",
    },
    readPositionRisk: async () => [{ symbol: "ETHUSDC", positionAmt: "1.346", positionSide: "LONG", markPrice: "2500" }],
    readExchangeInfo: async () => ({ symbols: [{ symbol: "ETHUSDC", filters: [
      { filterType: "MARKET_LOT_SIZE", stepSize: "0.001", minQty: "0.001" },
      { filterType: "MIN_NOTIONAL", notional: "5" },
    ] }] }),
    placeOrder: async (order) => { orders.push(order); return { orderId: 100, clientOrderId: order.newClientOrderId, status: "FILLED", executedQty: order.quantity }; },
    audit: async () => {},
  });

  const response = await POST(closeRequest({
    symbol: "ETHUSDC",
    percent: 100,
    positionSide: "LONG",
    liveSwitchOn: true,
    confirmation: "CLOSE_MARKET",
    idempotencyKey: "manual-close-hedge-mode-0099",
  }));

  assert.equal(response.status, 200);
  assert.equal(orders[0].positionSide, "LONG");
  assert.equal("reduceOnly" in orders[0], false);
  assert.equal(orders[0].workbenchOrderIntent, "EXIT_ONLY");
});

test("真实交易开关未同时开启时不调用网关", async () => {
  let called = false;
  const POST = createLivePositionClosePost({
    env: { NODE_ENV: "test", BINANCE_GATEWAY_TRADING: "false", WORKBENCH_LIVE_TRADING_ENABLED: "true" },
    readPositionRisk: async () => { called = true; return []; },
  });
  const response = await POST(closeRequest({ symbol: "BTCUSDT", percent: 100, liveSwitchOn: true, confirmation: "CLOSE_MARKET", idempotencyKey: "manual-close-disabled-0001" }));
  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("网关超时后先按 clientOrderId 查询，找到已下单结果时不重复提交", async () => {
  let placeCount = 0;
  let queryCount = 0;
  const POST = createLivePositionClosePost({
    env: {
      NODE_ENV: "test",
      BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
      BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
      BINANCE_GATEWAY_TRADING: "true",
      WORKBENCH_LIVE_TRADING_ENABLED: "true",
    },
    readPositionRisk: async () => [{ symbol: "BTCUSDT", positionAmt: "4", positionSide: "BOTH", markPrice: "100" }],
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    placeOrder: async () => { placeCount += 1; const error = new Error("转发币安超时"); error.name = "TimeoutError"; throw error; },
    findOrder: async () => { queryCount += 1; return { orderId: 101, clientOrderId: "alexMC1234567890123456789012345678", status: "FILLED", executedQty: "1" }; },
  });
  const response = await POST(closeRequest({ symbol: "BTCUSDT", percent: 25, liveSwitchOn: true, confirmation: "CLOSE_MARKET", idempotencyKey: "manual-close-timeout-0099" }));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(placeCount, 1);
  assert.equal(queryCount, 1);
  assert.equal(payload.recovered, true);
});

test("同一手动平仓幂等键跨重试只提交一次，冲突语义拒绝", async () => {
  let placed = 0;
  let submitted;
  const POST = createLivePositionClosePost({
    env: { NODE_ENV: "test", BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788", BINANCE_GATEWAY_TOKEN: "0123456789abcdef", BINANCE_GATEWAY_TRADING: "true", WORKBENCH_LIVE_TRADING_ENABLED: "true" },
    readPositionRisk: async () => [{ symbol: "BTCUSDT", positionAmt: "4", positionSide: "BOTH", markPrice: "100" }],
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    placeOrder: async (order) => { placed += 1; submitted = order; return { orderId: "manual-idempotent-1", clientOrderId: order.newClientOrderId, status: "FILLED", executedQty: order.quantity }; },
    findOrder: async () => ({ orderId: "manual-idempotent-1", clientOrderId: submitted.newClientOrderId, status: "FILLED", executedQty: submitted.quantity }),
  });
  const body = { symbol: "BTCUSDT", positionSide: "BOTH", percent: 25, liveSwitchOn: true, confirmation: "CLOSE_MARKET", idempotencyKey: "manual-close-retry-stable-0099" };
  assert.equal((await POST(closeRequest(body))).status, 200);
  assert.equal((await POST(closeRequest(body))).status, 200);
  assert.equal(placed, 1);
  assert.equal((await POST(closeRequest({ ...body, percent: 50 }))).status, 409);
});

test("无幂等键的真实手动平仓 fail closed", async () => {
  const POST = createLivePositionClosePost({
    env: { NODE_ENV: "test", BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788", BINANCE_GATEWAY_TOKEN: "0123456789abcdef", BINANCE_GATEWAY_TRADING: "true", WORKBENCH_LIVE_TRADING_ENABLED: "true" },
  });
  assert.equal((await POST(closeRequest({ symbol: "BTCUSDT", percent: 25, liveSwitchOn: true, confirmation: "CLOSE_MARKET" }))).status, 400);
});

test("Binance 拒单返回安全的错误码与说明，不泄漏网关令牌或请求体", async () => {
  const gatewayToken = "gateway-token-secret";
  const requestBody = "symbol=BTCUSDT&quantity=1&signature=private-signature";
  const gatewayError = Object.assign(new Error("网关转发失败"), {
    name: "GatewayError",
    code: -2019,
    msg: "Margin is insufficient",
    requestBody,
    gatewayToken,
  });
  const POST = createLivePositionClosePost({
    env: {
      NODE_ENV: "test",
      BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
      BINANCE_GATEWAY_TOKEN: "0123456789abcdef",
      BINANCE_GATEWAY_TRADING: "true",
      WORKBENCH_LIVE_TRADING_ENABLED: "true",
    },
    readPositionRisk: async () => [{ symbol: "BTCUSDT", positionAmt: "4", positionSide: "BOTH", markPrice: "100" }],
    readExchangeInfo: async () => ({ symbols: [{ symbol: "BTCUSDT", filters }] }),
    placeOrder: async () => { throw gatewayError; },
  });

  const response = await POST(closeRequest({ symbol: "BTCUSDT", percent: 25, liveSwitchOn: true, confirmation: "CLOSE_MARKET", idempotencyKey: "manual-close-rejected-0099" }));
  const payload = await response.json();
  assert.equal(response.status, 502);
  assert.equal(payload.error, "币安拒绝了这次真实平仓请求（代码 -2019）：Margin is insufficient");
  assert.doesNotMatch(payload.error, /gateway-token-secret|private-signature|symbol=BTCUSDT|quantity=1/);
});
