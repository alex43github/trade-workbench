import { BarCache } from "./bar-cache.ts";
import { BarkClient, loadBarkConfig } from "./bark.ts";
import { createReadonlyAccountClient } from "./binance-readonly-account.ts";
import { fetchClosedKlines, fetchSqueezeDerivatives, listUsdtPerpetuals, parseClosedKlineEvent } from "./binance-public.ts";
import { loadRadarConfig } from "./config.ts";
import { createRadarHttpServer, listenRadarHttpServer } from "./http-server.ts";
import { RadarOrchestrator, runFourExpertConsultation, type ProcessSignal } from "./orchestrator.ts";
import { RadarRepository } from "./radar-repository.ts";
import { bootstrapMarket, isNotifiableSignalState, radarHealthStatus, trendRadarHealthStatus } from "./runtime.ts";
import { RadarScanner } from "./scanner.ts";
import { KlineWebSocketFeed } from "./websocket-feed.ts";
import { detectPlatformReclaim } from "../../lib/structure-radar/platform-reclaim.ts";
import { detectTrendlineBreakout } from "../../lib/structure-radar/trendline-breakout.ts";
import { buildFocusEvidence } from "../../lib/structure-radar/focus-evidence.ts";
import { PositionMonitor } from "./position-monitor.ts";
import { advanceSqueezeRadar, buildSqueezeBarkMessage, createSqueezeRadarState, type SqueezeRadarState } from "./squeeze-radar.ts";
import { runHourlyRadarCycle, type HourlyRadarCycleResult, type StrongTrendCandidate, type SqueezeCandidate } from "./radar-cadence.ts";
import { advanceTrendRadar, createTrendRadarState, type TrendCandidate, type TrendRadarState } from "./trend-radar.ts";
import { FocusMonitor } from "./focus-monitor.ts";
import { FocusFiveMinuteCache, buildFocusFiveMinuteBatches, fetchClosedFiveMinuteKlines, parseClosedFiveMinuteKlineEvent } from "./focus-five-minute.ts";
import { refreshFocusPool } from "./focus-refresh.ts";
import { fetchManualWatchlistSymbols } from "./focus-watchlist-client.ts";

const config = loadRadarConfig();
const cache = new BarCache({ maxBars: 240 });
const focusFiveMinuteCache = new FocusFiveMinuteCache({ maxBars: 240 });
const repository = new RadarRepository(config.dataDirectory);
const barkConfig = await loadBarkConfig();
const bark = new BarkClient({
  enabled: barkConfig.enabled,
  baseUrl: barkConfig.baseUrl,
  storageDirectory: config.dataDirectory,
});
const apiKey = process.env.BINANCE_FUTURES_API_KEY;
const secret = process.env.BINANCE_FUTURES_API_SECRET;
const positionMonitor = apiKey && secret
  ? new PositionMonitor({ client: createReadonlyAccountClient({ apiKey, secret }) })
  : null;
if (positionMonitor) await positionMonitor.poll();

async function readPosition(signal: ProcessSignal) {
  if (!positionMonitor) return { state: "POSITION_UNKNOWN" };
  return positionMonitor.classify({
    symbol: signal.symbol,
    direction: "LONG",
    candidateAt: signal.detectedAt,
    confirmedAt: signal.state === "CONFIRMED" ? signal.lastProcessedBarTime ?? null : null,
  });
}

const orchestrator = new RadarOrchestrator({
  repository,
  consult: (signal, marketSnapshot) => runFourExpertConsultation({
    signal,
    marketSnapshot,
    skillPaths: config.skillPaths,
  }),
  readPosition,
  notifier: bark,
});

