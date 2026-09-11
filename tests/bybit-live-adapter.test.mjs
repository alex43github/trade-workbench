import test from "node:test";
import assert from "node:assert/strict";

const baseUrl = "http://127.0.0.1:8783";
const token = "adapter-test-token-123456";

function env(overrides = {}) {
  return {
    BYBIT_GATEWAY_BASE_URL: baseUrl,
    BYBIT_GATEWAY_TOKEN: token,
    BYBIT_GATEWAY_TRADING: "true",
    ...overrides,
  };
}

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function envelope(result = {}) {
  return { retCode: 0, retMsg: "OK", result };
}

function orderResult(overrides = {}) {
  return {
    orderId: "1001",
    orderLinkId: "webBYfallback",
    symbol: "BTCUSDT",
    side: "Buy",
    orderType: "Limit",
    orderStatus: "New",
    qty: "0.010",
    price: "100.5",
    cumExecQty: "0",
    reduceOnly: false,
    positionIdx: 0,
    ...overrides,
  };
}

function fakeTransport(overrides = {}) {
  const calls = [];
  const request = async (path, init = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, init, body });
    if (overrides.request) return overrides.request({ path, init, body, calls });
    if (path === "/v5/order/create") {
      return response(envelope({ orderId: "1001", orderLinkId: body.orderLinkId }));
    }
    if (path === "/v5/order/realtime" || path === "/v5/order/history") {
      return response(envelope({ list: [] }));
    }
    return response(envelope({ list: [] }));
  };
  return { calls, request };
}

test("resolver exposes an isolated typed Bybit adapter without Binance fallback", async () => {
  const { resolveLiveExchangeAdapter } = await import("../lib/trade/live-exchange-adapter.ts");
  const fake = fakeTransport();
  const adapter = resolveLiveExchangeAdapter("BYBIT", env({
    BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:1",
    BINANCE_GATEWAY_TOKEN: "binance-token-that-must-not-be-used",
  }), { request: fake.request });

  assert.equal(adapter.exchange, "BYBIT");
  for (const method of ["instrument", "account", "position", "openOrders", "submitLimit", "submitReduceOnlyMarket", "cancel", "findByClientId", "closedCandles"]) {
    assert.equal(typeof adapter[method], "function", method);
  }
  assert.equal(fake.calls.length, 0);
});

test("Bybit order history preserves native order ids and follows pagination", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const calls = [];
  const adapter = new BybitLiveAdapter(env(), {
    request: async (path) => {
      calls.push(path);
      if (path.includes("cursor=next-page")) return response(envelope({ list: [{
        orderId: "native-2", symbol: "BTCUSDT", side: "Sell", orderType: "Market", orderStatus: "Filled", qty: "0.5", cumExecQty: "0.5", positionIdx: 0,
      }] }));
      return response(envelope({ list: [{
        orderId: "native-1", symbol: "BTCUSDT", side: "Buy", orderType: "Market", orderStatus: "Filled", qty: "1", cumExecQty: "1", positionIdx: 0,
      }], nextPageCursor: "next-page" }));
    },
  });

  const history = await adapter.orderHistory("BTCUSDT");
  assert.deepEqual(history.map((order) => ({ orderId: order.orderId, clientOrderId: order.clientOrderId, side: order.side, executedQty: order.executedQty })), [
    { orderId: "native-1", clientOrderId: null, side: "BUY", executedQty: "1" },
    { orderId: "native-2", clientOrderId: null, side: "SELL", executedQty: "0.5" },
  ]);
  assert.equal(calls.length, 2);
  assert.match(calls[0], /category=linear/);
  assert.match(calls[0], /symbol=BTCUSDT/);
  assert.match(calls[1], /cursor=next-page/);
});

