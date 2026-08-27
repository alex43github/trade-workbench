import assert from "node:assert/strict";
import test from "node:test";

async function withEnv(values, action) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return await action(); } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

test("website gateway client only permits the narrow server gateway contract", async () => {
  const { gatewayRequest } = await import("../lib/binance-gateway.ts");
  await withEnv({ BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788", BINANCE_GATEWAY_TOKEN: "gateway-token-123456" }, async () => {
    await assert.rejects(() => gatewayRequest("/fapi/v1/leverage?symbol=BTCUSDT", { method: "POST" }), /不支持/);
    await assert.rejects(() => gatewayRequest("/fapi/v1/order", { method: "GET" }), (error) => !/不支持/.test(String(error)));
  });
});

test("website gateway client permits source discovery and closed-candle market data reads", async () => {
  const { gatewayRequest } = await import("../lib/binance-gateway.ts");
  await withEnv({ BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788", BINANCE_GATEWAY_TOKEN: "gateway-token-123456" }, async () => {
    await assert.rejects(() => gatewayRequest("/fapi/v1/allOrders?symbol=BTCUSDT"), (error) => !/不支持/.test(String(error)));
    await assert.rejects(() => gatewayRequest("/fapi/v1/klines?symbol=BTCUSDT&interval=1h&limit=2"), (error) => !/不支持/.test(String(error)));
  });
});
