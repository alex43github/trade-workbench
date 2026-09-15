import type { ClosedBar, SignalState, Timeframe } from "../../lib/structure-radar/types.ts";
import { BarCache } from "./bar-cache.ts";
import { buildKlineStreamBatches } from "./binance-public.ts";
import { HOURLY_RADAR_CADENCE_MS } from "./radar-cadence.ts";
import { FEED_STALE_AFTER_MS } from "./websocket-feed.ts";

export { FEED_STALE_AFTER_MS } from "./websocket-feed.ts";

const NOTIFIABLE_STATES = new Set<SignalState>([
  "CANDIDATE",
  "CONFIRMED",
  "ADD_CANDIDATE",
  "TAKE_PROFIT_WATCH",
  "INVALIDATED",
]);

export const SQUEEZE_SCAN_CADENCE_MS = HOURLY_RADAR_CADENCE_MS;
export const SQUEEZE_SCAN_STALE_AFTER_MS = SQUEEZE_SCAN_CADENCE_MS * 2;
export const FEED_RECOVERY_GRACE_MS = FEED_STALE_AFTER_MS * 2;

export type NotifiableSignalState = "CANDIDATE" | "CONFIRMED" | "ADD_CANDIDATE" | "TAKE_PROFIT_WATCH" | "INVALIDATED";

export function isNotifiableSignalState(state: SignalState): state is NotifiableSignalState {
  return NOTIFIABLE_STATES.has(state);
}

export function radarHealthStatus(input: {
  bootstrapFailures: number;
  lastSuccessfulScanAt: string | null;
  lastCycle: { dataSourceDegraded: number };
  now?: number;
}) {
  if (!input.lastSuccessfulScanAt || input.lastCycle.dataSourceDegraded > 0) return "degraded";
  const lastSuccessfulScanAt = Date.parse(input.lastSuccessfulScanAt);
  if (!Number.isFinite(lastSuccessfulScanAt) || (input.now ?? Date.now()) - lastSuccessfulScanAt > SQUEEZE_SCAN_STALE_AFTER_MS) return "degraded";
  return "ok";
}

export function trendRadarHealthStatus(input: { lastSuccessfulCycleAt: string | null; now?: number }) {
  if (!input.lastSuccessfulCycleAt) return "degraded";
  const cycleAt = Date.parse(input.lastSuccessfulCycleAt);
  if (!Number.isFinite(cycleAt) || (input.now ?? Date.now()) - cycleAt > SQUEEZE_SCAN_STALE_AFTER_MS) return "degraded";
  return "ok";
}

type FeedBatchHealth = {
  batch: number;
  state: "connecting" | "open" | "closed" | "error";
  updatedAt: string;
  lastActivityAt: string | null;
};

function staleAt(timestamp: string | null, now: number, threshold: number) {
  const value = timestamp ? Date.parse(timestamp) : Number.NaN;
  return !Number.isFinite(value) || now - value > threshold;
}

export function feedUnhealthyBatchCount(input: {
  startedAt: string;
  batches: readonly FeedBatchHealth[];
  now?: number;
  staleAfterMs?: number;
  graceMs?: number;
}) {
  const now = input.now ?? Date.now();
  const staleAfterMs = input.staleAfterMs ?? FEED_STALE_AFTER_MS;
  const graceMs = input.graceMs ?? FEED_RECOVERY_GRACE_MS;
  const starting = !staleAt(input.startedAt, now, graceMs);
  return input.batches.filter((batch) => {
    if (batch.state === "open") return staleAt(batch.lastActivityAt ?? batch.updatedAt, now, staleAfterMs);
    return !starting && staleAt(batch.updatedAt, now, graceMs);
  }).length;
}

export function feedHealthStatus(input: {
  startedAt: string;
  lastActivityAt: string | null;
  batches: readonly FeedBatchHealth[];
  now?: number;
  staleAfterMs?: number;
  graceMs?: number;
}) {
  const now = input.now ?? Date.now();
  const staleAfterMs = input.staleAfterMs ?? FEED_STALE_AFTER_MS;
  if (staleAt(input.lastActivityAt, now, staleAfterMs)) return "degraded";
  return feedUnhealthyBatchCount({ ...input, now, staleAfterMs }) > 0 ? "degraded" : "ok";
}

export async function bootstrapMarket(options: {
  cache: BarCache;
  timeframes: readonly Timeframe[];
  listSymbols: () => Promise<readonly { symbol: string }[]>;
  fetchBars: (symbol: string, timeframe: Timeframe) => Promise<ClosedBar[]>;
  maximumStreamsPerConnection?: number;
  concurrency?: number;
  minimumStartIntervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}) {
  const symbols = (await options.listSymbols()).map((item) => item.symbol.toUpperCase());
  const jobs = symbols.flatMap((symbol) => options.timeframes.map((timeframe) => ({ symbol, timeframe })));
  const failures: { symbol: string; timeframe: Timeframe; error: string }[] = [];
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 5));
  let nextJob = 0;
  let nextStartAt = 0;
  let throttleQueue: Promise<void> = Promise.resolve();
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  // Binance klines have a non-trivial request weight. Keep the production
  // bootstrap below a conservative rate; tests can inject a shorter interval.
  const interval = Math.max(0, options.minimumStartIntervalMs ?? 250);
  async function launchAtStartSlot<T>(operation: () => Promise<T>): Promise<T> {
    let resolveLaunch!: (operationPromise: Promise<T>) => void;
    const launched = new Promise<Promise<T>>((resolve) => { resolveLaunch = resolve; });
    const slot = throttleQueue.then(async () => {
      const wait = Math.max(0, nextStartAt - now());
      if (wait > 0) await sleep(wait);
      const operationPromise = operation();
      nextStartAt = Math.max(nextStartAt, now()) + interval;
      resolveLaunch(operationPromise);
    });
    throttleQueue = slot.catch(() => undefined);
    await slot;
    return launched;
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob++];
      try {
        options.cache.replace(job.symbol, job.timeframe, await launchAtStartSlot(() => options.fetchBars(job.symbol, job.timeframe)));
      } catch (error) {
        failures.push({ symbol: job.symbol, timeframe: job.timeframe, error: error instanceof Error ? error.message : "bootstrap failed" });
      }
    }
  }));
  return {
    symbols,
    failures,
    batches: buildKlineStreamBatches(symbols, options.timeframes, options.maximumStreamsPerConnection ?? 200),
  };
}
