import assert from "node:assert/strict";
import test from "node:test";
import { calculateAtr, calculateAtrBand, formatAtrDistance } from "../app/trade/strategyMath.ts";
import { calculateOrderSizing } from "../lib/trade/order-sizing.ts";
import { classifyAnalysisError } from "../lib/trade/analysis-error.ts";
import fs from "node:fs";

const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const chartSource = fs.readFileSync(new URL("../app/trade/TradeChart.tsx", import.meta.url), "utf8");
const strategyPanelSource = fs.readFileSync(new URL("../app/trade/AdaptiveStrategyPanel.tsx", import.meta.url), "utf8");
const dailyJobSource = fs.readFileSync(new URL("../lib/advisory/daily-job.ts", import.meta.url), "utf8");
const orchestratorSource = fs.readFileSync(new URL("../lib/advisory/orchestrator.ts", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../app/trade/trade.module.css", import.meta.url), "utf8");

const bars = [
  { time: 1, open: 100, high: 105, low: 95, close: 100, volume: 1, closed: true },
  { time: 2, open: 100, high: 110, low: 98, close: 108, volume: 1, closed: true },
  { time: 3, open: 108, high: 112, low: 103, close: 105, volume: 1, closed: true },
];

test("ATR uses true range and keeps a signed distance multiple", () => {
  const atr = calculateAtr(bars, 2);
  assert.equal(atr.at(-1).value, 10);
  assert.equal(formatAtrDistance(108, 100, 4), "+2.00 ATR");
  assert.equal(formatAtrDistance(96, 100, 4), "-1.00 ATR");
});

test("429 provider failures become a safe quota message", () => {
  const failure = classifyAnalysisError('OpenAI 429: {"error":{"message":"You exceeded your current quota"}}');
  assert.equal(failure.code, "PROVIDER_QUOTA_EXHAUSTED");
  assert.match(failure.message, /配额|额度/);
  assert.doesNotMatch(failure.message, /OpenAI 429|current quota|error/);
});

test("trade terminal exposes symbol navigation, searchable symbols, ATR and indicator controls", () => {
  assert.match(terminalSource, /onSelectSymbol/);
  assert.match(terminalSource, /api\/market\/symbols/);
  assert.match(terminalSource, /ATR/);
  assert.match(terminalSource, /MA|EMA/);
  assert.match(terminalSource, /lineWidth/);
  assert.match(chartSource, /lineWidth: indicators\.ma\.lineWidth/);
  assert.match(chartSource, /lineWidth: indicators\.ema\.lineWidth/);
});

test("trade chart shows a dotted crosshair with hovered price distance from the latest close", () => {
  assert.match(chartSource, /subscribeCrosshairMove/);
  assert.match(chartSource, /coordinateToPrice/);
  assert.match(chartSource, /hoverPrice/);
  assert.match(chartSource, /crosshair-price-label/);
  assert.match(chartSource, /LineStyle\.Dashed/);
});

test("trade chart uses the requested clean MA and ATR defaults", () => {
  assert.match(terminalSource, /ma:\s*\{ enabled: true, length: 30, color: "#2563eb", lineWidth: 3 \}/);
  assert.match(terminalSource, /atr:\s*\{ upperColor: "#111827", lowerColor: "#111827", upperLineWidth: 1, lowerLineWidth: 1 \}/);
  assert.match(chartSource, /color: "#2563eb", lineWidth: 3, lineStyle: LineStyle\.Solid/);
  assert.match(chartSource, /color: "#111827", lineWidth: 1, lineStyle: LineStyle\.Dashed/);
  assert.doesNotMatch(chartSource, /MA触及/);
});

test("trade chart markers are based only on executed fills and never include marker text", () => {
  assert.match(chartSource, /buildFillMarkers/);
  assert.match(chartSource, /refs\.markers\.setMarkers\(buildFillMarkers/);
  assert.doesNotMatch(chartSource, /bar\.low <= band\.upper/);
  const markerUpdate = chartSource.match(/refs\.markers\.setMarkers\(([\s\S]*?)\);/)?.[1] ?? "";
  assert.doesNotMatch(markerUpdate, /text:\s*"/);
});

test("trade terminal requests executed account fills for chart markers", () => {
  assert.match(terminalSource, /api\/account\?symbol=/);
  assert.match(terminalSource, /fills=\{/);
  assert.match(terminalSource, /executedQuantity/);
});

test("trade page is live-only and does not render paper-account elements", () => {
  assert.doesNotMatch(terminalSource, /\/api\/paper|Paper[A-Z]|PAPER|模拟盘/);
  assert.doesNotMatch(strategyPanelSource, /\/api\/paper|PAPER|模拟盘/);
});

test("custom ATR entry bands create upper and lower confirmation prices", () => {
  assert.deepEqual(calculateAtrBand(100, 4, 1.5, 0.75), { upper: 106, lower: 97 });
  assert.equal(calculateAtrBand(100, 0, 1.5, 0.75), null);
});

test("fixed order size is margin and leverage determines notional value", () => {
  assert.deepEqual(calculateOrderSizing({ sizeMode: "fixed_margin", sizeValue: 100, availableMargin: 500, leverage: 3 }), { marginUsdt: 100, notional: 300 });
  assert.deepEqual(calculateOrderSizing({ sizeMode: "available_pct", sizeValue: 10, availableMargin: 500, leverage: 3 }), { marginUsdt: 50, notional: 150 });
});

test("trade UI labels the ATR bands and fixed size as margin", () => {
  assert.match(terminalSource, /上方 ATR/);
  assert.match(terminalSource, /下方 ATR/);
  assert.match(strategyPanelSource, /固定保证金/);
  assert.doesNotMatch(strategyPanelSource, /保证金金额；名义价值/);
  assert.match(chartSource, /calculateAtrBand|atrUpperMultiplier/);
});

test("position management selects an action timeframe and keeps the margin field compact", () => {
  assert.match(terminalSource, /interval=\{interval\}/);
  assert.match(strategyPanelSource, /操作周期/);
  assert.match(strategyPanelSource, /管理周期|actionTimeframe/);
  assert.match(strategyPanelSource, /5m.*15m.*1h.*4h.*1d/);
  assert.match(strategyPanelSource, /actionTimeframe/);
  assert.doesNotMatch(strategyPanelSource, /保证金金额；名义价值/);
});

test("strategy panel stages order or position management before cloud waiting confirmation", () => {
  assert.match(strategyPanelSource, /操作意图/);
  assert.match(strategyPanelSource, /下单/);
  assert.match(strategyPanelSource, /已有持仓止盈止损/);
  assert.match(strategyPanelSource, /下单笔数/);
  assert.match(strategyPanelSource, /每笔.*保证金/);
  assert.match(strategyPanelSource, /分两笔止损/);
  assert.match(strategyPanelSource, /api\/trade\/conditional-orders/);
  assert.match(strategyPanelSource, /确认条件并等待触发/);
  assert.match(terminalSource, /onConditionalChanged/);
});

test("decision log shows AI participation and user waiting orders with trigger distance", () => {
  assert.match(terminalSource, /AI强参与币/);
  assert.match(terminalSource, /我的条件等待单/);
  assert.match(terminalSource, /距离触发/);
  assert.match(terminalSource, /api\/trade\/conditional-orders/);
  assert.match(terminalSource, /topDecisionStrip/);
  assert.match(terminalSource, /选择AI强参与币/);
  assert.match(terminalSource, /选择条件等待单/);
  assert.doesNotMatch(terminalSource, /aiStrongCoins[\s\S]*\.slice\(0, 4\)/);
});

test("trade header identifies the selected token and exposes a colored live-mode status", () => {
  assert.match(terminalSource, /当前图表币种/);
  assert.match(terminalSource, /realTradingStatus/);
  assert.match(terminalSource, /realOrderRouteEnabled/);
  assert.match(terminalSource, /role="switch"/);
  assert.match(terminalSource, /realTradingStatus\.detail/);
  assert.match(stylesSource, /modeLive/);
  assert.match(stylesSource, /modeLocked/);
});

test("analysis selection is passed through the expert council and indicator panel is readable", () => {
  assert.match(terminalSource, /选择分析体系/);
  assert.match(terminalSource, /expertId/);
  assert.match(dailyJobSource, /expertIds/);
  assert.match(orchestratorSource, /expertIds/);
  assert.match(stylesSource, /grid-template-columns:\s*repeat\(3/);
  assert.match(stylesSource, /indicatorManager[^}]*font-size:\s*14px/);
});
