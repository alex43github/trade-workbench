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
  assert.match(wizardSource, /AI不会自主开仓/);
  assert.doesNotMatch(wizardSource, /模拟 PAPER/);
});

test("实盘向导移除占用下单区域的实盘说明框", () => {
  const progressIndex = wizardSource.indexOf('<div className={styles.wizardProgress}>');
  const actionsIndex = wizardSource.indexOf('<div className={styles.wizardActions}>');
  assert.ok(progressIndex >= 0, "向导步骤应存在");
  assert.ok(actionsIndex > progressIndex, "快速下单操作应位于步骤之后");
  assert.doesNotMatch(wizardSource, /executionModePicker/);
});

test("实盘向导将方向与周期压缩到第一页、策略与参数压缩到第二页", () => {
  assert.match(wizardSource, /const steps = \["方向与周期", "策略与参数", "确认"\]/);
  assert.match(wizardSource, /step === 0 && <section>[\s\S]*做多[\s\S]*做空[\s\S]*哪个周期/);
  assert.match(wizardSource, /step === 1 && <section>[\s\S]*均线策略[\s\S]*均线周期[\s\S]*ATR 倍数[\s\S]*下单笔数/);
  assert.doesNotMatch(wizardSource, /step === 4/);
  assert.match(wizardSource, /step < 2/);
});

test("压缩向导仍保留最后审核页与显式创建确认", () => {
  assert.match(wizardSource, /step === 2 && <section>[\s\S]*确认建立实盘策略/);
  assert.match(wizardSource, /const confirmation = quickMarketTemplate \? "CREATE_QUICK_MARKET_STRATEGY" : "CREATE_LIVE_STRATEGY"/);
  assert.match(wizardSource, /liveSwitchOn:\s*true/);
  assert.match(wizardSource, /确认建立实盘策略/);
});

test("向导接入市价模板的固定一笔与独立确认串", () => {
  assert.match(wizardSource, /MARKET_BALANCED_LONG_1H/);
  assert.match(wizardSource, /MARKET_BALANCED_SHORT_1H/);
  assert.match(wizardSource, /CREATE_QUICK_MARKET_STRATEGY/);
  assert.match(wizardSource, /MARKET[\s\S]*legCountDraft|legCountDraft[\s\S]*MARKET/);
  assert.match(wizardSource, /一笔市价|单笔市价/);
});

test("市价向导确认页声明只保护本次新仓且不改动既有仓位", () => {
  assert.match(wizardSource, /不会改动既有仓位|不会自动平仓/);
  assert.match(wizardSource, /仅保护本策略|本次新仓/);
  assert.match(wizardSource, /无止盈|不配置止盈/);
});

