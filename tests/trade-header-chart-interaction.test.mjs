import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const terminalSource = await readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const chartSource = await readFile(new URL("../app/trade/TradeChart.tsx", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../app/trade/trade.module.css", import.meta.url), "utf8");

function quoteMarkup() {
  return terminalSource.match(/<div className=\{styles\.quote\}>[\s\S]*?<\/div>/)?.[0] ?? "";
}

test("行情头价格区域不再占用旧状态小字", () => {
  assert.notEqual(quoteMarkup(), "");
  assert.doesNotMatch(quoteMarkup(), /marketState\.label|updatedAt/);
});

test("图表不再显示重复的快速下单按钮，但保留侧栏快捷策略入口", () => {
  assert.match(terminalSource, /QuickLiveStrategyPanel/);
  assert.doesNotMatch(terminalSource, /quickOrderButton|focusQuickLiveOrder/);
  assert.doesNotMatch(terminalSource, /快速下单<\/button>/);
});

test("周期按钮位于币种搜索同一顶部控制行，并在自选币列表之前", () => {
  const headerIndex = terminalSource.indexOf("className={styles.marketHeaderTop}");
  const intervalIndex = terminalSource.indexOf("className={styles.intervalButtons}");
  const watchlistIndex = terminalSource.indexOf("className={styles.watchlistRow}");
  assert.ok(headerIndex >= 0 && headerIndex < intervalIndex);
  assert.ok(intervalIndex < watchlistIndex);
  assert.match(terminalSource, /className=\{styles\.intervalButtons\} aria-label="K线时间周期"/);
});

test("指标按钮位于止盈止损与第一个 ATR 通道之间", () => {
  assert.match(terminalSource, /<MiniToggle label="止盈止损"[\s\S]*?<button ref=\{indicatorButtonRef\}[\s\S]*?>指标 ·[\s\S]*?indicators\.atrChannels\?\.map/);
  assert.match(stylesSource, /\.marketTopActions/);
});

test("当前图表币种有持仓时显示聚合未实现盈亏，没有持仓时不显示", () => {
  assert.match(terminalSource, /const selectedSymbolPositions = account\.positions\.filter\(\(position\) => position\.symbol === symbol\)/);
  assert.match(terminalSource, /const selectedSymbolUnrealizedPnl = selectedSymbolPositions\.reduce/);
  assert.match(terminalSource, /selectedSymbolPositions\.length > 0/);
  assert.match(terminalSource, /未实现盈亏 \{selectedSymbolUnrealizedPnl >= 0 \? "\+" : ""\}/);
  assert.match(stylesSource, /\.positionPnl\{[^}]*white-space:nowrap/);
});

test("自选币独立占满一行，并仅在溢出方向显示大箭头平滑滚动", () => {
  assert.match(terminalSource, /watchlistRef/);
  assert.match(terminalSource, /function scrollWatchlist/);
  assert.match(terminalSource, /scrollBy\(\{[\s\S]*behavior:\s*"smooth"/);
  assert.match(terminalSource, /className=\{styles\.watchlistRow\}/);
  assert.match(terminalSource, /aria-label="向左查看更多自选币"/);
  assert.match(terminalSource, /aria-label="向右查看更多自选币"/);
  assert.match(stylesSource, /\.watchlistRow\s*\{[^}]*width:\s*100%/);
  assert.match(stylesSource, /\.watchlistRow \.symbolPicker\s*\{[^}]*flex:\s*1 1 auto[^}]*max-width:\s*none/);
  assert.match(stylesSource, /\.watchlistArrow\s*\{[^}]*min-width:\s*38px[^}]*min-height:\s*34px/);
  assert.match(terminalSource, /canScrollWatchlistLeft/);
  assert.match(terminalSource, /canScrollWatchlistRight/);
});

test("ATR 距离按钮缩小并与价格保持不换行同行", () => {
  assert.match(stylesSource, /\.marketHeaderTop \.quote\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(stylesSource, /\.marketHeaderTop \.quote strong\s*\{[^}]*white-space:\s*nowrap/);
  assert.match(stylesSource, /\.terminalShell \.quote \.metricButton\s*\{[^}]*padding:\s*3px 6px!important[^}]*font-size:\s*10px!important/);
});

test("悬停 K 线详情来自 Lightweight Charts 的 seriesData 和时间数据，展示 OHLC、涨跌幅和振幅", () => {
  assert.match(chartSource, /MouseEventParams/);
  assert.match(chartSource, /param\.seriesData\.get\(candles\)/);
  assert.match(chartSource, /param\.time/);
  for (const field of ["open", "high", "low", "close"]) assert.match(chartSource, new RegExp(`candle\\.${field}`));
  assert.match(chartSource, /amplitudePct/);
  assert.match(chartSource, /振/);
  assert.match(chartSource, /formatCrosshairTime/);
  assert.match(chartSource, /crosshair-candle-details/);
  assert.match(chartSource, /crosshair-price-label/);
  assert.match(chartSource, /Clear marker primitives before replacing candle data/);
});
