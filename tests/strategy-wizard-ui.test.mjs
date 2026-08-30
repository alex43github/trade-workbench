import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const wizardSource = fs.readFileSync(new URL("../app/trade/StrategyWizard.tsx", import.meta.url), "utf8");
const panelSource = fs.readFileSync(new URL("../app/trade/AdaptiveStrategyPanel.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../app/trade/trade.module.css", import.meta.url), "utf8");
const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const liveStatusSource = fs.readFileSync(new URL("../app/trade/LiveStrategyStatusList.tsx", import.meta.url), "utf8");

test("live-only strategy wizard presents the required decision fields and safety contract", () => {
  for (const label of ["做多", "做空", "5m", "15m", "1h", "4h", "1d", "均线策略", "支撑阻力位策略", "SMA", "EMA", "均线周期", "ATR 倍数", "限价", "静态入场价", "下单笔数"]) {
    assert.match(wizardSource, new RegExp(label));
  }
  assert.match(wizardSource, /实盘策略/);
  assert.doesNotMatch(wizardSource, /POSITION DETECTED|NO POSITION|LIVE STRATEGY|LIVE ENTRY/);
  assert.match(wizardSource, /min="1" max="10"/);
  assert.match(wizardSource, /legCount/);
  assert.doesNotMatch(wizardSource, /三笔/);
  assert.match(wizardSource, /LIVE/);
  assert.match(wizardSource, /LIMIT_POST_ONLY/);
  assert.match(wizardSource, /7天/);
  assert.match(wizardSource, /仅已收盘 K 线刷新/);
  assert.match(wizardSource, /部分成交不改价/);
  assert.match(wizardSource, /从不市价兜底/);
  assert.match(wizardSource, /AI不会自主开仓/);
  assert.doesNotMatch(wizardSource, /模拟 PAPER/);
});

test("实盘向导把快速下单内容放在底部说明之前", () => {
  const progressIndex = wizardSource.indexOf('<div className={styles.wizardProgress}>');
  const actionsIndex = wizardSource.indexOf('<div className={styles.wizardActions}>');
  const liveNoticeIndex = wizardSource.search(/<div className=\{styles\.executionModePicker\}[\s>]/);
  assert.ok(progressIndex >= 0, "向导步骤应存在");
  assert.ok(actionsIndex > progressIndex, "快速下单操作应位于步骤之后");
  assert.ok(liveNoticeIndex > actionsIndex, "实盘说明应移动到向导最底部");
});

test("wizard creates only a LIVE limit strategy with an explicit final confirmation", () => {
  assert.match(wizardSource, /fetch\("\/api\/trade\/live-strategies"/);
  assert.match(wizardSource, /method:\s*"POST"/);
  assert.match(wizardSource, /mode:\s*"LIVE_ARMED"/);
  assert.match(wizardSource, /execution:\s*"LIMIT_POST_ONLY"/);
  assert.match(wizardSource, /refreshOn:\s*"CLOSED_CANDLE"/);
  assert.match(wizardSource, /expiryDays:\s*7/);
  assert.match(wizardSource, /crypto\.randomUUID\(\)/);
  assert.match(wizardSource, /onStrategyCreated/);
  assert.match(wizardSource, /策略编号/);
  assert.match(wizardSource, /CONFIRM/);
  assert.match(wizardSource, /确认建立实盘策略/);
  assert.doesNotMatch(wizardSource, /PAPER|模拟盘/);
  assert.doesNotMatch(wizardSource, /fetch\("\/api\/trade\/strategies"/);
});

test("every symbol state uses the same live wizard shell", () => {
  assert.match(panelSource, /import StrategyWizard(?:,| from)/);
  assert.match(panelSource, /<StrategyWizard[\s\S]*position=\{position\}/);
  assert.doesNotMatch(panelSource, /POSITION DETECTED · MANAGEMENT/);
  assert.doesNotMatch(panelSource, /api\/trade\/conditional-orders/);
  assert.doesNotMatch(panelSource, /api\/paper\/close|PAPER|模拟盘/);
  assert.match(stylesSource, /\.strategyWizard/);
  assert.match(stylesSource, /@media \(max-width: 780px\)/);
});

test("all symbol states use the same wizard shell, including existing positions", () => {
  assert.match(wizardSource, /position\?:/);
  assert.match(panelSource, /<StrategyWizard[\s\S]*position=\{position\}/);
  assert.doesNotMatch(panelSource, /const entryWizard = mode === "entry"/);
  assert.match(wizardSource, /<h2>实盘策略<\/h2>/);
});

test("strategy wizard displays the selected symbol current leverage", () => {
  assert.match(wizardSource, /currentLeverage/);
  assert.match(wizardSource, /✖️/);
  assert.match(wizardSource, /登录后读取/);
  assert.match(wizardSource, /accountConnected/);
  assert.match(panelSource, /currentLeverage=\{currentLeverage\}/);
  assert.match(panelSource, /accountConnected=\{accountConnected\}/);
  assert.match(terminalSource, /currentLeverage: number \| null/);
  assert.match(terminalSource, /currentLeverage=\{account\.currentLeverage\}/);
});

test("wizard keeps LIVE strategy status visible and refreshes it after a change", () => {
  assert.doesNotMatch(wizardSource, /import StrategyStatusList from "\.\/StrategyStatusList"/);
  assert.match(wizardSource, /setStrategyRevision/);
  assert.doesNotMatch(wizardSource, /<StrategyStatusList key=\{strategyRevision\}/);
  assert.match(wizardSource, /<LiveStrategyStatusList key=/);
});

test("实盘订单只显示来源标签、必要信息和简洁保护图标", () => {
  for (const label of ["Telegram", "web", "iOS", "其他来源"]) {
    assert.match(liveStatusSource, new RegExp(label));
  }
  assert.match(liveStatusSource, /orderSourceLabel/);
  assert.match(liveStatusSource, /protectionIndicator/);
  assert.match(liveStatusSource, /✓/);
  assert.match(liveStatusSource, /✕/);
  assert.match(liveStatusSource, /order\.protection/);
  assert.doesNotMatch(liveStatusSource, /\{order\.clientOrderId\}/);
  assert.doesNotMatch(liveStatusSource, /\{attempt\.clientOrderId\}/);
  assert.doesNotMatch(liveStatusSource, /Binance \$\{/);
  assert.doesNotMatch(liveStatusSource, /止损保护中|已减仓 50%|已止损退出|止损保护异常|止损保护需对账/);
  assert.match(stylesSource, /liveProtectionError/);
});

test("trade terminal defaults to the real account view and removes paper controls", () => {
  assert.doesNotMatch(terminalSource, /\/api\/paper|Paper[A-Z]|PAPER|模拟盘/);
  assert.doesNotMatch(terminalSource, /accountView/);
  assert.match(terminalSource, /BINANCE USDⓈ-M/);
});