const scanner = new RadarScanner({
  cache,
  detectors: [
    (bars, context) => detectPlatformReclaim(bars, { ...context }),
    (bars, context) => detectTrendlineBreakout(bars, { ...context }),
  ],
  store: repository,
  backfill: (symbol, timeframe) => fetchClosedKlines(symbol, timeframe, 240),
  onSignal: async (signal) => {
    await recordTrendSignal(signal);
    // 15m remains in the cache for squeeze reclaim/second-test detection, but
    // generic standalone 15m Bark notices are deliberately disabled.
    if (signal.timeframe === "15m") return;
    const bars = cache.get(signal.symbol, signal.timeframe);
    const latest = bars.at(-1);
    if (!latest || !isNotifiableSignalState(signal.state)) return;
    const processSignal: ProcessSignal = { ...signal, state: signal.state, close: latest.close, mode: "live" };
    await orchestrator.processCandidate(processSignal, {
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      setup: signal.setup,
      close: latest.close,
      bars,
    });
  },
});

const bootstrap = await bootstrapMarket({
  cache,
  timeframes: config.timeframes,
  listSymbols: () => listUsdtPerpetuals(),
  fetchBars: (symbol, timeframe) => fetchClosedKlines(symbol, timeframe, 240),
  concurrency: 5,
  maximumStreamsPerConnection: 200,
  minimumStartIntervalMs: 250,
});

let lastEventAt = new Date().toISOString();
let lastSqueezeScanAt: string | null = null;
let lastSqueezeCycle = { checked: 0, deepValidated: 0, dataSourceDegraded: 0 };
let lastHourlyDigestCycle: (HourlyRadarCycleResult & { completedAt: string }) | null = null;
let lastTrendCycleAt: string | null = null;
let lastFocusProcessed: Record<"5m" | "15m" | "1h", string | null> = { "5m": null, "15m": null, "1h": null };
let lastFocusFiveMinuteEventAt: string | null = null;
let currentFocusPoolSize = 0;
let focusFeedSymbolCount = 0;
let focusFeed: KlineWebSocketFeed | null = null;
let focusFeedKey = "";
let focusRefreshRunning = false;
let watchlistSymbols = await fetchManualWatchlistSymbols(process.env.WORKBENCH_BASE_URL || "http://127.0.0.1:3000", config.localToken);
let lastHourlyRadarSnapshot: {
  status: "not_run" | "ok" | "degraded";
  scannedAt: string | null;
  updatedAt: string;
  universeDenominator: number;
  strongTrendCandidates: StrongTrendCandidate[];
  squeezeCandidates: SqueezeCandidate[];
  failure?: HourlyRadarCycleResult["failure"];
} = {
  status: "not_run",
  scannedAt: null,
  updatedAt: new Date().toISOString(),
  universeDenominator: bootstrap.symbols.length,
  strongTrendCandidates: [],
  squeezeCandidates: [],
};

const derivativeCache = new Map<string, { fetchedAt: number; value: Awaited<ReturnType<typeof fetchSqueezeDerivatives>> }>();
function focusDerivatives(symbol: string) {
  // Focus decisions consume the latest derivatives snapshot produced by the
  // hourly squeeze scan. They never fan out a second 6-endpoint derivatives
  // burst on every 5m close. Missing/old context fails closed in evidence.
  const cached = derivativeCache.get(symbol);
  return cached && Date.now() - cached.fetchedAt <= 90 * 60 * 1_000 ? cached.value : undefined;
}

const focusMonitor = new FocusMonitor({
  repository,
  readBars: (symbol, timeframe) => timeframe === "5m" ? focusFiveMinuteCache.get(symbol) : cache.get(symbol, timeframe),
  evidence: async (record) => {
    const positions = positionMonitor?.snapshot().positions ?? [];
    const long = positions.some((position) => position.symbol === record.symbol && position.side === "LONG" && position.quantity > 0);
    return buildFocusEvidence({
      record,
      bars5m: focusFiveMinuteCache.get(record.symbol),
      bars15m: cache.get(record.symbol, "15m"),
      bars1h: cache.get(record.symbol, "1h"),
      btc1h: cache.get("BTCUSDT", "1h"),
      eth1h: cache.get("ETHUSDT", "1h"),
      derivatives: focusDerivatives(record.symbol),
      hasLongPosition: long,
    });
  },
  send: (message) => bark.sendOnce(message),
});