test("resolver keeps the Binance gateway URL, auth and allowlisted paths isolated from Bybit", async () => {
  const { resolveLiveExchangeAdapter } = await import("../lib/trade/live-exchange-adapter.ts");
  const binanceBaseUrl = "http://127.0.0.1:8788";
  const binanceToken = "binance-gateway-token-123456";
  const bybitBaseUrl = "http://127.0.0.1:8799/api/bybit";
  const bybitToken = "bybit-token-that-must-not-be-used";
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    const pathname = new URL(String(input)).pathname;
    if (pathname.endsWith("/exchangeInfo")) return response({ symbols: [] });
    return response([]);
  };

  try {
    const adapter = resolveLiveExchangeAdapter("BINANCE", {
      BINANCE_GATEWAY_BASE_URL: binanceBaseUrl,
      BINANCE_GATEWAY_TOKEN: binanceToken,
      BINANCE_GATEWAY_TRADING: "false",
      BYBIT_GATEWAY_BASE_URL: bybitBaseUrl,
      BYBIT_GATEWAY_TOKEN: bybitToken,
    });

    assert.equal(adapter.exchange, "BINANCE");
    await adapter.instrument("BTCUSDT");
    await adapter.account();
    await adapter.openOrders("BTCUSDT");
    await adapter.findByClientId({ symbol: "BTCUSDT", clientOrderId: "webBNprobe" });
    await adapter.closedCandles("BTCUSDT", "1h", 2);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.deepEqual(calls.map(({ url, init }) => ({
    method: init.method ?? "GET",
    url,
  })), [
    { method: "GET", url: `${binanceBaseUrl}/api/binance/fapi/v1/exchangeInfo?symbol=BTCUSDT` },
    { method: "GET", url: `${binanceBaseUrl}/api/binance/fapi/v3/account` },
    { method: "GET", url: `${binanceBaseUrl}/api/binance/fapi/v1/openOrders?symbol=BTCUSDT` },
    { method: "GET", url: `${binanceBaseUrl}/api/binance/fapi/v1/order?symbol=BTCUSDT&origClientOrderId=webBNprobe` },
    { method: "GET", url: `${binanceBaseUrl}/api/binance/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=2` },
  ]);
  for (const { init } of calls) {
    assert.equal(new Headers(init.headers).get("authorization"), `Bearer ${binanceToken}`);
  }
  assert.equal(JSON.stringify(calls).includes(bybitBaseUrl), false);
  assert.equal(JSON.stringify(calls).includes(bybitToken), false);
});

test("submitLimit maps Binance-shaped fields to a linear Bybit PostOnly order", async () => {
  const { resolveLiveExchangeAdapter } = await import("../lib/trade/live-exchange-adapter.ts");
  const fake = fakeTransport({
    request: ({ path, body }) => path === "/v5/order/create"
      ? response(envelope({ orderId: "1001", orderLinkId: body.orderLinkId }))
      : response(envelope({ list: [] })),
  });
  const adapter = resolveLiveExchangeAdapter("BYBIT", env(), { request: fake.request });

  const result = await adapter.submitLimit({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "LIMIT",
    timeInForce: "GTX",
    price: "100.5",
    quantity: "0.010",
    origin: "WEB",
  });
  const create = fake.calls.find((call) => call.path === "/v5/order/create");
  assert.deepEqual(create.body, {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Buy",
    orderType: "Limit",
    qty: "0.010",
    price: "100.5",
    timeInForce: "PostOnly",
    positionIdx: 0,
    orderLinkId: create.body.orderLinkId,
  });
  assert.match(create.body.orderLinkId, /^webBY[A-Za-z0-9_-]+$/);
  assert.equal(result.orderId, "1001");
  assert.equal(result.clientOrderId, create.body.orderLinkId);
  assert.equal(result.status, "SUBMITTED");
});

