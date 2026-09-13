import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const styles = fs.readFileSync(new URL("../app/trade/trade.module.css", import.meta.url), "utf8");
const terminal = fs.readFileSync(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");

test("risk monitor cards and summary cards share aligned, bordered grid geometry", () => {
  assert.match(styles, /\.riskMonitorStrip\s*\{[^}]*align-items:\s*stretch/);
  assert.match(styles, /\.monitorCard\s*\{[^}]*height:\s*100%[^}]*border:\s*1px solid var\(--line\)/);
  assert.match(styles, /\.monitorRows\s*\{[^}]*flex:\s*1/);
  assert.match(styles, /\.summaryGrid\s*\{[^}]*align-items:\s*stretch/);
  assert.match(styles, /\.summaryGrid article\s*\{[^}]*min-height:\s*104px[^}]*border:\s*1px solid var\(--line\)/);
});

test("trade workspace gives the order entry, live orders, and event stream three desktop columns", () => {
  assert.match(styles, /\.riskMonitorStrip\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(styles, /\.strategyOrdersCard[^}]*\.strategyStatusList[^}]*overflow-y:\s*auto/);
  assert.match(styles, /@media\s*\(max-width:\s*1180px\)[^{]*\{[^}]*\.riskMonitorStrip\s*\{[^}]*grid-template-columns:\s*1fr/);
});

test("desktop trade sidebar reserves a readable width while retaining compact breakpoints", () => {
  assert.match(styles, /\.terminalShell\s*\{[^}]*grid-template-columns:\s*270px\s+minmax\(0,\s*1fr\)/);
  assert.match(styles, /@media\s*\(max-width:\s*1180px\)[^{]*\{[^}]*\.terminalShell\s*\{[^}]*grid-template-columns:\s*72px\s+minmax\(0,\s*1fr\)/);
  assert.match(styles, /@media\s*\(max-width:\s*780px\)[^{]*\{[^}]*\.terminalShell\s*\{[^}]*display:\s*block/);
});

test("chart is the only resizable trade-grid item and live strategy list replaces reconciliation card", () => {
  assert.match(terminal, /import\s+LiveStrategyStatusList\s+from\s+"\.\/LiveStrategyStatusList"/);
  assert.doesNotMatch(terminal, /strategyPanelWidth|panelResizeHandle|resizeRef\.current\s*===\s*"panel"/);
  assert.doesNotMatch(terminal, /monitor\.unmatched|未匹配头寸|RECONCILIATION/);
  assert.match(terminal, /styles\.orderEntryCard[\s\S]*?<AdaptiveStrategyPanel/);
  assert.match(terminal, /styles\.strategyOrdersCard[\s\S]*?<LiveStrategyStatusList[\s\S]*?refreshToken=\{accountRevision\}/);
});
