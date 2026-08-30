import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { buildPositionAnalysis, resolveOccupiedMargin } from "../lib/trade/position-analysis.ts";

const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const chartSource = fs.readFileSync(new URL("../app/trade/TradeChart.tsx", import.meta.url), "utf8");
const accountSource = fs.readFileSync(new URL("../app/api/account/route.ts", import.meta.url), "utf8");
const liveAccountSource = fs.readFileSync(new URL("../lib/trade/live-account.ts", import.meta.url), "utf8");
const manualProtectionApiSource = fs.readFileSync(new URL("../app/api/trade/manual-protection/route.ts", import.meta.url), "utf8");
const closeSource = fs.readFileSync(new URL("../lib/trade/live-position-close.ts", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../app/trade/trade.module.css", import.meta.url), "utf8");

test("交易页提供字号开关和可拖动工作区", () => {
  assert.match(terminalSource, /FontControl|字体大小|字号/);
  assert.match(terminalSource, /onPointerDown|pointerdown/);
  assert.match(stylesSource, /resize|splitter|拖动/);
  assert.match(terminalSource, /useState\(640\)/);
  assert.match(stylesSource, /chartResizeHandle::after/);
  assert.match(stylesSource, /align-items: stretch/);
});

test("持仓接口和表格显示实际占用保证金", () => {
  assert.match(accountSource, /initialMargin|positionInitialMargin|isolatedMargin/);
  assert.match(terminalSource, /占用保证金/);
});

test("账户接口按当前币种读取并返回真实成交回报", () => {
  assert.match(accountSource, /userTrades/);
  assert.match(accountSource, /symbol=.*limit=100/);
  assert.match(accountSource, /fills:/);
  assert.match(accountSource, /executedQuantity/);
  assert.match(accountSource, /currentLeverage/);
  assert.match(accountSource, /resolveCurrentLeverage/);
});

test("账户接口为成交补齐历史订单元数据和稳定订单组编号", () => {
  assert.match(accountSource, /allOrders\?symbol=.*limit=1000/);
  assert.match(accountSource, /orderGroupId/);
  assert.match(accountSource, /orderType/);
  assert.match(accountSource, /clientOrderId/);
  assert.doesNotMatch(accountSource, /getOrCreateManualOrderAlias/);
});

test("Telegram 实盘挂单保留 Binance 原始 clientOrderId", () => {
  assert.match(liveAccountSource, /const websiteOrderId = clientOrderId \|\|/);
  assert.doesNotMatch(liveAccountSource, /clientOrderId\.toLowerCase/);
});

test("成交图表使用独立图层绘制已完成订单生命周期", () => {
  assert.match(terminalSource, /fills=\{/);
  assert.match(chartSource, /buildTradeLifecycleLines/);
  assert.match(chartSource, /lifecycleLines/);
  assert.match(chartSource, /addSeries\(LineSeries/);
});

test("未登录读取账户接口时，交易页面保留安全的空账户而不崩溃", () => {
  assert.match(terminalSource, /if \(!response\.ok \|\| !payload\.account\)/);
  assert.match(terminalSource, /return \{ \.\.\.emptyAccount, reason:/);
});

test("每个持仓提供四专家分析入口和结构化建议结果", () => {
  assert.match(terminalSource, /分析/);
  assert.match(terminalSource, /建议挂单金额/);
  assert.match(terminalSource, /建议止损价/);
  assert.match(terminalSource, /建议止盈价/);
  assert.match(terminalSource, /四位专家|四专家/);
});

test("真实持仓提供百分比市价平仓入口与二次确认", () => {
  assert.match(terminalSource, /<th>平仓<\/th>/);
  assert.match(terminalSource, /确认市价平仓/);
  assert.match(terminalSource, /LIVE_CLOSE_PERCENT_OPTIONS/);
  for (const percent of ["10", "25", "50", "75", "100"]) assert.match(closeSource, new RegExp(`\\b${percent}\\b`));
  assert.match(terminalSource, /\/api\/trade\/positions\/close/);
  assert.match(accountSource, /positionSide/);
});

test("网站持仓提供按止盈止损分流的手动保护入口", () => {
  assert.match(terminalSource, /手动保护/);
  assert.match(terminalSource, /估算保证金/);
  assert.match(terminalSource, />止盈<\/button>/);
  assert.match(terminalSource, />止损<\/button>/);
  assert.match(terminalSource, /默认止盈/);
  assert.match(terminalSource, /固定止盈/);
  assert.match(terminalSource, /均线默认止损/);
  assert.match(terminalSource, /固定价格止损/);
  assert.match(terminalSource, /\["5m", "15m", "1h", "4h", "1d"\]/);
  assert.match(terminalSource, /确认设置保护单/);
  assert.doesNotMatch(terminalSource, /其他来源<strong>/);
  assert.doesNotMatch(terminalSource, /总持仓<strong>/);
  assert.match(terminalSource, /CONFIRM_MANUAL_PROTECTION/);
  assert.match(terminalSource, /\/api\/trade\/manual-protection/);
  assert.match(manualProtectionApiSource, /getAlexManualPositions/);
  assert.match(manualProtectionApiSource, /createProtectionStrategy/);
  assert.match(manualProtectionApiSource, /reconciliationRequired/);
});

test("受活动保护的持仓在分析与合约之间显示保护绿灯和比例", () => {
  assert.match(terminalSource, /<th>保护<\/th><th>合约<\/th>/);
  assert.match(terminalSource, /protectedPercent/);
  assert.match(terminalSource, /保护中/);
  assert.match(stylesSource, /protectionBadge/);
  assert.match(stylesSource, /protectionLight/);
});

test("保证金字段只接受接口明确返回的实际占用值", () => {
  assert.equal(resolveOccupiedMargin({ initialMargin: "12.50", isolatedMargin: "9" }), 12.5);
  assert.equal(resolveOccupiedMargin({ positionInitialMargin: "8.25" }), 8.25);
  assert.equal(resolveOccupiedMargin({ isolatedMargin: "0", notional: "1000", leverage: "10" }), null);
});

test("四专家一致时生成统一的待审核金额止损止盈计划", () => {
  const opinion = (expertId, marginUsdt, stopPrice, target) => ({
    expertId, round: "R3", direction: "LONG", setupName: "reclaim", marginUsdt, stopPrice,
    targets: [target], maxLossUsdt: 5, expectedRr: 2, marketRegime: "trend", noTradeReasons: [],
    supportingEvidence: ["closed candle"], refutingEvidence: [], unknowns: [], sourceRefs: [`${expertId}-source`],
  });
  const result = buildPositionAnalysis({
    symbol: "BTCUSDT", mode: "live", capturedAt: "2026-08-20T00:00:00.000Z",
    opinions: [opinion("ict", 100, 64000, 68000), opinion("street", 120, 64200, 68200), opinion("jingxin", 110, 64100, 68100), opinion("bitlanglang", 130, 64300, 68300)],
    failures: [],
    consensus: { direction: "LONG", strength: "STRONG", validOpinions: 4, longVotes: 4, shortVotes: 0, neutralVotes: 0, pushEligible: true, disagreement: false, opposingEvidence: [] },
  });
  assert.equal(result.status, "ready");
  assert.equal(result.plan.direction, "LONG");
  assert.equal(result.plan.suggestedMarginUsdt, 115);
  assert.equal(result.plan.suggestedStopPrice, 64150);
  assert.equal(result.plan.suggestedTakeProfitPrice, 68150);
});