test("wizard creates only a LIVE limit strategy with one-click final confirmation", () => {
  assert.match(wizardSource, /fetch\("\/api\/trade\/live-strategies"/);
  assert.match(wizardSource, /method:\s*"POST"/);
  assert.match(wizardSource, /mode:\s*"LIVE_ARMED"/);
  assert.match(wizardSource, /execution:\s*"LIMIT_POST_ONLY"/);
  assert.match(wizardSource, /refreshOn:\s*"CLOSED_CANDLE"/);
  assert.match(wizardSource, /expiryDays:\s*7/);
  assert.match(wizardSource, /crypto\.randomUUID\(\)/);
  assert.match(wizardSource, /onStrategyCreated/);
  assert.match(wizardSource, /策略编号/);
  assert.match(wizardSource, /确认建立实盘策略/);
  assert.doesNotMatch(wizardSource, /liveConfirmation|输入 CONFIRM|实盘确认/);
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
  assert.match(wizardSource, /保证金/);
  assert.match(wizardSource, /倍/);
  assert.doesNotMatch(wizardSource, /✖️/);
  assert.match(wizardSource, /登录后读取/);
  assert.match(wizardSource, /accountConnected/);
  assert.match(panelSource, /currentLeverage=\{currentLeverage\}/);
  assert.match(panelSource, /accountConnected=\{accountConnected\}/);
  assert.match(terminalSource, /currentLeverage: number \| null/);
  assert.match(terminalSource, /currentLeverage=\{account\.currentLeverage\}/);
});

test("strategy wizard keeps every numeric parameter as an editable draft until validation", () => {
  for (const name of ["maLengthDraft", "atrLengthDraft", "atrMultiplierDraft", "legCountDraft", "totalMarginDraft", "horizontalGuardPriceDraft"]) {
    assert.match(wizardSource, new RegExp(name));
  }
  assert.match(wizardSource, /keepNumberDraft\(event\.target\.value\)/);
  assert.doesNotMatch(wizardSource, /setMaLength\(Math\.max/);
  assert.doesNotMatch(wizardSource, /setAtrLength\(Math\.max/);
  assert.doesNotMatch(wizardSource, /setLegCount\(clampLegCount/);
});

test("网页实盘向导默认使用5笔且每笔保证金5 USDT", () => {
  assert.match(wizardSource, /useState\("5"\)/);
  assert.match(wizardSource, /useState\("25"\)/);
  assert.match(wizardSource, /每笔约/);
});

test("实盘向导在确认前显示可用余额并拦截余额不足的默认保证金", () => {
  assert.match(wizardSource, /availableBalance/);
  assert.match(wizardSource, /可用余额不足/);
  assert.match(panelSource, /availableBalance=\{accountBalance\}/);
});

test("wizard keeps LIVE strategy status visible and refreshes it after a change", () => {
  assert.doesNotMatch(wizardSource, /import StrategyStatusList from "\.\/StrategyStatusList"/);
  assert.match(wizardSource, /setStrategyRevision/);
  assert.doesNotMatch(wizardSource, /<StrategyStatusList key=\{strategyRevision\}/);
  assert.match(wizardSource, /<LiveStrategyStatusList refreshToken=\{strategyRevision\}/);
});

test("实盘状态使用网页 Toast，隐藏已取消且未成交的策略", () => {
  assert.match(wizardSource, /trade-toast/);
  assert.match(liveStatusSource, /liveToastStack/);
  assert.match(liveStatusSource, /setTimeout/);
  assert.match(liveStatusSource, /策略已触发/);
  assert.match(liveStatusSource, /status === "CANCELED"/);
  assert.match(liveStatusSource, /executedQuantity/);
  assert.match(liveStatusSource, /有订单拒绝或超时未知；不会自动补单或撤单/);
  assert.doesNotMatch(liveStatusSource, /先到 Binance 核对订单和持仓/);
});

test("实盘订单只显示来源标签、必要信息和简洁保护图标", () => {
  for (const label of ["tele", "web", "alex", "ios", "Binance"]) {
    assert.match(liveStatusSource, new RegExp(label));
  }
  assert.match(liveStatusSource, /orderSourceLabel/);
  assert.match(liveStatusSource, /protectionIndicator/);
  assert.match(liveStatusSource, /✓/);
  assert.match(liveStatusSource, /✕/);
  assert.match(liveStatusSource, /order\.protection/);
  assert.match(liveStatusSource, /\? "限"/);
  assert.match(liveStatusSource, /order\.status === "FILLED"/);
  assert.doesNotMatch(liveStatusSource, /\{order\.clientOrderId\}/);
  assert.doesNotMatch(liveStatusSource, /\{attempt\.clientOrderId\}/);
  assert.doesNotMatch(liveStatusSource, /Binance \$\{/);
  assert.doesNotMatch(liveStatusSource, /止损保护中|已减仓 50%|已止损退出|止损保护异常|止损保护需对账/);
  assert.match(stylesSource, /liveProtectionError/);
  assert.match(stylesSource, /#F3FFEE/i);
  assert.match(stylesSource, /liveOrderFilled/);
});

test("trade terminal defaults to the real account view and removes paper controls", () => {
  assert.doesNotMatch(terminalSource, /\/api\/paper|Paper[A-Z]|PAPER|模拟盘/);
  assert.doesNotMatch(terminalSource, /accountView/);
  assert.match(terminalSource, /BINANCE USDⓈ-M/);
});
