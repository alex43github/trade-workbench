import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.STREETLIGHT_LOCAL_D1 = path.join(os.tmpdir(), `streetlight-paper-strategy-bark-${process.pid}-${Date.now()}.sqlite`);
process.env.BARK_BASE_URL = "https://bark.invalid/test-device";

const validDraft = {
  symbol: "AKEUSDT", side: "LONG", timeframe: "1h", style: "MA", totalMarginUsdt: 90,
  ma: { kind: "SMA", length: 30 }, atr: { length: 14 },
  legs: [{ atrOffset: 1 }, { atrOffset: 0 }, { atrOffset: -1 }],
  execution: "LIMIT_POST_ONLY", refreshOn: "CLOSED_CANDLE", expiryDays: 7,
};

function strategyClosedCandle(overrides = {}) {
  return {
    id: "1h:paper-bark",
    isNewClosedCandle: true,
    close: 100,
    ma: 100,
    atr: 10,
    timeframe: "1h",
    maKind: "SMA",
    maLength: 30,
    atrLength: 14,
    tickSize: 0.01,
    stepSize: 0.00000001,
    ...overrides,
  };
}

test("PAPER snapshot sends one deduplicated Bark alert when a strategy leg fills", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requests.push(String(input));
    return new Response(JSON.stringify({ code: 200 }), { status: 200 });
  };
  try {
    const { createStrategy } = await import("../lib/trade/strategies.ts");
    const { getPaperSnapshot } = await import("../lib/paper.ts");
    const strategy = await createStrategy({ ...validDraft, idempotencyKey: "paper-bark-filled-leg" });
    const input = {
      symbol: "AKEUSDT", quotedPrice: 105, quoteMode: "live",
      closedCandle: strategyClosedCandle({ id: "1h:paper-bark-entry" }),
    };

    await getPaperSnapshot(input);
    await getPaperSnapshot(input);

    assert.equal(requests.length, 1);
    const payload = decodeURIComponent(requests[0]);
    assert.match(payload, /策略限价成交/);
    assert.match(payload, new RegExp(strategy.id));
    assert.match(payload, /网站订单 TW-\d+/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("PAPER snapshot notifies profit exits, guard stops, expiry, and final remaining-entry cancellation", async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    requests.push(decodeURIComponent(String(input)));
    return new Response(JSON.stringify({ code: 200 }), { status: 200 });
  };
  try {
    const { getD1 } = await import("../db/index.ts");
    const { createStrategy } = await import("../lib/trade/strategies.ts");
    const { getPaperSnapshot } = await import("../lib/paper.ts");
    const profit = await createStrategy({ ...validDraft, symbol: "PROFITUSDT", idempotencyKey: "paper-bark-profit" });
    const guarded = await createStrategy({
      ...validDraft, symbol: "GUARDUSDT", style: "HORIZONTAL", horizontalEntry: { price: 100 }, legs: [{ atrOffset: 0 }],
      horizontalGuard: { price: 90, confirmationCandles: 1 }, idempotencyKey: "paper-bark-guard",
    });
    const expired = await createStrategy({ ...validDraft, symbol: "EXPIREUSDT", idempotencyKey: "paper-bark-expired" });
    await (await getD1()).prepare("UPDATE trade_strategies SET expires_at = '1970-01-01 00:00:00' WHERE id = ?").bind(expired.id).run();

    await getPaperSnapshot({
      symbol: "PROFITUSDT", quotedPrice: 105, quoteMode: "live",
      closedCandle: strategyClosedCandle({ id: "1h:paper-bark-profit-entry" }),
    });
    await getPaperSnapshot({ symbol: "PROFITUSDT", quotedPrice: 220, quoteMode: "live" });
    await getPaperSnapshot({ symbol: "GUARDUSDT", quotedPrice: 100, quoteMode: "live" });
    await getPaperSnapshot({
      symbol: "GUARDUSDT", quotedPrice: 89, quoteMode: "live",
      closedCandle: strategyClosedCandle({ id: "1h:paper-bark-guard", close: 89 }),
    });

    assert.ok(requests.some((body) => body.includes("策略分批止盈") && body.includes(profit.id) && body.includes("价格 220") && body.includes("毛盈亏")));
    assert.ok(requests.some((body) => body.includes("策略止损") && body.includes(guarded.id) && body.includes("价格 89") && body.includes("毛盈亏")));
    assert.ok(requests.some((body) => body.includes("策略已到期") && body.includes(expired.id)));
    assert.ok(requests.some((body) => body.includes("策略已完成，撤销余单") && body.includes(guarded.id)));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a Bark transport failure never fails the PAPER snapshot or its simulated fill", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Bark unavailable"); };
  try {
    const { createStrategy, getStrategy } = await import("../lib/trade/strategies.ts");
    const { getPaperSnapshot } = await import("../lib/paper.ts");
    const strategy = await createStrategy({
      ...validDraft, symbol: "FAULTUSDT", style: "HORIZONTAL", horizontalEntry: { price: 100 }, legs: [{ atrOffset: 0 }],
      idempotencyKey: "paper-bark-transport-failure",
    });

    await assert.doesNotReject(() => getPaperSnapshot({ symbol: "FAULTUSDT", quotedPrice: 100, quoteMode: "live" }));
    assert.equal((await getStrategy(strategy.id))?.lots.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
