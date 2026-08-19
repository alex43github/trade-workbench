import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const PORT = 8799;
const TOKEN = "test-token-1234567890";
const BASE = `http://127.0.0.1:${PORT}`;
let child;

test.before(async () => {
  child = spawn(process.execPath, ["server.mjs"], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    env: {
      ...process.env,
      BINANCE_GATEWAY_PORT: String(PORT),
      BINANCE_GATEWAY_TOKEN: TOKEN,
      BINANCE_GATEWAY_API_KEY: "test-key",
      BINANCE_GATEWAY_API_SECRET: "test-secret",
      BINANCE_GATEWAY_TRADING: "false",
      BINANCE_GATEWAY_PUBLIC_IP: "203.0.113.10",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("网关启动超时");
});

test.after(() => { if (child) child.kill("SIGTERM"); });

test("健康检查无需鉴权", async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.service, "binance-gateway");
  assert.equal(body.tradingEnabled, false);
});

test("私有端点未携带 token 返回 401", async () => {
  const res = await fetch(`${BASE}/api/status`);
  assert.equal(res.status, 401);
});

test("携带 token 可访问状态接口", async () => {
  const res = await fetch(`${BASE}/api/status`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.tradingEnabled, false);
  assert.equal(body.configuredPublicIp, "203.0.113.10");
});

test("交易路径在只读模式下被拒绝", async () => {
  const res = await fetch(`${BASE}/api/binance/fapi/v1/order?symbol=BTCUSDT&side=BUY`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.match(body.message, /交易通道已关闭/);
});

test("公开行情经网关转发", async () => {
  const res = await fetch(`${BASE}/api/binance/fapi/v1/time`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.json().catch(() => null);
  assert.ok(body !== null, "网关必须返回可解析 JSON");
  if (res.status === 200) {
    assert.ok(Number.isInteger(body.serverTime));
  } else {
    assert.equal(res.status, 502);
    assert.equal(body.ok, false);
  }
});
