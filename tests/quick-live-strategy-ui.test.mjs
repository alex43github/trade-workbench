import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const panelSource = fs.readFileSync(new URL("../app/trade/QuickLiveStrategyPanel.tsx", import.meta.url), "utf8");
const terminalSource = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const adaptiveSource = fs.readFileSync(new URL("../app/trade/AdaptiveStrategyPanel.tsx", import.meta.url), "utf8");
const wizardSource = fs.readFileSync(new URL("../app/trade/StrategyWizard.tsx", import.meta.url), "utf8");

test("快捷实盘侧栏提供输入框 A 与五个固定 1h 模板", () => {
  assert.match(panelSource, /aria-label="输入框 A"/);
  assert.match(panelSource, /normalizeBinanceFuturesSymbol/);
  assert.match(panelSource, /quickTemplateId/);
  for (const templateId of [
    "BALANCED_LONG_1H",
    "BALANCED_SHORT_1H",
    "BULL_CHASE_1H",
    "BEAR_CHASE_1H",
    "RANGE_LONG_1H",
    "RANGE_SHORT_1H",
  ]) {
    assert.match(panelSource, new RegExp(templateId));
  }
  for (const label of [
    "1h 均衡策略做多",
    "1h 均衡策略做空",
    "1h 追牛策略",
    "1h 追熊策略",
    "1h 震荡策略看多",
    "1h 震荡策略看空",
  ]) {
    assert.match(panelSource, new RegExp(label));
  }
});

test("快捷实盘侧栏提供市价均衡损模板并明确独立新仓边界", () => {
  for (const templateId of ["MARKET_BALANCED_LONG_1H", "MARKET_BALANCED_SHORT_1H"]) {
    assert.match(panelSource, new RegExp(templateId));
  }
  for (const label of ["市价多均衡损", "市价空均衡损"]) {
    assert.match(panelSource, new RegExp(label));
  }
  for (const copy of ["市价新开仓", "只保护本次新仓", "双向持仓模式", "无止盈"]) {
    assert.match(panelSource, new RegExp(copy));
  }
  assert.match(panelSource, /quickEntryMode|entryMode/);
});

test("快捷侧栏按模板区分一笔市价与五笔限价提示", () => {
  assert.match(panelSource, /selectedOption[\s\S]*MARKET|isQuickLiveMarketTemplate/);
  assert.match(panelSource, /一笔市价|单笔市价/);
  assert.match(panelSource, /五笔限价|五笔/);
});

test("每个快捷模板整张卡由单一按钮承载并可用键盘选中", () => {
  assert.match(panelSource, /<button[^>]+className=\{`\$\{styles\.quickLiveTemplate\}/);
  assert.match(panelSource, /aria-pressed=\{selected\}/);
  assert.match(panelSource, /<strong>\{option\.label\}<\/strong>[\s\S]*?<p>\{option\.description\}<\/p>[\s\S]*?<\/button>/);
  assert.doesNotMatch(panelSource, /<article[^>]*data-template-id=\{option\.id\}/);
});

test("震荡模板把看多放在看空之前", () => {
  assert.ok(panelSource.indexOf('id: "RANGE_LONG_1H"') < panelSource.indexOf('id: "RANGE_SHORT_1H"'));
});

test("模板卡片只展示固定指标与简洁的入场、止盈、止损说明", () => {
  assert.match(panelSource, /1h/);
  assert.match(panelSource, /MA30/);
  assert.match(panelSource, /ATR14/);
  assert.match(panelSource, /总权益5%/);
  assert.match(panelSource, /本次总保证金（USDT）/);
  assert.match(panelSource, /totalMarginDraft/);
  assert.doesNotMatch(panelSource, /quickLiveSnapshot/);
  assert.doesNotMatch(panelSource, /quickLiveEntryPrices/);
  assert.match(panelSource, /止损/);
  assert.match(panelSource, /止盈/);
  assert.match(panelSource, /五笔|5.*笔/);
});

test("快捷侧栏原地展示确认摘要，不跳转中间向导", () => {
  assert.match(panelSource, /quickLiveReview/);
  assert.match(panelSource, /确认本次实盘策略/);
  assert.match(panelSource, /1h 已收盘 MA30/);
  assert.match(panelSource, /下单并建立保护/);
  assert.match(panelSource, /确认提交实盘订单/);
  assert.doesNotMatch(panelSource, /scrollIntoView/);
  assert.match(terminalSource, /onStrategyCreated/);
});

test("图表不再提供重复快速下单按钮，侧栏保留输入框 A", () => {
  assert.doesNotMatch(terminalSource, /快速下单|quick-live-order/);
  assert.match(panelSource, /aria-label="输入框 A"/);
  assert.match(panelSource, /inputARef/);
});

test("快捷策略面板位于左侧 sidebar，订单卡只保留普通向导", () => {
  const sidebarStart = terminalSource.indexOf('<aside className={styles.sidebar}>');
  const sidebarEnd = terminalSource.indexOf("</aside>", sidebarStart);
  assert.ok(sidebarStart >= 0 && sidebarEnd > sidebarStart, "应存在可定位的左侧 sidebar");
  const sidebar = terminalSource.slice(sidebarStart, sidebarEnd);
  assert.match(sidebar, /<QuickLiveStrategyPanel/);

  const orderEntryStart = terminalSource.indexOf("<article className={`${styles.monitorCard} ${styles.orderEntryCard}`}>");
  const strategyOrdersStart = terminalSource.indexOf("<article className={`${styles.monitorCard} ${styles.strategyOrdersCard}`}>", orderEntryStart);
  assert.ok(orderEntryStart >= 0 && strategyOrdersStart > orderEntryStart, "应存在可定位的订单卡区域");
  const orderEntry = terminalSource.slice(orderEntryStart, strategyOrdersStart);
  assert.doesNotMatch(orderEntry, /<QuickLiveStrategyPanel/);
});

test("快捷入口原地复用既有策略提交接口并保留最终确认", () => {
  assert.match(terminalSource, /<QuickLiveStrategyPanel/);
  assert.match(terminalSource, /realTradingStatus\.canPlaceOrders/);
  assert.match(panelSource, /fetch\("\/api\/trade\/live-strategies"/);
  assert.match(panelSource, /confirmation = selectedMarketTemplate \? "CREATE_QUICK_MARKET_STRATEGY" : "CREATE_LIVE_STRATEGY"/);
  assert.match(panelSource, /confirmationNonce: crypto\.randomUUID\(\)/);
  assert.match(panelSource, /liveSwitchOn: true/);
  assert.match(panelSource, /quickTemplateId: selectedTemplate/);
  assert.match(panelSource, /onStrategyCreated\(\)/);
});