function storedTrend(value: Record<string, unknown> | null, symbol: string, timeframe: TrendCandidate["timeframe"]): TrendRadarState {
  if (!value) return createTrendRadarState(symbol, timeframe);
  const candidate = value as Partial<TrendRadarState>;
  return candidate.id && candidate.symbol && candidate.timeframe === timeframe && candidate.stage && candidate.detectorVersion
    ? candidate as TrendRadarState : createTrendRadarState(symbol, timeframe);
}

async function recordTrendSignal(signal: { symbol: string; timeframe: string; state: string; score?: number; lastProcessedBarTime?: number }) {
  if ((signal.timeframe !== "1h" && signal.timeframe !== "4h") || !Number.isFinite(signal.score) ||
    (signal.state !== "CANDIDATE" && signal.state !== "CONFIRMED" && signal.state !== "ADD_CANDIDATE")) return;
  const candidate: TrendCandidate = {
    symbol: signal.symbol,
    timeframe: signal.timeframe,
    candleCloseTime: signal.lastProcessedBarTime ?? 0,
    score: signal.score!,
    state: signal.state,
  };
  const previous = storedTrend(await repository.getTrend(`trend:${candidate.symbol.toUpperCase()}:${candidate.timeframe}`), candidate.symbol, candidate.timeframe);
  const result = advanceTrendRadar(previous, candidate);
  if (result.state !== previous) await repository.saveTrend(result.state);
}

function storedSqueeze(value: Record<string, unknown> | null, symbol: string): SqueezeRadarState {
  if (!value) return createSqueezeRadarState(symbol);
  const candidate = value as Partial<SqueezeRadarState>;
  return candidate.id && candidate.symbol && candidate.stage && candidate.detectorVersion
    ? candidate as SqueezeRadarState : createSqueezeRadarState(symbol);
}

async function scanSqueeze(symbol: string) {
  const bars1h = cache.get(symbol, "1h");
  const bars4h = cache.get(symbol, "4h");
  const bars15m = cache.get(symbol, "15m");
  if (bars1h.length < 7 || bars4h.length < 5 || bars15m.length < 5) return { checked: 1, deepValidated: 0, dataSourceDegraded: 1 };
  const derivatives = await fetchSqueezeDerivatives(symbol);
  const previous = storedSqueeze(await repository.getSqueeze(`squeeze:${symbol.toUpperCase()}`), symbol);
  const snapshot = {
    symbol,
    at: new Date().toISOString(),
    bars1h,
    bars4h,
    bars15m,
    derivatives,
    btcRelativeStrengthPct: (() => {
      const btc = cache.get("BTCUSDT", "1h");
      return btc.length >= 7 ? ((bars1h.at(-1)!.close / bars1h.at(-7)!.close) - (btc.at(-1)!.close / btc.at(-7)!.close)) * 100 : undefined;
    })(),
    ethRelativeStrengthPct: (() => {
      const eth = cache.get("ETHUSDT", "1h");
      return eth.length >= 7 ? ((bars1h.at(-1)!.close / bars1h.at(-7)!.close) - (eth.at(-1)!.close / eth.at(-7)!.close)) * 100 : undefined;
    })(),
  };
  const result = advanceSqueezeRadar(previous, snapshot);
  await repository.saveSqueeze(result.state);
  derivativeCache.set(symbol, { fetchedAt: Date.now(), value: derivatives });
  lastSqueezeScanAt = snapshot.at;
  lastSqueezeCycle = { checked: 1, deepValidated: derivatives ? 1 : 0, dataSourceDegraded: derivatives ? 0 : 1 };
  if (result.transitioned) {
    const message = buildSqueezeBarkMessage(result.state, snapshot);
    if (message) await bark.sendOnce(message);
  }
  return lastSqueezeCycle;
}

