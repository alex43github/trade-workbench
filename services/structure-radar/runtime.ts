import type { ClosedBar, SignalState, Timeframe } from "../../lib/structure-radar/types.ts";
import { BarCache } from "./bar-cache.ts";
import { buildKlineStreamBatches } from "./binance-public.ts";

const NOTIFIABLE_STATES = new Set<SignalState>([
  "CANDIDATE",
  "CONFIRMED",
  "ADD_CANDIDATE",
  "TAKE_PROFIT_WATCH",
  "INVALIDATED",
]);

export type NotifiableSignalState = "CANDIDATE" | "CONFIRMED" | "ADD_CANDIDATE" | "TAKE_PROFIT_WATCH" | "INVALIDATED";

export function isNotifiableSignalState(state: SignalState): state is NotifiableSignalState {
  return NOTIFIABLE_STATES.has(state);
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
