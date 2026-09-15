import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-telegram-webhook-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

async function withEnv(values, action) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return await action(); } finally {
    for (const [key, value] of Object.entries(previous)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

function update() {
  return { update_id: 811, message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/start" } };
}

test("Telegram webhook rejects wrong path or secret before handling an update", async () => {
  const { POST } = await import("../app/api/telegram/webhook/[path]/route.ts");
  await withEnv({ TELEGRAM_WEBHOOK_PATH: "path_abcdefgh", TELEGRAM_WEBHOOK_SECRET: "secret_abcdefgh", TELEGRAM_ALLOWED_USER_ID: "42" }, async () => {
    const response = await POST(new Request("https://app.test/api/telegram/webhook/wrong", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "secret_abcdefgh" }, body: JSON.stringify(update()) }), { params: Promise.resolve({ path: "wrong" }) });
    assert.equal(response.status, 401);
  });
});

test("Telegram webhook accepts one authorized private update and deduplicates a replay", async () => {
  const { POST } = await import("../app/api/telegram/webhook/[path]/route.ts");
  await withEnv({ TELEGRAM_WEBHOOK_PATH: "path_abcdefgh", TELEGRAM_WEBHOOK_SECRET: "secret_abcdefgh", TELEGRAM_ALLOWED_USER_ID: "42" }, async () => {
    const request = () => new Request("https://app.test/api/telegram/webhook/path_abcdefgh", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "secret_abcdefgh" }, body: JSON.stringify(update()) });
    assert.equal((await POST(request(), { params: Promise.resolve({ path: "path_abcdefgh" }) })).status, 200);
    assert.equal((await POST(request(), { params: Promise.resolve({ path: "path_abcdefgh" }) })).status, 200);
  });
});

test("Telegram webhook sends one private home reply only for a newly claimed update", async () => {
  const { POST } = await import("../app/api/telegram/webhook/[path]/route.ts");
  const originalFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  try {
    await withEnv({ TELEGRAM_WEBHOOK_PATH: "path_abcdefgh", TELEGRAM_WEBHOOK_SECRET: "secret_abcdefgh", TELEGRAM_ALLOWED_USER_ID: "42", TELEGRAM_BOT_TOKEN: "123456:abcdefghijklmnopqrstuvwx" }, async () => {
      const message = { update_id: 812, message: { chat: { id: 42, type: "private" }, from: { id: 42 }, text: "/start" } };
      const request = () => new Request("https://app.test/api/telegram/webhook/path_abcdefgh", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "secret_abcdefgh" }, body: JSON.stringify(message) });
      assert.equal((await POST(request(), { params: Promise.resolve({ path: "path_abcdefgh" }) })).status, 200);
      assert.equal((await POST(request(), { params: Promise.resolve({ path: "path_abcdefgh" }) })).status, 200);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(sent.length, 1);
  assert.match(sent[0].url, /api\.telegram\.org\/bot123456:.*\/sendMessage/);
  assert.match(sent[0].body.text, /交易机器人/);
  assert.deepEqual(sent[0].body.reply_markup.keyboard.map((row) => row.map((button) => button.text)), [
    ["⚡ 默认下单", "⚙️ 完整策略"],
    ["📊 实盘持仓", "📋 实盘挂单"],
    ["🛡️ 手动持仓保护", "🗂️ 策略管理"],
    ["🛡️ 止损保护管理"],
    ["❌ 取消/主菜单"],
  ]);
  assert.equal(sent[0].body.reply_markup.is_persistent, true);
});

test("Telegram webhook rejects an unapproved account", async () => {
  const { POST } = await import("../app/api/telegram/webhook/[path]/route.ts");
  await withEnv({ TELEGRAM_WEBHOOK_PATH: "path_abcdefgh", TELEGRAM_WEBHOOK_SECRET: "secret_abcdefgh", TELEGRAM_ALLOWED_USER_ID: "7" }, async () => {
    const response = await POST(new Request("https://app.test/api/telegram/webhook/path_abcdefgh", { method: "POST", headers: { "x-telegram-bot-api-secret-token": "secret_abcdefgh" }, body: JSON.stringify(update()) }), { params: Promise.resolve({ path: "path_abcdefgh" }) });
    assert.equal(response.status, 401);
  });
});