async function scanSqueezeUniverse() {
  const results: Array<{ checked: number; deepValidated: number; dataSourceDegraded: number }> = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(5, bootstrap.symbols.length) }, async () => {
    while (next < bootstrap.symbols.length) {
      const symbol = bootstrap.symbols[next++];
      try { results.push(await scanSqueeze(symbol)); }
      catch { results.push({ checked: 1, deepValidated: 0, dataSourceDegraded: 1 }); }
    }
  }));
  return results.reduce((total, item) => ({
    checked: total.checked + item.checked,
    deepValidated: total.deepValidated + item.deepValidated,
    dataSourceDegraded: total.dataSourceDegraded + item.dataSourceDegraded,
  }), { checked: 0, deepValidated: 0, dataSourceDegraded: 0 });
}

async function processFocusClosed(symbol: string, timeframe: "5m" | "15m" | "1h") {
  const result = await focusMonitor.processClosedTimeframe(symbol, timeframe);
  if (result.status === "processed") lastFocusProcessed[timeframe] = new Date().toISOString();
  return result;
}

async function syncFocusFiveMinuteFeed(symbolsInput: readonly string[]) {
  const tradable = new Set(bootstrap.symbols);
  const symbols = [...new Set(symbolsInput.map((symbol) => symbol.toUpperCase()).filter((symbol) => tradable.has(symbol)))].sort();
  const nextKey = symbols.join(",");
  if (nextKey === focusFeedKey) return;
  focusFeed?.stop();
  focusFeed = null;
  focusFeedKey = nextKey;
  focusFeedSymbolCount = symbols.length;
  if (!symbols.length) return;

  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, symbols.length) }, async () => {
    while (next < symbols.length) {
      const symbol = symbols[next++];
      try { focusFiveMinuteCache.replace(symbol, await fetchClosedFiveMinuteKlines(symbol, 240)); }
      catch { /* fail closed: missing 5m data keeps decision non-actionable */ }
    }
  }));

  focusFeed = new KlineWebSocketFeed({
    batches: buildFocusFiveMinuteBatches(symbols, 200),
    onEvent: async (event) => {
      const closed = parseClosedFiveMinuteKlineEvent(event);
      if (!closed) return;
      lastFocusFiveMinuteEventAt = new Date().toISOString();
      const appended = focusFiveMinuteCache.append(closed.symbol, closed.bar);
      if (appended.status === "gap") {
        try { focusFiveMinuteCache.replace(closed.symbol, await fetchClosedFiveMinuteKlines(closed.symbol, 240)); }
        catch { return; }
      } else if (appended.status === "duplicate") {
        return;
      }
      await processFocusClosed(closed.symbol, "5m");
    },
  });
  focusFeed.start();
}

async function refreshFocusMembership(now = new Date().toISOString()) {
  const [trends, squeezes] = await Promise.all([repository.listTrends(), repository.listSqueezes()]);
  const positions = positionMonitor?.snapshot().positions ?? [];
  const focus = await refreshFocusPool({
    repository,
    trends,
    squeezes,
    positions,
    watchlistSymbols,
    now,
  });
  currentFocusPoolSize = focus.length;
  await syncFocusFiveMinuteFeed(focus.map((item) => item.symbol));
  return focus;
}

async function guardedRefreshFocusMembership() {
  if (focusRefreshRunning) return;
  focusRefreshRunning = true;
  try { await refreshFocusMembership(); }
  finally { focusRefreshRunning = false; }
}

