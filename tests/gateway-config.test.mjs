// tests/gateway-config.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { getGatewayConfig, probeGateway } from "../lib/binance-gateway.ts";

function withEnv(updates, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(updates)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("网关配置需要 baseUrl 与至少 16 位 token", () => {
  withEnv({ BINANCE_GATEWAY_BASE_URL: undefined, BINANCE_GATEWAY_TOKEN: undefined }, () => {
    assert.equal(getGatewayConfig().configured, false);
  });
  withEnv({ BINANCE_GATEWAY_BASE_URL: "http://203.0.113.10:8788", BINANCE_GATEWAY_TOKEN: "short" }, () => {
    assert.equal(getGatewayConfig().configured, false);
  });
  withEnv({ BINANCE_GATEWAY_BASE_URL: "http://203.0.113.10:8788", BINANCE_GATEWAY_TOKEN: "0123456789abcdef" }, () => {
    assert.equal(getGatewayConfig().configured, true);
  });
});

test("probeGateway 对本地假网关返回 connected", async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ serverTime: 1234567890123 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const result = await withEnv(
    { BINANCE_GATEWAY_BASE_URL: `http://127.0.0.1:${port}`, BINANCE_GATEWAY_TOKEN: "0123456789abcdef" },
    () => probeGateway(),
  );
  assert.equal(result.configured, true);
  assert.equal(result.connected, true);
});

test("probeGateway 未配置时返回 configured=false", async () => {
  const result = await withEnv(
    { BINANCE_GATEWAY_BASE_URL: undefined, BINANCE_GATEWAY_TOKEN: undefined },
    () => probeGateway(),
  );
  assert.equal(result.configured, false);
  assert.equal(result.connected, false);
});
