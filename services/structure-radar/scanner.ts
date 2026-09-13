import type { ClosedBar, Timeframe } from "../../lib/structure-radar/types.ts";
import { advanceSignal, signalId, type TrackedSignal } from "../../lib/structure-radar/state-machine.ts";
import { BarCache } from "./bar-cache.ts";
import { parseClosedKlineEvent } from "./binance-public.ts";

type Candidate = {
  symbol: string;
  timeframe: Timeframe;
  setup: "PLATFORM_RECLAIM" | "TRENDLINE_BREAKOUT";
  state: "CANDIDATE";
  detectedAt: number;
  score: number;
  anchorHash: string;
  [key: string]: unknown;
};

type Detector = (
  bars: readonly ClosedBar[],
  context: { symbol: string; timeframe: Timeframe },
) => Promise<Candidate | null> | Candidate | null;

type SignalStoreBoundary = {
  get(id: string): Promise<TrackedSignal | null>;
  list?(): Promise<TrackedSignal[]>;
  save(signal: TrackedSignal): Promise<unknown>;
};

type ScannerOptions = {
  cache: BarCache;
  detectors: readonly Detector[];
  store: SignalStoreBoundary;
  backfill?: (symbol: string, timeframe: Timeframe) => Promise<ClosedBar[]>;
  onSignal?: (signal: TrackedSignal) => Promise<void> | void;
};

function geometryFromCandidate(candidate: Candidate) {
  if (candidate.setup === "PLATFORM_RECLAIM") {
    return {
      platformLower: Number(candidate.platformLower ?? 0),
      tolerance: Number(candidate.tolerance ?? 0),
      invalidationPrice: Number(candidate.invalidationPrice ?? 0),
      atr: Number(candidate.atr ?? 0),
      reclaimHigh: Number(candidate.reclaimHigh ?? 0),
    };
  }
  return {
    projectedLine: Number(candidate.projectedLine ?? 0),
    slopePerBar: Number(candidate.slopePerBar ?? 0),
    tolerance: Number(candidate.tolerance ?? 0),
    breakoutClose: Number(candidate.close ?? 0),
    breakoutHigh: Number(candidate.breakoutHigh ?? 0),
    atr: Number(candidate.atr ?? 0),
  };
}

export class RadarScanner {
  readonly #cache: BarCache;
  readonly #detectors: readonly Detector[];
  readonly #store: SignalStoreBoundary;
  readonly #backfill?: ScannerOptions["backfill"];
  readonly #onSignal?: ScannerOptions["onSignal"];

  constructor(options: ScannerOptions) {
    this.#cache = options.cache;
    this.#detectors = options.detectors;
    this.#store = options.store;
    this.#backfill = options.backfill;
    this.#onSignal = options.onSignal;
  }

  async handleRawEvent(value: unknown) {
    const event = parseClosedKlineEvent(value);
    if (!event) return { status: "ignored" as const };
    return this.handleClosedBar(event.symbol, event.timeframe, event.bar);
  }

  async handleClosedBar(symbol: string, timeframe: Timeframe, bar: ClosedBar) {
    let append = this.#cache.append(symbol, timeframe, bar);
    if (append.status === "duplicate") return { status: "duplicate" as const };
    if (append.status === "gap") {
      if (!this.#backfill) {
        return {
          status: "data_quality_error" as const,
          reason: "KLINE_GAP",
          expectedTime: append.expectedTime,
          receivedTime: append.receivedTime,
        };
      }
      const recovered = await this.#backfill(symbol, timeframe);
      if (!recovered.some((item) => item.time === bar.time)) {
        return { status: "data_quality_error" as const, reason: "BACKFILL_INCOMPLETE" };
      }
      this.#cache.replace(symbol, timeframe, recovered);
      append = { status: "appended", bar };
    }

    const bars = this.#cache.get(symbol, timeframe);
    let transitioned: TrackedSignal | null = null;
    const activeSignals = this.#store.list ? await this.#store.list() : [];
    for (const existing of activeSignals.filter((item) =>
      item.symbol === symbol.toUpperCase() && item.timeframe === timeframe &&
      (item.state === "CANDIDATE" || item.state === "CONFIRMED"),
    )) {
      const advanced = advanceSignal(existing, bars);
      if (advanced.stateVersion !== existing.stateVersion) {
        await this.#store.save(advanced);
        await this.#onSignal?.(advanced);
        transitioned = advanced;
      } else if (advanced.lastProcessedBarTime !== existing.lastProcessedBarTime) {
        await this.#store.save(advanced);
      }
    }
    for (const detector of this.#detectors) {
      const candidate = await detector(bars, { symbol, timeframe });
      if (!candidate) continue;
      const id = signalId(candidate);
      if (await this.#store.get(id)) continue;
      const signal: TrackedSignal = {
        id,
        symbol: candidate.symbol.toUpperCase(),
        timeframe: candidate.timeframe,
        setup: candidate.setup,
        state: "CANDIDATE",
        stateVersion: 1,
        anchorHash: candidate.anchorHash,
        detectedAt: candidate.detectedAt,
        expiresAfterBars: 6,
        lastProcessedBarTime: candidate.detectedAt,
        processedBars: 0,
        score: candidate.score,
        geometry: geometryFromCandidate(candidate),
      };
      await this.#store.save(signal);
      await this.#onSignal?.(signal);
      return { status: "candidate" as const, signal };
    }
    if (transitioned) return { status: "transition" as const, signal: transitioned };
    return { status: "scanned" as const };
  }
}
