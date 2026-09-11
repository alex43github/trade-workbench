import assert from "node:assert/strict";
import test from "node:test";

const bybitEnv = {
  BYBIT_GATEWAY_BASE_URL: "http://127.0.0.1:8783",
  BYBIT_GATEWAY_TOKEN: "adapter-test-token-123456",
  BYBIT_GATEWAY_TRADING: "true",
};

function response(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function envelope(result = {}) {
  return { retCode: 0, retMsg: "OK", result };
}

function bybitTransport() {
  const calls = [];
  const request = async (path, init = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ path, init, body });
    if (path === "/v5/order/create") {
      return response(envelope({ orderId: `bybit-${calls.length}`, orderLinkId: body.orderLinkId }));
    }
    return response(envelope({ list: [] }));
  };
  return { calls, request };
}

test("Bybit conditional market orders map TP/SL and LONG/SHORT to the safe trigger direction", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const fake = bybitTransport();
  const adapter = new BybitLiveAdapter(bybitEnv, { request: fake.request });
  const cases = [
    { strategyType: "TP", positionSide: "LONG", positionIdx: 1, side: "SELL", triggerPrice: "110", triggerDirection: 1, orderLinkId: "webBYtpLong" },
    { strategyType: "SL", positionSide: "LONG", positionIdx: 1, side: "SELL", triggerPrice: "90", triggerDirection: 2, orderLinkId: "webBYslLong" },
    { strategyType: "TP", positionSide: "SHORT", positionIdx: 2, side: "BUY", triggerPrice: "90", triggerDirection: 2, orderLinkId: "webBYtpShort" },
    { strategyType: "SL", positionSide: "SHORT", positionIdx: 2, side: "BUY", triggerPrice: "110", triggerDirection: 1, orderLinkId: "webBYslShort" },
  ];

  for (const item of cases) {
    await adapter.submitReduceOnlyConditionalMarket({
      symbol: "btcusdt",
      side: item.side,
      type: "MARKET",
      quantity: "0.010",
      triggerPrice: item.triggerPrice,
      strategyType: item.strategyType,
      positionIdx: item.positionIdx,
      positionSide: item.positionSide,
      origin: "WEB",
      orderLinkId: item.orderLinkId,
    });
  }

  const creates = fake.calls.filter((call) => call.path === "/v5/order/create");
  assert.equal(creates.length, cases.length);
  for (const [index, item] of cases.entries()) {
    assert.deepEqual(creates[index].body, {
      category: "linear",
      symbol: "BTCUSDT",
      side: item.side === "SELL" ? "Sell" : "Buy",
      orderType: "Market",
      qty: "0.010",
      triggerDirection: item.triggerDirection,
      triggerPrice: item.triggerPrice,
      positionIdx: item.positionIdx,
      orderLinkId: item.orderLinkId,
      reduceOnly: true,
      closeOnTrigger: true,
    });
    assert.equal("strategyType" in creates[index].body, false);
  }
});
test("Bybit conditional market orders support one-way positionIdx zero without weakening the close direction", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const fake = bybitTransport();
  const adapter = new BybitLiveAdapter(bybitEnv, { request: fake.request });

  await adapter.submitReduceOnlyConditionalMarket({
    symbol: "BTCUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: "1",
    triggerPrice: 110,
    strategyType: "TP",
    positionIdx: 0,
    positionSide: "BOTH",
    origin: "TELEGRAM",
  });

  const create = fake.calls.find((call) => call.path === "/v5/order/create");
  assert.equal(create.body.positionIdx, 0);
  assert.equal(create.body.triggerDirection, 1);
  assert.match(create.body.orderLinkId, /^teleBY[A-Za-z0-9_-]+$/);
});

test("Bybit conditional market orders generate distinct stable orderLinkIds when none is supplied", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const fake = bybitTransport();
  const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
  const adapter = new BybitLiveAdapter(bybitEnv, { request: fake.request, idFactory: () => ids.shift() });
  const input = {
    symbol: "BTCUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: "1",
    triggerPrice: "110",
    strategyType: "TP",
    positionIdx: 0,
    positionSide: "LONG",
    origin: "WEB",
  };

  await adapter.submitReduceOnlyConditionalMarket(input);
  await adapter.submitReduceOnlyConditionalMarket(input);
  const links = fake.calls.filter((call) => call.path === "/v5/order/create").map((call) => call.body.orderLinkId);
  assert.equal(new Set(links).size, 2);
  assert.match(links[0], /^webBY/);
  assert.match(links[1], /^webBY/);
});

test("Bybit rejects incomplete, inconsistent, or invalid conditional inputs before transport", async () => {
  const { BybitLiveAdapter } = await import("../lib/trade/bybit-live-adapter.ts");
  const fake = bybitTransport();
  const adapter = new BybitLiveAdapter(bybitEnv, { request: fake.request });
  const base = {
    symbol: "BTCUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: "1",
    triggerPrice: "110",
    strategyType: "TP",
    positionIdx: 1,
    positionSide: "LONG",
    origin: "WEB",
  };

  await assert.rejects(() => adapter.submitReduceOnlyConditionalMarket({ ...base, strategyType: "DEFAULT_TP" }), /TP 或 SL/);
  await assert.rejects(() => adapter.submitReduceOnlyConditionalMarket({ ...base, triggerPrice: "0" }), /触发价格/);
  await assert.rejects(() => adapter.submitReduceOnlyConditionalMarket({ ...base, positionIdx: undefined }), /positionIdx/);
  await assert.rejects(() => adapter.submitReduceOnlyConditionalMarket({ ...base, positionIdx: 2, positionSide: "LONG" }), /positionIdx.*持仓方向/);
  await assert.rejects(() => adapter.submitReduceOnlyConditionalMarket({ ...base, side: "BUY" }), /方向与持仓方向/);
  await assert.rejects(() => adapter.submitReduceOnlyConditionalMarket({ ...base, symbol: "BTCUSDC" }), /USDT/);
  assert.equal(fake.calls.length, 0);
});

test("the typed Binance adapter exposes equivalent native TP/SL conditional market orders", async () => {
  const { BinanceLiveAdapter } = await import("../lib/trade/live-exchange-adapter.ts");
  const calls = [];
  const adapter = new BinanceLiveAdapter({
    BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788",
    BINANCE_GATEWAY_TOKEN: "binance-gateway-token-123456",
    BINANCE_GATEWAY_TRADING: "true",
  }, {
    request: async (path, init = {}) => {
      calls.push({ path, init });
      return response({ orderId: "binance-conditional-1", clientOrderId: "webBNconditional", status: "NEW" });
    },
  });

  await adapter.submitReduceOnlyConditionalMarket({
    symbol: "BTCUSDT",
    side: "SELL",
    type: "MARKET",
    quantity: "0.010",
    triggerPrice: "110",
    strategyType: "TP",
    positionIdx: 0,
    positionSide: "BOTH",
    origin: "WEB",
    newClientOrderId: "webBNconditional",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/fapi/v1/order");
  const params = new URLSearchParams(String(calls[0].init.body));
  assert.deepEqual(Object.fromEntries(params), {
    symbol: "BTCUSDT",
    side: "SELL",
    type: "TAKE_PROFIT_MARKET",
    stopPrice: "110",
    quantity: "0.010",
    reduceOnly: "true",
    newClientOrderId: "webBNconditional",
  });
});
