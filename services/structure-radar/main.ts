import { BarCache } from "./bar-cache.ts";
import { BarkClient, loadBarkConfig } from "./bark.ts";
import { createReadonlyAccountClient } from "./binance-readonly-account.ts";
import { fetchClosedKlines, listUsdtPerpetuals } from "./binance-public.ts";
import { loadRadarConfig } from "./config.ts";
import { createRadarHttpServer, listenRadarHttpServer } from "./http-server.ts";
import { RadarOrchestrator, runFourExpertConsultation, type ProcessSignal } from "./orchestrator.ts";
import { RadarRepository } from "./radar-repository.ts";
import { bootstrapMarket, isNotifiableSignalState } from "./runtime.ts";
import { RadarScanner } from "./scanner.ts";
import { KlineWebSocketFeed } from "./websocket-feed.ts";
import { detectPlatformReclaim } from "../../lib/structure-radar/platform-reclaim.ts";
import { detectTrendlineBreakout } from "../../lib/structure-radar/trendline-breakout.ts";
import { PositionMonitor } from "./position-monitor.ts";

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
const feed = new KlineWebSocketFeed({
  batches: bootstrap.batches,
  onEvent: async (event) => {
    lastEventAt = new Date().toISOString();
    await scanner.handleRawEvent(event);
  },
});
feed.start();

const api = createRadarHttpServer({
  token: config.localToken,
  repository,
  health: () => ({
    status: bootstrap.failures.length > 0 ? "degraded" : "ok",
    symbols: bootstrap.symbols.length,
    bootstrapFailures: bootstrap.failures.length,
    notifications: barkConfig.publicStatus,
    lastEventAt,
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
