import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tvRoutePath = path.join(root, "app/api/radar/tvscreener/route.ts");
const radarRoutePath = path.join(root, "app/api/radar/route.ts");

async function source(file) {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return "";
    throw error;
  }
}

async function allSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? allSources(entryPath) : [entryPath];
  }));
  return nested.flat();
}

test("GET /api/radar/tvscreener is an operator-protected read-only route", async () => {
  const route = await source(tvRoutePath);

  assert.notEqual(route, "", "missing app/api/radar/tvscreener/route.ts");
  assert.match(route, /import\s+\{\s*requireOperator\s*\}\s+from\s+["'][^"']*operator-guard/);
  assert.match(route, /export\s+async\s+function\s+GET\s*\(\s*request\s*:\s*Request\s*\)/);
  assert.match(route, /await\s+requireOperator\(request\)/);
  assert.doesNotMatch(route, /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)\b/);
  assert.doesNotMatch(route, /request\.json\s*\(/);
});

test("the page route uses a server-defined closed adapter request and never leaks sidecar configuration", async () => {
  const route = await source(tvRoutePath);

  assert.notEqual(route, "", "missing app/api/radar/tvscreener/route.ts");
  assert.match(route, /assetType:\s*["']crypto["']/);
  assert.match(route, /intervals:\s*\[[^\]]*["']15["'][^\]]*["']60["'][^\]]*["']240["'][^\]]*["']1D["']/);
  assert.match(route, /fields:\s*\[[^\]]*["']PRICE["'][^\]]*["']ATR_14["']/);
  assert.match(route, /sortBy:\s*["']VOLUME["']/);
  assert.doesNotMatch(route, /TVSCREENER_BASE_URL|127\.0\.0\.1|sidecarBaseUrl|process\.env/);
  assert.match(route, /source:\s*["']tradingview-screener["']/);
  assert.match(route, /advisoryOnly:\s*true/);
  assert.match(route, /requestId/);
  assert.match(route, /fetchedAt/);
  assert.match(route, /coverage/);
  assert.match(route, /rows/);
  assert.match(route, /warnings/);
});

test("the sanitized response preserves every coverage state and converts failures to HTTP-200 unavailable data", async () => {
  const route = await source(tvRoutePath);

  assert.notEqual(route, "", "missing app/api/radar/tvscreener/route.ts");
  assert.match(route, /TvScreenerCoverage/);
  assert.match(route, /coverage:\s*["']unavailable["']/);
  assert.match(route, /return\s+Response\.json\([^,]+\)/);
  assert.doesNotMatch(route, /return\s+Response\.json\([^\n]*\berror\s*:/);
  assert.match(route, /sanitize.*Warning|warning.*replace|replace.*https?/i);
});

test("Binance mapping is an exact current USDT-perpetual allowlist lookup and unmapped rows survive", async () => {
  const route = await source(tvRoutePath);

  assert.notEqual(route, "", "missing app/api/radar/tvscreener/route.ts");
  assert.match(route, /listUsdtPerpetualSymbols/);
  assert.match(route, /new\s+Set\(await\s+listUsdtPerpetualSymbols\(\)\)/);
  assert.match(route, /allowedSymbols\.has\([^)]*rawSymbol[^)]*\)\s*\?\s*[^:;]+:\s*null/);
  assert.match(route, /rows:\s*response\.rows\.map/);
  assert.match(route, /mapping unavailable|mapping unconfirmed/i);
  assert.doesNotMatch(route, /rawSymbol\.replace|rawSymbol\.toUpperCase|endsWith\([^)]*USDT/);
});

test("mapping also requires the TradingView row to identify Binance", async () => {
  const route = await source(tvRoutePath);

  assert.match(route, /row\.exchange[^\n]*BINANCE/i);
  assert.match(route, /row\.tvSymbol[^\n]*BINANCE:/i);
  assert.match(route, /binanceSymbol\s*=\s*[^;\n]*isBinance/i);
});

test("radar appends optional tvScreener evidence after analysis without changing score, participation, risks, or lifecycle", async () => {
  const radar = await source(radarRoutePath);

  const analyzeStart = radar.indexOf("function analyze");
  const analyzeEnd = radar.indexOf("function extractRows");
  assert.ok(analyzeStart >= 0 && analyzeEnd > analyzeStart, "expected existing analyze() boundary");
  assert.doesNotMatch(radar.slice(analyzeStart, analyzeEnd), /tvScreener|screenWithTvScreener|loadTvScreenerResearch/);
  assert.match(radar, /loadTvScreenerResearch/);
  assert.doesNotMatch(radar, /Promise\.race/);
  assert.match(radar, /radarTvScreenerRefresh/);
  assert.match(radar, /radarTvScreenerCache/);
  assert.match(radar, /cacheIsFresh/);
  assert.match(radar, /cachedAt\s*<=\s*30_000/);
  assert.match(radar, /return\s+\{\s*\.\.\.payload,\s*tvScreener\s*:/);
  assert.match(radar, /\.map\(analyze\)/);
  assert.match(radar, /cache-control["']?\s*:\s*["']public, max-age=20, s-maxage=45["']/);
  assert.match(radar, /cache-control["']?\s*:\s*["']no-store["']/);
});

test("no order or strategy module imports tvscreener research data", async () => {
  const protectedRoots = [
    path.join(root, "app/api/trade"),
    path.join(root, "app/api/strategy"),
    path.join(root, "app/api/paper"),
    path.join(root, "lib/trade"),
  ];
  const files = (await Promise.all(protectedRoots.map(allSources))).flat()
    .filter((file) => /\.(?:[cm]?[jt]sx?)$/.test(file));

  for (const file of files) {
    const moduleSource = await source(file);
    assert.doesNotMatch(moduleSource, /from\s+["'][^"']*tvscreener[^"']*["']/i, file);
  }
});