test("submitLimit maps hedge position sides to Bybit positionIdx 1 and 2", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const fake = fakeTransport({
    request: ({ path, body }) => path === "/v5/order/create"
      ? response(envelope({ orderId: body.positionIdx === 1 ? "long" : "short", orderLinkId: body.orderLinkId }))
      : response(envelope({ list: [] })),
  });
  const adapter = new BybitLiveAdapter(env(), { request: fake.request });

  await adapter.submitLimit({
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.01", origin: "WEB", positionSide: "LONG",
  });
  await adapter.submitLimit({
    symbol: "BTCUSDT", side: "SELL", type: "LIMIT", timeInForce: "GTX", price: "101", quantity: "0.01", origin: "WEB", positionIdx: 2,
  });
  const creates = fake.calls.filter((call) => call.path === "/v5/order/create");
  assert.equal(creates[0].body.positionIdx, 1);
  assert.equal(creates[1].body.positionIdx, 2);
  assert.notEqual(creates[0].body.orderLinkId, creates[1].body.orderLinkId);
});

test("adapter create payloads pass the gateway policy for hedge indices and reject every other index", async () => {
  const { normalizeOrderPayload } = await import("../bybit-gateway/order-policy.mjs");
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const fake = fakeTransport({
    request: ({ path, body }) => {
      if (path === "/v5/order/create") {
        const normalized = normalizeOrderPayload("POST", "/v5/order/create", body);
        return response(envelope({ orderId: `idx-${normalized.positionIdx}`, orderLinkId: normalized.orderLinkId }));
      }
      return response(envelope({ list: [] }));
    },
  });
  const adapter = new BybitLiveAdapter(env(), { request: fake.request });

  await adapter.submitLimit({
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.01", origin: "WEB", positionSide: "LONG",
  });
  await adapter.submitLimit({
    symbol: "BTCUSDT", side: "SELL", type: "LIMIT", timeInForce: "GTX", price: "101", quantity: "0.01", origin: "WEB", positionSide: "SHORT",
  });

  const creates = fake.calls.filter((call) => call.path === "/v5/order/create");
  assert.deepEqual(creates.map((call) => call.body.positionIdx), [1, 2]);
  assert.deepEqual(creates.map((call) => normalizeOrderPayload("POST", "/v5/order/create", call.body).positionIdx), [1, 2]);

  const validPayload = (positionIdx) => ({
    category: "linear",
    symbol: "BTCUSDT",
    side: "Buy",
    orderType: "Limit",
    qty: "0.01",
    price: "100",
    timeInForce: "PostOnly",
    positionIdx,
    orderLinkId: "webBYpolicy1",
  });
  for (const positionIdx of [-1, 3, 1.5, "3", "1.0", true, null]) {
    assert.throws(() => normalizeOrderPayload("POST", "/v5/order/create", validPayload(positionIdx)), /positionIdx.*0.*1.*2/);
  }
});

test("submitReduceOnlyMarket emits a Telegram orderLinkId and reduce-only close", async () => {
  const { resolveLiveExchangeAdapter } = await import("../lib/trade/live-exchange-adapter.ts");
  const fake = fakeTransport();
  const adapter = resolveLiveExchangeAdapter("BYBIT", env(), { request: fake.request });

  await adapter.submitReduceOnlyMarket({
    symbol: "BTCUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: "0.010",
    origin: "TELEGRAM",
    positionSide: "SHORT",
  });
  const create = fake.calls.find((call) => call.path === "/v5/order/create");
  assert.deepEqual(create.body, {
    category: "linear",
    symbol: "BTCUSDT",
    side: "Sell",
    orderType: "Market",
    qty: "0.010",
    positionIdx: 2,
    orderLinkId: create.body.orderLinkId,
    reduceOnly: true,
  });
  assert.match(create.body.orderLinkId, /^teleBY[A-Za-z0-9_-]+$/);
});

