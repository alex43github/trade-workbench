import assert from "node:assert/strict";
import test from "node:test";

import { buildPaperStrategyEventNotification, notifyPaperStrategyEvent, buildTradeEventNotification, resolveBarkBaseUrl, resolveServerBarkBaseUrl } from "../lib/notifications/bark.ts";
import { diffNewCandidates, ma30OiCandidateKey, reversalCandidateKey } from "../lib/radar/alert-diff.ts";

test("Bark URL prefers the configured full endpoint and supports the API key fallback", () => {
  assert.equal(resolveBarkBaseUrl({ BARK_BASE_URL: "https://bark.example/device-key", BARK_API_KEY: "ignored" }), "https://bark.example/device-key");
  assert.equal(resolveBarkBaseUrl({ BARK_API_KEY: "device-key", BARK_SERVER_URL: "https://bark.example" }), "https://bark.example/device-key");
  assert.equal(resolveBarkBaseUrl({ BARK_API_KEY: "device-key" }), "https://api.day.app/device-key");
  assert.equal(resolveBarkBaseUrl({ BARK_API_KEY: "" }), undefined);
});

test("server Bark resolver uses the safely stored endpoint when no environment value is set", async () => {
  const requested = [];
  const barkBaseUrl = await resolveServerBarkBaseUrl({
    env: {},
    getCredential: async (key) => {
      requested.push(key);
      return key === "BARK_BASE_URL" ? "https://bark.example/saved-device-key" : undefined;
    },
  });

  assert.equal(barkBaseUrl, "https://bark.example/saved-device-key");
  assert.deepEqual(requested, ["BARK_BASE_URL"]);
});

test("trade notifications expose stable event keys and clear Chinese event labels", () => {
  const notification = buildTradeEventNotification({
    source: "paper",
    eventId: "trade-123",
    kind: "TAKE_PROFIT",
    symbol: "BTCUSDT",
    side: "LONG",
    price: 70000,
    quantity: 0.1,
  });
  assert.equal(notification.key, "trade:paper:trade-123");
  assert.match(notification.title, /止盈/);
  assert.match(notification.body, /BTC/);
  assert.match(notification.body, /70000/);
});

test("PAPER strategy notifications identify the website strategy/order and action without exposing Bark credentials", () => {
  const notification = buildPaperStrategyEventNotification({
    kind: "GUARD_STOP",
    eventId: "paper:exit:TW-S-21:TW-LOT-8:guard",
    strategyId: "TW-S-21",
    websiteOrderId: "TW-72",
    symbol: "AKEUSDT",
    side: "LONG",
    price: 0.42,
    quantity: 150,
    pnl: -12.6,
    reason: "动态均线守卫",
  });

  assert.equal(notification.key, "strategy:paper:paper:exit:TW-S-21:TW-LOT-8:guard");
  assert.match(notification.title, /策略止损/);
  assert.match(notification.body, /AKE/);
  assert.match(notification.body, /TW-S-21/);
  assert.match(notification.body, /TW-72/);
  assert.match(notification.body, /价格 0.42/);
  assert.match(notification.body, /数量 150/);
  assert.match(notification.body, /毛盈亏 -12.6/);
  assert.doesNotMatch(notification.body, /bark|api\.day|device-key/i);
});

test("unconfigured PAPER strategy Bark returns SKIPPED before touching delivery storage", async () => {
  const previousBaseUrl = process.env.BARK_BASE_URL;
  const previousApiKey = process.env.BARK_API_KEY;
  try {
    delete process.env.BARK_BASE_URL;
    delete process.env.BARK_API_KEY;
    const result = await notifyPaperStrategyEvent({
      db: null,
      event: { kind: "EXPIRED", eventId: "TW-S-22:expired", strategyId: "TW-S-22", symbol: "AKEUSDT" },
    });
    assert.deepEqual(result, { status: "SKIPPED", reason: "Bark is not configured" });
  } finally {
    if (previousBaseUrl === undefined) delete process.env.BARK_BASE_URL;
    else process.env.BARK_BASE_URL = previousBaseUrl;
    if (previousApiKey === undefined) delete process.env.BARK_API_KEY;
    else process.env.BARK_API_KEY = previousApiKey;
  }
});

test("radar alerts only include candidates absent from the previous scan", () => {
  const current = [{ symbol: "BTCUSDT" }, { symbol: "ETHUSDT" }];
  const previous = [{ symbol: "BTCUSDT" }];
  assert.deepEqual(diffNewCandidates(current, previous, ma30OiCandidateKey), [{ symbol: "ETHUSDT" }]);
});

test("reversal dedupe includes interval, direction, and closed signal time", () => {
  const previous = [{ symbol: "BTCUSDT", interval: "4h", direction: "LONG", signalTime: "2026-08-20T04:00:00Z" }];
  const current = [
    ...previous,
    { symbol: "BTCUSDT", interval: "4h", direction: "SHORT", signalTime: "2026-08-20T04:00:00Z" },
    { symbol: "BTCUSDT", interval: "4h", direction: "LONG", signalTime: "2026-08-20T08:00:00Z" },
  ];
  assert.equal(reversalCandidateKey(current[0]), "BTCUSDT:4h:LONG:2026-08-20T04:00:00Z");
  assert.deepEqual(diffNewCandidates(current, previous, reversalCandidateKey), current.slice(1));
});
