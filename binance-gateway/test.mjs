import test from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = 8799;
const TOKEN = "test-token-1234567890";
const BASE = `http://127.0.0.1:${PORT}`;
let child;
const execFileAsync = promisify(execFile);

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
      BINANCE_GATEWAY_ALLOWED_CLIENT_IP: "127.0.0.1",
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

test("健康检查无需鉴权且只返回已净化的存活状态", async () => {
  const res = await fetch(`${BASE}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body, { ok: true });
});

test("转发头不能覆盖用于白名单的 socket 对端 IP", async () => {
  const res = await fetch(`${BASE}/health`, {
    headers: { "x-forwarded-for": "198.51.100.77" },
  });
  assert.equal(res.status, 200);
});

test("默认只监听 loopback", async () => {
  const { stdout } = await execFileAsync("lsof", ["-nP", "-a", "-p", String(child.pid), "-iTCP:8799", "-sTCP:LISTEN"]);
  assert.match(stdout, /127\.0\.0\.1:8799 \(LISTEN\)/);
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

test("只读网关允许 futures data 公共指标，但不扩大交易权限", async () => {
  const res = await fetch(`${BASE}/api/binance/futures/data/openInterestHist?symbol=BTCUSDT&period=5m&limit=1`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const body = await res.json().catch(() => null);
  assert.ok(body !== null, "网关必须返回可解析 JSON");
  assert.notEqual(res.status, 404, "futures data 必须作为只读公共指标路径转发");
  assert.ok([200, 502].includes(res.status));
});

function runScript(script, args, env) {
  return new Promise((resolve) => {
    const p = spawn("bash", [script, ...args], {
      env: { PATH: process.env.PATH, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });
}

test("notify.sh 无 Bark key 时静默退出", async () => {
  const script = fileURLToPath(new URL("notify.sh", import.meta.url));
  const res = await runScript(script, ["online"], {
    BINANCE_GATEWAY_ENV_FILE: "/nonexistent",
  });
  assert.equal(res.code, 0);
});

test("watchdog 状态翻转后退出码为 0 且状态文件正确", async () => {
  const script = fileURLToPath(new URL("watchdog.sh", import.meta.url));
  const stateFile = path.join(tmpdir(), `binance-gw-watchdog-${process.pid}.state`);
  const baseEnv = {
    BINANCE_GATEWAY_ENV_FILE: "/nonexistent",
    BINANCE_GATEWAY_WATCHDOG_STATE: stateFile,
    BINANCE_GATEWAY_DIR: fileURLToPath(new URL(".", import.meta.url)),
  };
  try {
    // 第一次：目标不通 → 记录为 0，不推送
    let res = await runScript(script, [], {
      ...baseEnv,
      BINANCE_GATEWAY_HEALTH_URL: "http://127.0.0.1:1/health",
    });
    assert.equal(res.code, 0);
    assert.equal(readFileSync(stateFile, "utf8").trim(), "0");
    // 第二次：网关健康 → 翻转为 1（notify.sh 无 key 静默退出）
    res = await runScript(script, [], {
      ...baseEnv,
      BINANCE_GATEWAY_HEALTH_URL: `${BASE}/health`,
    });
    assert.equal(res.code, 0);
    assert.equal(readFileSync(stateFile, "utf8").trim(), "1");
  } finally {
    rmSync(stateFile, { force: true });
  }
});

test("install.sh 会收紧已有 .env 的权限", async () => {
  const install = fileURLToPath(new URL("install.sh", import.meta.url));
  const fixtureDir = mkdtempSync(path.join(tmpdir(), "binance-gw-install-"));
  const binDir = path.join(fixtureDir, "bin");
  const envFile = path.join(fixtureDir, ".env");
  const writeMock = (name, body) => {
    const file = path.join(binDir, name);
    writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(file, 0o755);
  };
  try {
    mkdirSync(binDir);
    writeMock("id", "[ \"${1:-}\" = \"-u\" ] && { echo 0; exit 0; }; exit 1");
    writeMock("useradd", "exit 0");
    writeMock("systemctl", "exit 0");
    writeMock("chown", "exit 0");
    writeMock("sleep", "exit 0");
    writeFileSync(envFile, "BINANCE_GATEWAY_TOKEN=existing-secret\n");
    chmodSync(envFile, 0o644);
    const result = await runScript(install, [], {
      GATEWAY_DIR: fixtureDir,
      VPS_FIXED_IP: "203.0.113.10",
      PATH: `${binDir}:${process.env.PATH}`,
    });
    assert.match(result.out, /\.env 已存在/);
    assert.equal(statSync(envFile).mode & 0o777, 0o600);
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
});