test("normalizes Bybit reads, cancellation and closed-candle routes to linear paths", async () => {
  const { resolveLiveExchangeAdapter } = await import("../lib/trade/live-exchange-adapter.ts");
  const fake = fakeTransport({
    request: ({ path }) => {
      if (path.startsWith("/v5/market/instruments-info")) {
        return response(envelope({ list: [{ symbol: "BTCUSDT", status: "Trading", baseCoin: "BTC", quoteCoin: "USDT", contractType: "LinearPerpetual", priceFilter: { tickSize: "0.1" }, lotSizeFilter: { qtyStep: "0.001", minOrderQty: "0.001", minOrderAmt: "5" } }] }));
      }
      if (path.startsWith("/v5/account/wallet-balance")) return response(envelope({ list: [{ accountType: "UNIFIED", totalEquity: "100", coin: [{ coin: "USDT", walletBalance: "100", availableToWithdraw: "80" }] }] }));
      if (path.startsWith("/v5/position/list")) return response(envelope({ list: [{ symbol: "BTCUSDT", side: "Buy", size: "0.010", avgPrice: "99", markPrice: "100", unrealisedPnl: "1", leverage: "3", positionIdx: 1 }] }));
      if (path.startsWith("/v5/order/realtime")) return response(envelope({ list: [orderResult({ orderLinkId: "webBY123" })] }));
      if (path === "/v5/order/cancel") return response(envelope({ orderId: "1001", orderLinkId: "webBY123" }));
      if (path.startsWith("/v5/market/kline")) return response(envelope({ list: [["1000", "99", "101", "98", "100", "2", "200"], ["0", "98", "100", "97", "99", "1", "99"]] }));
      return response(envelope({ list: [] }));
    },
  });
  const adapter = resolveLiveExchangeAdapter("BYBIT", env(), { request: fake.request, now: () => 100_000_000_000 });

  const instrument = await adapter.instrument("btcusdt");
  const account = await adapter.account();
  const positions = await adapter.position("BTCUSDT");
  const orders = await adapter.openOrders("BTCUSDT");
  const found = await adapter.findByClientId({ symbol: "BTCUSDT", clientOrderId: "webBY123" });
  const canceled = await adapter.cancel({ symbol: "BTCUSDT", orderLinkId: "webBY123" });
  const candles = await adapter.closedCandles("BTCUSDT", "4h");

  assert.equal(instrument.filters.find((item) => item.filterType === "PRICE_FILTER").tickSize, "0.1");
  assert.equal(account.availableBalance, "80");
  assert.equal(positions[0].positionAmt, "0.010");
  assert.equal(positions[0].positionSide, "LONG");
  assert.equal(orders[0].clientOrderId, "webBY123");
  assert.equal(found.clientOrderId, "webBY123");
  assert.equal(canceled.orderId, "1001");
  assert.equal(candles[0].close, 99);
  assert.match(fake.calls.find((call) => call.path.startsWith("/v5/market/kline")).path, /category=linear&symbol=BTCUSDT&interval=240/);
  assert.match(fake.calls.find((call) => call.path.startsWith("/v5/account/wallet-balance")).path, /category=linear/);
});

test("resolver rejects missing Bybit configuration and unsupported timeframe before transport", async () => {
  const { resolveLiveExchangeAdapter } = await import("../lib/trade/live-exchange-adapter.ts");
  assert.throws(() => resolveLiveExchangeAdapter("BYBIT", {
    BINANCE_GATEWAY_BASE_URL: baseUrl,
    BINANCE_GATEWAY_TOKEN: token,
  }), /BYBIT_GATEWAY/);
  const fake = fakeTransport();
  const adapter = resolveLiveExchangeAdapter("BYBIT", env(), { request: fake.request });
  await assert.rejects(() => adapter.closedCandles("BTCUSDT", "15m"), /Bybit 只支持/);
  assert.equal(fake.calls.length, 0);
});

test("Bybit trading gate and order validation stop mutation before transport", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const fake = fakeTransport();
  const readOnly = new BybitLiveAdapter(env({ BYBIT_GATEWAY_TRADING: "false" }), { request: fake.request });
  await assert.rejects(() => readOnly.submitLimit({
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.01", origin: "WEB",
  }), /交易通道/);
  const adapter = new BybitLiveAdapter(env(), { request: fake.request });
  await assert.rejects(() => adapter.submitLimit({
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTC", price: "100", quantity: "0.01", origin: "WEB",
  }), /GTX/);
  assert.equal(fake.calls.length, 0);
});

