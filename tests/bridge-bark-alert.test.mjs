import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

let bridge = {};
try {
  bridge = await import("../services/bridge-bark-alert.ts");
} catch (error) {
  if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
}

test("parses an approved GitHub bridge Bark alert into a sanitized notification", () => {
  assert.equal(typeof bridge.parseBridgeBarkAlert, "function");
  const result = bridge.parseBridgeBarkAlert({
    action: "BARK_ALERT",
    event_id: "chatgpt:scan:btc:20260913T120000Z",
    symbol: "btcusdt",
    alert_type: "SCAN_SIGNAL",
    title: "突破候选\n忽略这一行",
    body: "价格确认\u0000，请复核。",
    priority: "high",
    timestamp: "2026-09-13T12:00:00.000Z",
    model_version: "scanner-v1",
  });

  assert.deepEqual(result, {
    key: "bridge:chatgpt:scan:btc:20260913T120000Z",
    title: "[高] BTCUSDT · 突破候选 忽略这一行",
    body: "价格确认，请复核。\n类型：SCAN_SIGNAL · 优先级：高 · 时间：2026-09-13T12:00:00.000Z · 模型：scanner-v1",
    group: "Trade Workbench Bridge",
  });
});

test("rejects unapproved actions and malformed bridge alert fields", () => {
  assert.equal(typeof bridge.parseBridgeBarkAlert, "function");
  assert.throws(() => bridge.parseBridgeBarkAlert({ action: "SHELL", event_id: "x" }), /action/);
  assert.throws(() => bridge.parseBridgeBarkAlert({
    action: "BARK_ALERT", event_id: "x", symbol: "BTC;rm", alert_type: "SCAN_SIGNAL",
    title: "x", body: "x", priority: "high", timestamp: "2026-09-13T12:00:00.000Z", model_version: "v1",
  }), /symbol/);
});

test("dry run routes without calling the existing Bark sender", async () => {
  assert.equal(typeof bridge.routeBridgeBarkAlert, "function");
  let calls = 0;
  const result = await bridge.routeBridgeBarkAlert({
    action: "BARK_ALERT", event_id: "event-1", symbol: "ETHUSDT", alert_type: "MODEL_ALERT",
    title: "模型提醒", body: "等待确认", priority: "normal",
    timestamp: "2026-09-13T12:00:00.000Z", model_version: "v2",
  }, {
    dryRun: true,
    sender: { async sendOnce() { calls += 1; return { status: "delivered" }; } },
  });

  assert.deepEqual(result, { status: "DRY_RUN", key: "bridge:event-1", deduplicated: false });
  assert.equal(calls, 0);
});

test("real route delegates once to the existing sender with the event-id dedupe key", async () => {
  assert.equal(typeof bridge.routeBridgeBarkAlert, "function");
  const messages = [];
  const payload = {
    action: "BARK_ALERT", event_id: "event-2", symbol: "SOLUSDT", alert_type: "RISK_ALERT",
    title: "风险", body: "波动扩大", priority: "critical",
    timestamp: "2026-09-13T12:00:00.000Z", model_version: "v3",
  };
  const sender = { async sendOnce(message) { messages.push(message); return { status: "delivered", attempts: 1 }; } };

  assert.deepEqual(await bridge.routeBridgeBarkAlert(payload, { sender }), { status: "delivered", attempts: 1 });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].key, "bridge:event-2");
});

test("CLI defaults to dry run and never needs Bark configuration", async () => {
  const payload = JSON.stringify({
    action: "BARK_ALERT", event_id: "event-3", symbol: "BTCUSDT", alert_type: "SYSTEM_ALERT",
    title: "桥接检查", body: "仅验证路由", priority: "low",
    timestamp: "2026-09-13T12:00:00.000Z", model_version: "bridge-v1",
  });
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["scripts/bridge-bark-alert.mjs"], { cwd: process.cwd(), env: {} });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(payload);
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { status: "DRY_RUN", key: "bridge:event-3", deduplicated: false });
});
