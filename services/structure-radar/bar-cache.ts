import { validateClosedBars } from "../../lib/structure-radar/math.ts";
import type { ClosedBar, Timeframe } from "../../lib/structure-radar/types.ts";
import { TIMEFRAME_SECONDS } from "./config.ts";

type AppendResult =
  | { status: "appended"; bar: ClosedBar }
  | { status: "duplicate"; bar: ClosedBar }
  | { status: "gap"; expectedTime: number; receivedTime: number };

export class BarCache {
  readonly #maxBars: number;
  readonly #series = new Map<string, ClosedBar[]>();

  constructor({ maxBars = 240 }: { maxBars?: number } = {}) {
    if (!Number.isInteger(maxBars) || maxBars < 1) throw new Error("maxBars must be a positive integer");
    this.#maxBars = maxBars;
  }

  #key(symbol: string, timeframe: Timeframe) {
    return `${symbol.toUpperCase()}:${timeframe}`;
  }

  replace(symbol: string, timeframe: Timeframe, bars: readonly ClosedBar[]) {
    validateClosedBars(bars);
    this.#series.set(this.#key(symbol, timeframe), bars.slice(-this.#maxBars));
  }

  get(symbol: string, timeframe: Timeframe) {
    return [...(this.#series.get(this.#key(symbol, timeframe)) ?? [])];
  }

  append(symbol: string, timeframe: Timeframe, bar: ClosedBar): AppendResult {
    validateClosedBars([bar]);
    const key = this.#key(symbol, timeframe);
    const bars = this.#series.get(key) ?? [];
    const last = bars.at(-1);
    if (last && bar.time === last.time) return { status: "duplicate", bar: last };
    if (last) {
      const expectedTime = last.time + TIMEFRAME_SECONDS[timeframe];
      if (bar.time !== expectedTime) return { status: "gap", expectedTime, receivedTime: bar.time };
    }
    const next = [...bars, bar].slice(-this.#maxBars);
    this.#series.set(key, next);
    return { status: "appended", bar };
  }

  quality(symbol: string, timeframe: Timeframe, nowSeconds: number) {
    const bars = this.#series.get(this.#key(symbol, timeframe)) ?? [];
    const latest = bars.at(-1);
    if (!latest) return { status: "missing" as const, latestTime: null };
    const staleAfter = TIMEFRAME_SECONDS[timeframe] * 2;
    return nowSeconds - latest.time > staleAfter
      ? { status: "stale" as const, latestTime: latest.time }
      : { status: "ready" as const, latestTime: latest.time };
  }
}
