import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const radarPath = path.join(root, "app/radar/page.tsx");
const stylesPath = path.join(root, "app/globals.css");
const panelPath = path.join(root, "app/trade/AdaptiveStrategyPanel.tsx");

async function source(file) {
  return fs.readFile(file, "utf8");
}

test("RadarResponse keeps tvScreener optional and presents every coverage state", async () => {
  const radar = await source(radarPath);

  assert.match(radar, /type\s+TvScreenerCoverage\s*=\s*"live"\s*\|\s*"partial"\s*\|\s*"stale"\s*\|\s*"unavailable"/);
  assert.match(radar, /tvScreener\??\s*:\s*TvScreenerResponse/);
  assert.match(radar, /live:\s*\{?\s*label:\s*["']实时/);
  assert.match(radar, /partial:\s*\{?\s*label:\s*["']部分可用/);
  assert.match(radar, /stale:\s*\{?\s*label:\s*["']已过期/);
  assert.match(radar, /unavailable:\s*\{?\s*label:\s*["']不可用/);
  assert.match(radar, /tv-screener-panel/);
  assert.match(radar, /coverage === "stale"|coverage === "unavailable"/);
});

test("TradingView panel exposes provenance, age, symbols, mappings, fields, intervals, warnings, and null as a dash", async () => {
  const radar = await source(radarPath);

  for (const label of ["来源", "抓取时间", "数据年龄", "tvSymbol", "Binance 映射", "字段", "周期", "warnings"]) {
    assert.match(radar, new RegExp(label));
  }
  assert.match(radar, /formatTvDataAge/);
  assert.match(radar, /value === null \|\| value === undefined/);
  assert.match(radar, /return ["']—["']/);
  assert.match(radar, /intervalValues/);
  assert.match(radar, /15:\s*["']15m|["']15["']\s*:\s*["']15m/);
  assert.match(radar, /60:\s*["']1h|["']60["']\s*:\s*["']1h/);
  assert.match(radar, /240:\s*["']4h|["']240["']\s*:\s*["']4h/);
  assert.match(radar, /1D:\s*["']1d|["']1D["']\s*:\s*["']1d/);
  assert.match(radar, /row\.warnings|data\.warnings/);
});

test("TradingView panel has dedicated layout styles so labels and values remain readable", async () => {
  const styles = await source(stylesPath);

  assert.match(styles, /\.radar-terminal \.tv-screener-panel\s*\{/);
  assert.match(styles, /\.radar-terminal \.tv-screener-meta\s*\{/);
  assert.match(styles, /\.radar-terminal \.tv-screener-row\s*\{/);
  assert.match(styles, /\.radar-terminal \.tv-screener-values\s*\{/);
  assert.match(styles, /\.radar-terminal \.tv-screener-intervals\s*\{/);
  assert.match(styles, /\.radar-terminal \.tv-screener-warnings\s*\{/);
  assert.match(styles, /\.tv-screener-values[^{}]*\{[^{}]*display\s*:\s*flex/);
  assert.match(styles, /\.tv-screener-intervals[^{}]*\{[^{}]*display\s*:\s*grid/);
});

test("TradingView evidence is visibly advisory and Binance takes precedence", async () => {
  const radar = await source(radarPath);

  assert.match(radar, /Binance 数据优先/);
  assert.match(radar, /仅作研究参考/);
  assert.match(radar, /不能证明成交或止损触发/);
  assert.match(radar, /stale.*已过期|已过期.*stale/s);
  assert.match(radar, /unavailable.*不可用|不可用.*unavailable/s);
  assert.doesNotMatch(radar, /api\/radar\/tvscreener/);
});

test("the unified live wizard keeps TradingView research out of the execution payload", async () => {
  const panel = await source(panelPath);

  assert.match(panel, /StrategyWizard/);
  assert.doesNotMatch(panel, /research_evidence|tvScreener|\/api\/radar\/tvscreener/);
  assert.doesNotMatch(panel, /\/api\/trade\/conditional-orders/);
});

test("the optional TradingView evidence stays on the radar surface", async () => {
  const radar = await source(radarPath);
  const panel = await source(panelPath);

  assert.match(radar, /tvScreener\??\s*:/);
  assert.match(radar, /tvScreener\?\.coverage/);
  assert.doesNotMatch(panel, /tvScreener|research_evidence/);
});

test("TV research evidence stays outside radar scoring and execution conditions", async () => {
  const radar = await source(radarPath);
  const panel = await source(panelPath);
  const tvPanel = radar.slice(radar.indexOf("function TvScreenerPanel"), radar.indexOf("function ReversalTable"));
  const scoreBlock = panel.slice(panel.indexOf("const score = useMemo"), panel.indexOf("function applyNaturalLanguage"));

  assert.doesNotMatch(tvPanel, /score|participation|risk/i);
  assert.doesNotMatch(scoreBlock, /tvScreener|research_evidence/);
  assert.doesNotMatch(panel, /fetch\("\/api\/trade\/conditional-orders"/);
});

test("radar refreshes only an unavailable TV supplement after the primary response", async () => {
  const radar = await source(radarPath);

  assert.match(radar, /tvScreener\?\.coverage\s*===\s*["']unavailable["']/);
  assert.match(radar, /wait_for_tv/);
  assert.match(radar, /setTimeout\(/);
});
