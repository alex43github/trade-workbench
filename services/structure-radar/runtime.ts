import type { ClosedBar, Timeframe } from "../../lib/structure-radar/types.ts";
import { BarCache } from "./bar-cache.ts";
import { buildKlineStreamBatches } from "./binance-public.ts";

export async function bootstrapMarket(options: {
  cache: BarCache;
  timeframes: readonly Timeframe[];
  listSymbols: () => Promise<readonly { symbol: string }[]>;
  fetchBars: (symbol: string, timeframe: Timeframe) => Promise<ClosedBar[]>;
  maximumStreamsPerConnection?: number;
  concurrency?: number;
}) {
  const symbols = (await options.listSymbols()).map((item) => item.symbol.toUpperCase());
  const jobs = symbols.flatMap((symbol) => options.timeframes.map((timeframe) => ({ symbol, timeframe })));
  const failures: { symbol: string; timeframe: Timeframe; error: string }[] = [];
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 5));
  let nextJob = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob++];
      try {
        options.cache.replace(job.symbol, job.timeframe, await options.fetchBars(job.symbol, job.timeframe));
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
