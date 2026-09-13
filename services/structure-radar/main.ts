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
import { PositionMonitor } from "./position-monitor.ts";
import { advanceSqueezeRadar, buildSqueezeBarkMessage, createSqueezeRadarState, type SqueezeRadarState } from "./squeeze-radar.ts";
import { runHourlyRadarCycle, type HourlyRadarCycleResult } from "./radar-cadence.ts";
import { advanceTrendRadar, createTrendRadarState, type TrendCandidate, type TrendRadarState } from "./trend-radar.ts";

const config = loadRadarConfig();
const cache = new BarCache({ maxBars: 240 });
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
const positionTimer = positionMonitor ? setInterval(() => void positionMonitor.poll(), 30_000) : null;

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

async function hourlyStrongTrendCandidates() {
  return (await repository.listTrends()).flatMap((item) => {
    const score = typeof item.score === "number" ? item.score : Number.NaN;
    const state = typeof item.signalState === "string" ? item.signalState : "";
    return item.stage === "ACTIONABLE" && score >= 80 && ["CANDIDATE", "CONFIRMED", "ADD_CANDIDATE"].includes(state)
      ? [{ symbol: item.symbol, score, state }] : [];
  });
}

async function hourlySqueezeCandidates() {
  return (await repository.listSqueezes()).flatMap((item) => {
    const state = storedSqueeze(item, item.symbol);
    return ["SQUEEZE_ACTIVE", "ACTIONABLE", "REIGNITION_READY", "SHORT_PERMISSION_PENDING", "LONG_PERMISSION_PENDING"].includes(state.stage)
      ? [{ symbol: state.symbol, stage: state.stage, direction: state.direction }] : [];
  });
}

async function runScheduledHourlyRadarCycle() {
  const cycleAt = new Date().toISOString();
  const result = await runHourlyRadarCycle({
    cycleAt,
    universeDenominator: bootstrap.symbols.length,
    scanUniverse: async () => {
      const cycle = await scanSqueezeUniverse();
      lastSqueezeCycle = cycle;
      if (cycle.dataSourceDegraded === 0) lastSqueezeScanAt = cycleAt;
      return cycle;
    },
    strongTrendCandidates: hourlyStrongTrendCandidates,
    squeezeCandidates: hourlySqueezeCandidates,
    send: (message) => bark.sendOnce(message),
  });
  lastHourlyDigestCycle = { ...result, completedAt: new Date().toISOString() };
  if (result.status === "completed") lastTrendCycleAt = lastHourlyDigestCycle.completedAt;
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

scheduleNextHourlyRadarCycle();

const feed = new KlineWebSocketFeed({
  batches: bootstrap.batches,
  onEvent: async (event) => {
    lastEventAt = new Date().toISOString();
    await scanner.handleRawEvent(event);
    const closed = parseClosedKlineEvent(event);
    if (closed?.timeframe === "1h") {
      try { await scanSqueeze(closed.symbol); }
      catch { lastSqueezeCycle = { checked: 1, deepValidated: 0, dataSourceDegraded: 1 }; }
    }
  },
});
feed.start();

const api = createRadarHttpServer({
  token: config.localToken,
  repository,
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
    realOrderRouteEnabled: false,
  }),
  rescan: async () => ({ accepted: true, message: "restart/backfill is handled by the running feed" }),
});
const server = await listenRadarHttpServer(api, { hostname: config.hostname, port: config.port });
process.stdout.write(`Structure radar listening on http://${server.hostname}:${server.port} (${bootstrap.symbols.length} symbols, Bark ${barkConfig.enabled ? "enabled" : "disabled"})\n`);

async function shutdown() {
  if (positionTimer) clearInterval(positionTimer);
  feed.stop();
  await server.close();
  process.exit(0);
}
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
