import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const wizardSource = fs.readFileSync(new URL("../app/trade/StrategyWizard.tsx", import.meta.url), "utf8");
const panelSource = fs.readFileSync(new URL("../app/trade/AdaptiveStrategyPanel.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../app/trade/trade.module.css", import.meta.url), "utf8");
const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");

test("live-only strategy wizard presents the required decision fields and safety contract", () => {
  for (const label of ["做多", "做空", "5m", "15m", "1h", "4h", "1d", "均线策略", "支撑阻力位策略", "SMA", "EMA", "均线周期", "ATR 倍数", "限价", "静态入场价", "下单笔数"]) {
    assert.match(wizardSource, new RegExp(label));
  }
  assert.match(wizardSource, /建立实盘策略/);
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

test("entry panel uses the wizard while existing position management remains available", () => {
  assert.match(panelSource, /import StrategyWizard from "\.\/StrategyWizard"/);
  assert.match(panelSource, /mode === "entry"\s*\?\s*<StrategyWizard/);
  assert.match(panelSource, /POSITION DETECTED · MANAGEMENT/);
  assert.match(panelSource, /已有持仓止盈止损/);
  assert.doesNotMatch(panelSource, /api\/paper\/close|PAPER|模拟盘/);
  assert.match(stylesSource, /\.strategyWizard/);
  assert.match(stylesSource, /@media \(max-width: 780px\)/);
});

test("wizard keeps LIVE strategy status visible and refreshes it after a change", () => {
  assert.doesNotMatch(wizardSource, /import StrategyStatusList from "\.\/StrategyStatusList"/);
  assert.match(wizardSource, /setStrategyRevision/);
  assert.doesNotMatch(wizardSource, /<StrategyStatusList key=\{strategyRevision\}/);
  assert.match(wizardSource, /<LiveStrategyStatusList key=/);
});

test("trade terminal defaults to the real account view and removes paper controls", () => {
  assert.doesNotMatch(terminalSource, /\/api\/paper|Paper[A-Z]|PAPER|模拟盘/);
  assert.doesNotMatch(terminalSource, /accountView/);
  assert.match(terminalSource, /BINANCE USDⓈ-M/);
});
