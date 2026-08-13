import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildNotification, notificationKey } from "../lib/structure-radar/notification-policy.ts";
import { BarkClient, loadBarkConfig } from "../services/structure-radar/bark.ts";

const plan = {
  expert: "bitlanglang", entry: { min: 99, max: 100 }, stop: 97, targets: [104, 108],
  management: ["确认后试仓", "只在浮盈和新结构确认后加仓"],
};

function consensus(overrides = {}) {
  return { grade: "3/4", validOpinions: 4, alertPolicy: "FULL_PLAN", executionExpert: "bitlanglang", executionPlan: plan, opposingEvidence: [], ...overrides };
}

function signal(overrides = {}) {
  return {
    id: "BTCUSDT:1h:PLATFORM_RECLAIM:abc", symbol: "BTCUSDT", timeframe: "1h", setup: "PLATFORM_RECLAIM",
    state: "CANDIDATE", stateVersion: 1, close: 100, detectedAt: 100, mode: "live", ...overrides,
  };
}

test("formats candidate and confirmation titles with a full expert plan", () => {
  const candidate = buildNotification(signal(), consensus(), { state: "NO_POSITION" });
  assert.equal(candidate?.title, "[候选] BTCUSDT 平台假跌破收回 · 1h");
  assert.match(candidate?.body ?? "", /执行主案：bitlanglang/);
  assert.match(candidate?.body ?? "", /入场区：99–100/);
  assert.match(candidate?.body ?? "", /止损：97/);
  const confirmed = buildNotification(signal({ state: "CONFIRMED", stateVersion: 2 }), consensus(), { state: "POST_CANDIDATE_POSITION", entryPrice: 99.5 });
  assert.equal(confirmed?.title, "[确认] BTCUSDT 平台假跌破收回 · 1h");
  assert.match(confirmed?.body ?? "", /持仓：候选后持仓/);
});

test("formats add, take-profit, and invalidation notifications", () => {
  assert.match(buildNotification(signal({ state: "ADD_CANDIDATE" }), consensus(), { state: "POST_CANDIDATE_POSITION", entryPrice: 99 })?.title ?? "", /加仓候选/);
  assert.match(buildNotification(signal({ state: "TAKE_PROFIT_WATCH" }), consensus(), { state: "POST_CONFIRM_POSITION", entryPrice: 99 })?.title ?? "", /止盈观察/);
  assert.match(buildNotification(signal({ state: "INVALIDATED" }), consensus(), { state: "NO_POSITION" })?.title ?? "", /失效/);
});

test("removes unified prices for incomplete, shape-only, and major-divergence opinions", () => {
  for (const alertPolicy of ["MECHANICAL_ONLY", "SHAPE_ONLY", "MAJOR_DIVERGENCE"]) {
    const note = buildNotification(signal(), consensus({ alertPolicy, validOpinions: alertPolicy === "MECHANICAL_ONLY" ? 2 : 4 }), { state: "NO_POSITION" });
    assert.doesNotMatch(note?.body ?? "", /入场区|止损：|目标：/);
  }
});

test("never emits add-to-loss or chase instructions", () => {
  assert.equal(buildNotification(signal({ state: "ADD_CANDIDATE", close: 98 }), consensus(), { state: "POST_CANDIDATE_POSITION", side: "LONG", entryPrice: 100 }), null);
  const chased = buildNotification(signal({ close: 103 }), consensus(), { state: "NO_POSITION" });
  assert.match(chased?.body ?? "", /已离开有效入场区，不追/);
  assert.doesNotMatch(chased?.body ?? "", /建议限价/);
});

test("suppresses demo data and uses a stable state-version delivery key", () => {
  assert.equal(buildNotification(signal({ mode: "demo" }), consensus(), { state: "NO_POSITION" }), null);
  assert.equal(notificationKey(signal(), "bark"), "BTCUSDT:1h:PLATFORM_RECLAIM:abc:1:bark");
  assert.notEqual(notificationKey(signal(), "bark"), notificationKey(signal({ stateVersion: 2 }), "bark"));
});

test("Bark client URL-encodes content and delivers a state version once", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bark-store-"));
  const calls = [];
  try {
    const client = new BarkClient({
      enabled: true, baseUrl: "https://api.day.app/device-key", storageDirectory: directory,
      async fetcher(input) { calls.push(String(input)); return new Response(JSON.stringify({ code: 200 }), { status: 200 }); },
    });
    const message = { key: "s:1:bark", title: "候选 BTC/USDT", body: "入场 99–100 & 等待", group: "强势币雷达" };
    assert.equal((await client.sendOnce(message)).status, "delivered");
    assert.equal((await client.sendOnce(message)).status, "duplicate");
    assert.equal(calls.length, 1);
    assert.match(calls[0], /%E5%80%99%E9%80%89%20BTC%2FUSDT/);
    assert.match(calls[0], /%26/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Bark client retries three times with exponential backoff", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bark-retry-"));
  let attempts = 0;
  const delays = [];
  try {
    const client = new BarkClient({
      enabled: true, baseUrl: "https://api.day.app/device-key", storageDirectory: directory,
      async fetcher() { attempts += 1; return new Response("fail", { status: 500 }); },
      async sleep(milliseconds) { delays.push(milliseconds); },
    });
    const result = await client.sendOnce({ key: "failed:1:bark", title: "候选", body: "内容", group: "雷达" });
    assert.equal(result.status, "failed");
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [500, 1_000]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Bark client remains disabled unless explicitly enabled", async () => {
  const client = new BarkClient({ enabled: false, baseUrl: "https://api.day.app/device-key", storageDirectory: "/tmp/unused", async fetcher() { throw new Error("must not call"); } });
  assert.equal((await client.sendOnce({ key: "x", title: "x", body: "x", group: "x" })).status, "disabled");
});

test("loads Bark URL from environment or existing mobile-push config without exposing it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bark-config-"));
  const path = join(directory, "mobile_push.json");
  try {
    await import("node:fs/promises").then(({ writeFile }) => writeFile(path, JSON.stringify({ bark: { server: "https://api.day.app/device-secret", group: "旧组" } })));
    const fromFile = await loadBarkConfig({ RADAR_NOTIFY_ENABLED: "true", RADAR_BARK_CONFIG_PATH: path });
    assert.equal(fromFile.enabled, true);
    assert.equal(fromFile.baseUrl, "https://api.day.app/device-secret");
    assert.equal(fromFile.group, "旧组");
    const fromEnv = await loadBarkConfig({ RADAR_NOTIFY_ENABLED: "false", BARK_BASE_URL: "https://api.day.app/env-secret" });
    assert.equal(fromEnv.baseUrl, "https://api.day.app/env-secret");
    assert.doesNotMatch(JSON.stringify(fromEnv.publicStatus), /env-secret|device-secret/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
