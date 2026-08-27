// tests/gateway-config.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import { gatewayRequest, getGatewayConfig, probeGateway } from "../lib/binance-gateway.ts";

const gatewayServerSource = fs.readFileSync(new URL("../binance-gateway/server.mjs", import.meta.url), "utf8");

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

async function withEnvAsync(updates, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(updates)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
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
  withEnv({ BINANCE_GATEWAY_BASE_URL: "http://127.0.0.1:8788", BINANCE_GATEWAY_TOKEN: "0123456789abcdef" }, () => {
    assert.equal(getGatewayConfig().configured, true);
  });
});

test("网关允许读取当前币种的成交历史但不扩大交易权限", () => {
  assert.match(gatewayServerSource, /path: "\/fapi\/v1\/userTrades", methods: \["GET"\], signed: true, trading: false/);
});

test("网关只接受本机回环 HTTP 地址", async () => {
  const token = "0123456789abcdef";
  for (const baseUrl of ["http://203.0.113.10:8788", "https://127.0.0.1:8788", "http://localhost:8788"]) {
    await withEnvAsync({ BINANCE_GATEWAY_BASE_URL: baseUrl, BINANCE_GATEWAY_TOKEN: token }, async () => {
      assert.equal(getGatewayConfig().configured, false, `${baseUrl} 不得作为固定 IP 网关`);
      await assert.rejects(() => gatewayRequest("/fapi/v1/time"), /回环 HTTP/);
    });
  }
  for (const baseUrl of ["http://127.0.0.1:8788", "http://[::1]:8788"]) {
    await withEnvAsync({ BINANCE_GATEWAY_BASE_URL: baseUrl, BINANCE_GATEWAY_TOKEN: token }, async () => {
      assert.equal(getGatewayConfig().configured, true, `${baseUrl} 应为允许的本机网关`);
    });
  }
});

test("probeGateway 对本地假网关返回 connected", async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ serverTime: 1234567890123 }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const result = await withEnvAsync(
    { BINANCE_GATEWAY_BASE_URL: `http://127.0.0.1:${port}`, BINANCE_GATEWAY_TOKEN: "0123456789abcdef" },
    () => probeGateway(),
  );
  assert.equal(result.configured, true);
  assert.equal(result.connected, true);
});

test("probeGateway 未配置时返回安全的断开状态", async () => {
  const result = await withEnvAsync(
    { BINANCE_GATEWAY_BASE_URL: undefined, BINANCE_GATEWAY_TOKEN: undefined },
    () => probeGateway(),
  );
  assert.equal(result.configured, false);
  assert.equal(result.connected, false);
  assert.equal(result.message, "币安网关未配置");
});

test("probeGateway 失败时不泄露网关地址或底层错误", async (t) => {
  const server = http.createServer((_req, res) => {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ message: "internal topology detail" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const result = await withEnvAsync(
    { BINANCE_GATEWAY_BASE_URL: `http://127.0.0.1:${port}`, BINANCE_GATEWAY_TOKEN: "0123456789abcdef" },
    () => probeGateway(),
  );
  assert.equal(result.configured, true);
  assert.equal(result.connected, false);
  assert.equal(result.message, "币安网关不可用");
});
