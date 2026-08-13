import assert from "node:assert/strict";
import test from "node:test";

async function request(path = "/", init = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html", host: "localhost", ...(init.headers ?? {}) }, ...init }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the AI advisory command center", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /AI 交易驾驶舱/);
  assert.match(html, /ICT/);
  assert.match(html, /街哥/);
  assert.match(html, /静心/);
  assert.match(html, /bit浪浪/);
  assert.match(html, /2\/4/);
  assert.match(html, /仅建议/);
  assert.match(html, /href="\/consultations"/);
  assert.match(html, /href="\/arena"/);
  assert.match(html, /href="\/reviews"/);
  assert.match(html, /href="\/replay"/);
  assert.match(html, /href="\/radar"/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site|codex-preview/);
});

test("keeps the completed market radar at its own route", async () => {
  const response = await request("/radar");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /街灯雷达/);
  assert.match(html, /人群在喊空/);
  assert.match(html, /高波动重点池/);
  assert.match(html, /筹码与链上验真/);
});

test("renders consultation arena review and replay routes", async () => {
  for (const [path, expected] of [["/consultations", /专家会诊/], ["/arena", /模拟竞赛/], ["/reviews", /复盘与进化/], ["/replay", /盲测实验室/]]) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.match(await response.text(), expected);
  }
});

test("server-renders the paper trading strategy lab", async () => {
  const response = await request("/trade?symbol=SOLUSDT");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /街灯交易台/);
  assert.match(html, /回撤到MA30/);
  assert.match(html, /PAPER ONLY/);
  assert.match(html, /自然语言/);
  assert.match(html, /真实交易锁定/);
  assert.match(html, /资金曲线/);
  assert.match(html, /止盈止损/);
  assert.match(html, /指标 ·/);
  assert.match(html, /建立新仓计划/);
  assert.match(html, /操作前纪律评分/);
  assert.match(html, /操作知识库/);
  assert.match(html, /自然语言生成/);
  assert.match(html, /模拟总权益/);
  assert.match(html, /AI复核计划/);
  assert.match(html, /确认并模拟做多/);
});

test("keeps the Binance account surface disconnected without server secrets", async () => {
  const response = await request("/api/account", { headers: { accept: "application/json" } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.connected, false);
  assert.deepEqual(payload.positions, []);
  assert.deepEqual(payload.limitOrders, []);
  assert.deepEqual(payload.conditionalOrders, []);
});

test("renders connection diagnostics without browser-side secret inputs", async () => {
  const pageResponse = await request("/settings");
  assert.equal(pageResponse.status, 200);
  const html = await pageResponse.text();
  assert.match(html, /密钥只进服务端/);
  assert.match(html, /BINANCE_FUTURES_API_KEY/);
  assert.match(html, /当前没有真实下单接口/);
  assert.match(html, /连接路径/);
  assert.doesNotMatch(html, /type=["']password["']/i);

  const statusResponse = await request("/api/connections", { headers: { accept: "application/json" } });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.binancePrivate.configured, false);
  assert.equal(status.openai.configured, false);
  assert.equal(status.safety.secretsExposedToBrowser, false);
  assert.equal(status.safety.realOrderRouteEnabled, false);
  assert.doesNotMatch(JSON.stringify(status), /API_SECRET|API_KEY/);
});

test("turns the MA strategy description into inspectable rules", async () => {
  const response = await request("/api/strategy/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "15m和1h使用30ma，上下±1%，固定100 USDT，最多买入3次，跌破卖出50%" }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.strategy.timeframes, ["15m", "1h"]);
  assert.equal(payload.strategy.maLength, 30);
  assert.equal(payload.strategy.entryBandPct, 1);
  assert.equal(payload.strategy.maxEntries, 3);
  assert.equal(payload.strategy.sizeValue, 100);
});

test("falls back to the explainable discipline reviewer without an OpenAI key", async () => {
  const response = await request("/api/ai/plan-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbol: "BTCUSDT", score: 75, radar: { mode: "live", participation: "A" } }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.configured, false);
  assert.equal(payload.mode, "rules");
  assert.equal(payload.review.action, "ALLOW_PAPER");
});
