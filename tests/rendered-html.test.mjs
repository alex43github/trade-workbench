import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 测试用独立数据库，避免读取本地开发环境里用户保存的真实密钥。
// node:sqlite 的内存库在每个连接间不共享，必须用临时文件才能跨连接看到表结构。
const testDb = path.join(os.tmpdir(), `streetlight-rendered-${process.pid}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;
process.env.STREETLIGHT_LOCAL_TEST_MODE = "false";

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

test("server-renders the live trading terminal", async () => {
  const response = await request("/trade?symbol=SOLUSDT");
  assert.equal(response.status, 200);
  const html = await response.text();
  const visibleHtml = html.split('<div hidden="">', 1)[0];
  assert.match(html, /街灯交易台/);
  assert.doesNotMatch(visibleHtml, /PAPER ONLY|模拟盘|模拟总权益/);
  assert.match(html, /实盘开关：开启/);
  assert.match(html, /不能下单/);
  assert.match(html, /策略决策/);
  assert.match(html, /资金曲线/);
  assert.match(html, /止盈止损/);
  assert.match(html, /指标 ·/);
  assert.match(html, /建立实盘策略/);
  assert.match(html, /操作知识库/);
  assert.match(html, /BINANCE USDⓈ-M/);
  assert.match(html, /LIVE · LIMIT ORDERS/);
  assert.match(html, /实盘策略/);
  assert.match(html, /圆点仅来自 Binance 实际成交回报/);
  const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(terminalSource, /\/api\/paper|Paper[A-Z]|PAPER|模拟盘/);
  assert.match(terminalSource, /realTradingStatus/);
  assert.match(terminalSource, /role="switch"/);
  assert.match(terminalSource, /当前图表币种/);
  assert.match(terminalSource, /FontControl|字号|字体大小/);
  assert.match(terminalSource, /占用保证金/);
  assert.match(terminalSource, /建议挂单金额/);
  assert.match(terminalSource, /分析/);
});

test("renders the shared watchlist and symbol search on advisory pages", async () => {
  const response = await request("/consultations");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /自选币/);
  assert.match(html, /搜索或添加币种/);
  assert.match(html, /BTCUSDT/);
  assert.match(html, /trade\?symbol=/);
});

test("renders the MA30 and OI expansion radar filter", async () => {
  const response = await request("/radar");
  assert.equal(response.status, 200);
  await response.text();
  const radarSource = fs.readFileSync(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(radarSource, /MA30 × OI 增仓/);
  assert.match(radarSource, /连续站上 MA30/);
  assert.match(radarSource, /立即扫描/);
  assert.match(radarSource, /立即筛选/);
  assert.match(radarSource, /Bark：新增候选时提醒/);
  assert.match(radarSource, /破底翻（4H\/日线）/);
  assert.match(radarSource, /08\/20.*08\/19.*08\/18/s);
  assert.match(radarSource, /全部归档/);
});

test("reversal scanner exposes actionable diagnostics when a scan cannot connect", () => {
  const radarSource = fs.readFileSync(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(radarSource, /扫描诊断/);
  assert.match(radarSource, /reversal\?\.diagnostic/);
  assert.match(radarSource, /检查项：/);
  assert.match(radarSource, /diagnostic/);
});

test("MA30/OI scanner distinguishes transport failures from insufficient market data", () => {
  const radarSource = fs.readFileSync(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(radarSource, /createRadarDiagnostic/);
  assert.match(radarSource, /ma30Oi\?\.diagnostic/);
  assert.match(radarSource, /扫描诊断/);
  assert.match(radarSource, /setMa30Oi[\s\S]*createRadarDiagnostic/);
});

test("radar heading shows the latest scan time alongside a live current clock", () => {
  const radarSource = fs.readFileSync(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(radarSource, /最近扫描/);
  assert.match(radarSource, /当前时间/);
  assert.match(radarSource, /setInterval\(\(\) => setRadarNow/);
  assert.match(radarSource, /useState<Date \| null>\(null\)/);
  assert.match(radarSource, /data\?\.updatedAt/);
});

test("radar coin names are prominent links to their trade charts", () => {
  const radarSource = fs.readFileSync(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  const stylesSource = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(radarSource, /coin-trade-link/);
  assert.match(radarSource, /href=\{`\/trade\?symbol=/);
  assert.match(stylesSource, /coin-trade-link strong\{font-size:16px/);
  assert.match(stylesSource, /radar-terminal \.coin-trade-link small\{font-size:12px/);
});

test("account details reject an anonymous request", async () => {
  const response = await request("/api/account", { headers: { accept: "application/json" } });
  assert.equal(response.status, 401);
});

test("connections diagnostics reject an anonymous request", async () => {
  const pageResponse = await request("/settings");
  assert.equal(pageResponse.status, 200);
  const html = await pageResponse.text();
  assert.match(html, /查看服务端连接配置/);
  assert.match(html, /网页不会把密钥写入/);
  assert.match(html, /Binance U本位账户/);
  assert.match(html, /不要开启交易和提现权限/);
  assert.match(html, /连接路径/);
  assert.match(html, /API 密钥/);
  assert.match(html, /留空不会覆盖已保存的值/);
  assert.doesNotMatch(html, /value=["'][^"']+(?:sk-|secret|api)[^"']*["']/i);

  const statusResponse = await request("/api/connections", { headers: { accept: "application/json" } });
  assert.equal(statusResponse.status, 401);
});

test("strategy parsing rejects an anonymous request", async () => {
  const response = await request("/api/strategy/parse", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "15m和1h使用30ma，上下±1%，固定100 USDT，最多买入3次，跌破卖出50%" }),
  });
  assert.equal(response.status, 401);
});

test("AI plan review rejects an anonymous cross-origin request", async () => {
  const response = await request("/api/ai/plan-review", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbol: "BTCUSDT", score: 75, radar: { mode: "live", participation: "A" } }),
  });
  assert.equal(response.status, 403);
});

test("server-renders the strong coin structure radar", async () => {
  const response = await request("/structure-radar");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /强势币结构雷达/);
  assert.match(html, /平台假跌破收回/);
  assert.match(html, /下降趋势线放量突破/);
  assert.match(html, /15m.*1h.*4h/s);
  assert.match(html, /ICT.*街哥.*静心.*bit浪浪/s);
  assert.match(html, /只读持仓/);
  assert.match(html, /不会自动下单/);
});

test("structure radar API reports a disconnected daemon without demo signals", async () => {
  const response = await request("/api/structure-radar", { headers: { accept: "application/json" } });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.connected, false);
  assert.deepEqual(payload.signals, []);
  assert.equal(payload.mode, "disconnected");
});