test("a supplied client ID keeps the same Bybit namespace and remains stable across submits", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const fake = fakeTransport();
  const adapter = new BybitLiveAdapter(env(), { request: fake.request });
  await adapter.submitLimit({
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.01", origin: "WEB", newClientOrderId: "webINstable-1",
  });
  await adapter.submitLimit({
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.01", origin: "WEB", newClientOrderId: "webINstable-1",
  });
  const creates = fake.calls.filter((call) => call.path === "/v5/order/create");
  assert.equal(creates[0].body.orderLinkId, "webBYstable-1");
  assert.equal(creates[1].body.orderLinkId, "webBYstable-1");
});

test("Bybit response errors are sanitized without exposing gateway credentials", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const secret = "adapter-secret-that-must-not-leak";
  const adapter = new BybitLiveAdapter(env({ BYBIT_GATEWAY_TOKEN: secret }), {
    request: async () => response(envelope({}), 502),
  });
  await assert.rejects(() => adapter.account(), (error) => {
    assert.match(String(error), /HTTP 502/);
    assert.equal(String(error).includes(secret), false);
    return true;
  });
});

test("Bybit maps actual position margin and read-only realized execution PnL", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const calls = [];
  const adapter = new BybitLiveAdapter(env(), {
    request: async (path) => {
      calls.push(path);
      if (path.startsWith("/v5/position/list")) {
        return response(envelope({ list: [{
          symbol: "FILUSDT", side: "Buy", positionIdx: 0, size: "381.8", avgPrice: "0.798047",
          markPrice: "0.8139", unrealisedPnl: "6.05", leverage: "10", positionIM: "31.08",
        }] }));
      }
      if (path.startsWith("/v5/execution/list")) {
        return response(envelope({ list: [{ symbol: "FILUSDT", execPnl: "6.05" }] }));
      }
      return response(envelope({ list: [] }));
    },
  });

  const [positions, executions] = await Promise.all([adapter.allPositions(), adapter.executionHistory()]);
  assert.equal(positions[0].positionIM, "31.08");
  assert.deepEqual(executions, [{ symbol: "FILUSDT", realizedPnl: "6.05" }]);
  assert.ok(calls.some((path) => path.startsWith("/v5/execution/list?category=linear&limit=100")));
});

test("an ambiguous create checks the same orderLinkId and never creates a second order", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  let createCalls = 0;
  let lookupCalls = 0;
  let linkId;
  const adapter = new BybitLiveAdapter(env(), {
    request: async (path, init = {}) => {
      const body = init.body ? JSON.parse(String(init.body)) : null;
      if (path === "/v5/order/create") {
        createCalls += 1;
        linkId = body.orderLinkId;
        throw new DOMException("timed out", "TimeoutError");
      }
      if (path.startsWith("/v5/order/realtime")) {
        lookupCalls += 1;
        return response(envelope({ list: [orderResult({ orderId: "1002", orderLinkId: linkId })] }));
      }
      return response(envelope({ list: [] }));
    },
  });

  const result = await adapter.submitLimit({
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.01", origin: "WEB",
  });
  assert.equal(createCalls, 1);
  assert.equal(lookupCalls, 1);
  assert.equal(result.orderId, "1002");
  assert.equal(result.clientOrderId, linkId);
});

test("an unconfirmed create returns UNKNOWN with its stable client ID and no retry", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  let createCalls = 0;
  const fake = fakeTransport({
    request: ({ path }) => {
      if (path === "/v5/order/create") {
        createCalls += 1;
        throw new DOMException("timed out", "TimeoutError");
      }
      return response(envelope({ list: [] }));
    },
  });
  const adapter = new BybitLiveAdapter(env(), { request: fake.request });
  const result = await adapter.submitLimit({
    symbol: "BTCUSDT", side: "BUY", type: "LIMIT", timeInForce: "GTX", price: "100", quantity: "0.01", origin: "WEB", newClientOrderId: "webINstable-1",
  });

  assert.equal(createCalls, 1);
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.orderId, null);
  assert.match(result.clientOrderId, /^webBY/);
});