async function hourlyStrongTrendCandidates(): Promise<StrongTrendCandidate[]> {
  const focusBySymbol = new Map((await repository.listFocus()).map((item) => [item.symbol, item]));
  return (await repository.listTrends()).flatMap((item) => {
    const score = typeof item.score === "number" ? item.score : Number.NaN;
    const state = typeof item.signalState === "string" ? item.signalState : "";
    const focus = focusBySymbol.get(item.symbol);
    return item.stage === "ACTIONABLE" && score >= 80 && ["CANDIDATE", "CONFIRMED", "ADD_CANDIDATE"].includes(state)
      ? [{
          symbol: item.symbol,
          score,
          state,
          direction: focus?.bias === "SHORT" ? "SHORT" : focus?.bias === "NEUTRAL" ? "NEUTRAL" : focus?.bias === "UNKNOWN" ? "UNKNOWN" : "LONG",
          stage: item.stage,
          action: focus?.lastDecision ?? "WATCH_ONLY",
          reasonCodes: [item.timeframe === "4h" ? "4H_TREND" : "1H_TREND", "STRUCTURE_SCORE_80_PLUS"],
        }] : [];
  });
}

async function hourlySqueezeCandidates(): Promise<SqueezeCandidate[]> {
  const focusBySymbol = new Map((await repository.listFocus()).map((item) => [item.symbol, item]));
  return (await repository.listSqueezes()).flatMap((item) => {
    const state = storedSqueeze(item, item.symbol);
    const focus = focusBySymbol.get(state.symbol);
    return ["SQUEEZE_ACTIVE", "ACTIONABLE", "REIGNITION_READY", "SHORT_PERMISSION_PENDING", "LONG_PERMISSION_PENDING"].includes(state.stage)
      ? [{
          symbol: state.symbol,
          stage: state.stage,
          direction: state.direction,
          action: focus?.lastDecision,
          reasonCodes: state.reasonCodes,
        }] : [];
  });
}

async function runScheduledHourlyRadarCycle() {
  const cycleAt = new Date().toISOString();
  let trendSnapshot: StrongTrendCandidate[] = [];
  let squeezeSnapshot: SqueezeCandidate[] = [];
  const result = await runHourlyRadarCycle({
    cycleAt,
    universeDenominator: bootstrap.symbols.length,
    scanUniverse: async () => {
      const cycle = await scanSqueezeUniverse();
      lastSqueezeCycle = cycle;
      if (cycle.dataSourceDegraded === 0) lastSqueezeScanAt = cycleAt;
      await refreshFocusMembership(cycleAt);
      return cycle;
    },
    strongTrendCandidates: async () => { trendSnapshot = await hourlyStrongTrendCandidates(); return trendSnapshot; },
    squeezeCandidates: async () => { squeezeSnapshot = await hourlySqueezeCandidates(); return squeezeSnapshot; },
    send: (message) => bark.sendOnce(message),
  });
  const completedAt = new Date().toISOString();
  lastHourlyDigestCycle = { ...result, completedAt };
  lastHourlyRadarSnapshot = {
    status: result.status === "completed" ? "ok" : "degraded",
    scannedAt: cycleAt,
    updatedAt: completedAt,
    universeDenominator: bootstrap.symbols.length,
    strongTrendCandidates: trendSnapshot,
    squeezeCandidates: squeezeSnapshot,
    ...(result.failure ? { failure: result.failure } : {}),
  };
  if (result.status === "completed") lastTrendCycleAt = completedAt;
}

function scheduleNextHourlyRadarCycle() {
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(2, 0, 0);
  if (next <= now) next.setUTCHours(next.getUTCHours() + 1);
  setTimeout(() => {
    void runScheduledHourlyRadarCycle().finally(scheduleNextHourlyRadarCycle);
  }, next.valueOf() - now.valueOf());
}

// A single public-market baseline scan proves the detector path is live after
// bootstrap without pretending that startup has already deep-validated every
// tradable contract. Subsequent 1H closed candles drive the full universe.
try { await scanSqueeze("BTCUSDT"); }
catch { lastSqueezeCycle = { checked: 1, deepValidated: 0, dataSourceDegraded: 1 }; }

await refreshFocusMembership();
scheduleNextHourlyRadarCycle();
const positionTimer = positionMonitor ? setInterval(() => {
  void positionMonitor.poll().then(() => guardedRefreshFocusMembership());
}, 30_000) : null;
const focusRefreshTimer = setInterval(() => void guardedRefreshFocusMembership(), 5 * 60_000);

