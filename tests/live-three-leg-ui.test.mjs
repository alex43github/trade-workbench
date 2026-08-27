import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const wizardSource = fs.readFileSync(new URL("../app/trade/StrategyWizard.tsx", import.meta.url), "utf8");
const liveStatusSource = fs.readFileSync(new URL("../app/trade/LiveStrategyStatusList.tsx", import.meta.url), "utf8");
const liveSubmitSource = fs.readFileSync(new URL("../lib/trade/live-submit.ts", import.meta.url), "utf8");
const telegramSource = fs.readFileSync(new URL("../lib/telegram/handler.ts", import.meta.url), "utf8");
const panelSource = fs.readFileSync(new URL("../app/trade/AdaptiveStrategyPanel.tsx", import.meta.url), "utf8");
const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");

test("实盘向导必须在最终确认时建立可配置数量的限价 Post Only 订单", () => {
  assert.match(wizardSource, /liveTradingAvailable/);
  assert.match(wizardSource, /LIVE/);
  assert.match(wizardSource, /api\/trade\/live-strategies/);
  assert.match(wizardSource, /CREATE_LIVE_STRATEGY/);
  assert.match(wizardSource, /confirmationNonce/);
  assert.match(wizardSource, /liveSwitchOn:\s*true/);
  assert.match(wizardSource, /输入 CONFIRM/);
  assert.match(wizardSource, /legCount/);
  assert.match(wizardSource, /min="1" max="10"/);
  assert.doesNotMatch(wizardSource, /三笔/);
  assert.doesNotMatch(wizardSource, /PAPER|模拟盘/);
  assert.match(wizardSource, /LIMIT_POST_ONLY/);
});

test("实盘策略列表展示逐腿状态并使用专用撤单确认", () => {
  assert.match(liveStatusSource, /api\/trade\/live-strategies/);
  assert.match(liveStatusSource, /RECONCILIATION_REQUIRED/);
  assert.match(liveStatusSource, /UNKNOWN/);
  assert.match(liveStatusSource, /CANCEL_LIVE_STRATEGY/);
  assert.match(liveStatusSource, /strategy.orders/);
  assert.match(liveStatusSource, /实盘策略/);
  assert.doesNotMatch(liveStatusSource, /三笔/);
});

test("实盘策略卡片突出币名并链接到对应 K 线与挂单页面", () => {
  assert.match(liveStatusSource, /function tradeHref\(symbol: string\)/);
  assert.match(liveStatusSource, /encodeURIComponent\(symbol\)/);
  assert.match(liveStatusSource, /tradeHref\(strategy\.config\.symbol\)/);
  assert.match(liveStatusSource, /className=\{styles\.liveStrategySymbolLink\}/);
  assert.match(liveStatusSource, /displayBinanceSymbol\(strategy\.config\.symbol\)/);
  assert.match(liveStatusSource, /查看 .* K线与挂单/);
});

test("实盘提交流程使用通用策略与订单措辞，不绑定固定腿数", () => {
  assert.doesNotMatch(liveSubmitSource, /三笔/);
  assert.match(liveSubmitSource, /config\.legs\.length/);
  assert.doesNotMatch(telegramSource, /三笔真实限价单/);
});

test("交易终端只在实盘开关、账户和服务端通道同时可用时开放实盘向导", () => {
  assert.match(panelSource, /liveTradingAvailable/);
  assert.match(panelSource, /<StrategyWizard/);
  assert.match(terminalSource, /liveTradingAvailable=\{realTradingStatus\.canPlaceOrders\}/);
});
