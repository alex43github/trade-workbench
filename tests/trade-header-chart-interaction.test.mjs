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