const feed = new KlineWebSocketFeed({
  batches: bootstrap.batches,
  onEvent: async (event) => {
    lastEventAt = new Date().toISOString();
    await scanner.handleRawEvent(event);
    const closed = parseClosedKlineEvent(event);
    if (!closed) return;
    if (closed.timeframe === "1h") {
      try { await scanSqueeze(closed.symbol); }
      catch { lastSqueezeCycle = { checked: 1, deepValidated: 0, dataSourceDegraded: 1 }; }
    }
    if (closed.timeframe === "15m" || closed.timeframe === "1h") {
      await processFocusClosed(closed.symbol, closed.timeframe);
    }
  },
});
feed.start();

const api = createRadarHttpServer({
  token: config.localToken,
  repository,
  listFocusPool: () => repository.listFocus(),
  getFocusPool: (symbol) => repository.getFocus(symbol),
  getHourlyRadar: async () => lastHourlyRadarSnapshot,
  syncFocusSources: async (watchlist) => {
    watchlistSymbols = [...watchlist];
    const focus = await refreshFocusMembership();
    return { accepted: true, watchlist: [...watchlistSymbols], focusPoolSize: focus.length, updatedAt: new Date().toISOString() };
  },
  health: () => ({
    status: lastHourlyDigestCycle?.status === "failed" || trendRadarHealthStatus({ lastSuccessfulCycleAt: lastTrendCycleAt }) !== "ok" ? "degraded" : radarHealthStatus({
      bootstrapFailures: bootstrap.failures.length,
      lastSuccessfulScanAt: lastSqueezeScanAt,
      lastCycle: lastSqueezeCycle,
    }),
    symbols: bootstrap.symbols.length,
    bootstrapFailures: bootstrap.failures.length,
    notifications: barkConfig.publicStatus,
    lastEventAt,
    squeeze: {
      detectorVersion: "SQUEEZE_RADAR_V0.1_RESEARCH",
      lastSuccessfulScanAt: lastSqueezeScanAt,
      lastCycle: lastSqueezeCycle,
      routes: { oneHour: true, fourHour: true, standaloneFifteenMinute: false, squeeze: true, hourlyStrongTrendDigest: true, hourlySqueezeDigest: true },
      hourlyDigest: lastHourlyDigestCycle,
    },
    trend: {
      detectorVersion: "TREND_RADAR_V0.1_RESEARCH",
      lastSuccessfulCycleAt: lastTrendCycleAt,
      health: trendRadarHealthStatus({ lastSuccessfulCycleAt: lastTrendCycleAt }),
      routes: { closedOneHour: true, closedFourHour: true, standaloneFifteenMinute: false, hourlyTrendDigest: true, hourlySqueezeDigest: true },
    },
    focus: {
      size: currentFocusPoolSize,
      fiveMinuteFeedSymbols: focusFeedSymbolCount,
      lastFiveMinuteEventAt: lastFocusFiveMinuteEventAt,
      lastSuccessfulProcessingAt: lastFocusProcessed,
      routes: { fiveMinute: true, fifteenMinute: true, oneHour: true, rawFiveMinuteMa30Bark: false },
    },
    realOrderRouteEnabled: false,
  }),
  rescan: async () => ({ accepted: true, message: "restart/backfill is handled by the running feed" }),
});
const server = await listenRadarHttpServer(api, { hostname: config.hostname, port: config.port });
process.stdout.write(`Structure radar listening on http://${server.hostname}:${server.port} (${bootstrap.symbols.length} symbols, ${currentFocusPoolSize} focus, Bark ${barkConfig.enabled ? "enabled" : "disabled"})\n`);

async function shutdown() {
  if (positionTimer) clearInterval(positionTimer);
  clearInterval(focusRefreshTimer);
  focusFeed?.stop();
  feed.stop();
  await server.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
