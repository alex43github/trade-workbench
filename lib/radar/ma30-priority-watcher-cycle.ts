import type { Ma30PriorityWatchItem } from "./ma30-priority-watchlist.ts";
import {
  detectMa30BodyCross,
  evaluateMa30Reignition,
  type Ma30PriorityBar,
  type Ma30PrioritySignalInterval,
} from "./ma30-priority-signals.ts";

export type Ma30PriorityReignitionState = {
  lastPullbackAt: number | null;
  lastIgnitedPullbackAt: number | null;
  lastIgnitedAt: number | null;
};

export type Ma30PriorityReignitionStateMap = Record<string, Ma30PriorityReignitionState>;

export type Ma30PriorityWatcherFetcher = (
  symbol: string,
  interval: Ma30PrioritySignalInterval,
  now: Date,
) => Promise<Ma30PriorityBar[]>;

function watchKey(item: Pick<Ma30PriorityWatchItem, "symbol" | "direction">) {
  return `${item.symbol}:${item.direction}`;
}

function closedOnly(bars: readonly Ma30PriorityBar[], nowMs: number) {
  return bars.filter((bar) => Number.isFinite(bar.closeTime) && bar.closeTime <= nowMs);
}

export async function executeMa30PriorityWatcherCycle(options: {
  now?: Date;
  watchlist: readonly Ma30PriorityWatchItem[];
  seenEventKeys: ReadonlySet<string>;
  reignitionState: Ma30PriorityReignitionStateMap;
  fetchClosedBars: Ma30PriorityWatcherFetcher;
}) {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const active = options.watchlist.filter((item) => item.expiresAt > nowMs);
  const seenEventKeys = new Set(options.seenEventKeys);
  const reignitionState: Ma30PriorityReignitionStateMap = { ...options.reignitionState };
  const crossEvents: Array<NonNullable<ReturnType<typeof detectMa30BodyCross>> & { symbol: string; sources: readonly string[]; stage: string | null }> = [];
  const reignitionEvents: Array<NonNullable<ReturnType<typeof evaluateMa30Reignition>["signal"]> & { symbol: string; sources: readonly string[]; stage: string | null }> = [];
  const failures: Array<{ symbol: string; interval: Ma30PrioritySignalInterval; error: string }> = [];
  let fetched = 0;

  for (const item of active) {
    let bars15m: Ma30PriorityBar[] = [];
    let bars1h: Ma30PriorityBar[] = [];
    let fifteenOk = false;
    let oneHourOk = false;

    try {
      bars15m = closedOnly(await options.fetchClosedBars(item.symbol, "15m", now), nowMs);
      fifteenOk = true;
    } catch (error) {
      failures.push({ symbol: item.symbol, interval: "15m", error: error instanceof Error ? error.message : String(error) });
    }

    try {
      bars1h = closedOnly(await options.fetchClosedBars(item.symbol, "1h", now), nowMs);
      oneHourOk = true;
    } catch (error) {
      failures.push({ symbol: item.symbol, interval: "1h", error: error instanceof Error ? error.message : String(error) });
    }

    if (fifteenOk && oneHourOk) fetched += 1;

    if (fifteenOk) {
      const cross15 = detectMa30BodyCross(bars15m, item.direction, "15m", item.symbol);
      if (cross15 && !seenEventKeys.has(cross15.eventKey)) {
        seenEventKeys.add(cross15.eventKey);
        crossEvents.push({ ...cross15, symbol: item.symbol, sources: item.sources, stage: item.stage });
      }
    }

    if (oneHourOk) {
      const cross1h = detectMa30BodyCross(bars1h, item.direction, "1h", item.symbol);
      if (cross1h && !seenEventKeys.has(cross1h.eventKey)) {
        seenEventKeys.add(cross1h.eventKey);
        crossEvents.push({ ...cross1h, symbol: item.symbol, sources: item.sources, stage: item.stage });
      }
    }

    if (fifteenOk && oneHourOk) {
      const stateKey = watchKey(item);
      const previous = reignitionState[stateKey] ?? {
        lastPullbackAt: null,
        lastIgnitedPullbackAt: null,
        lastIgnitedAt: null,
      };
      const evaluated = evaluateMa30Reignition({
        bars15m,
        bars1h,
        direction: item.direction,
        watchStartedAt: item.firstSeenAt,
        symbol: item.symbol,
      });
      const lastPullbackAt = Math.max(previous.lastPullbackAt ?? -Infinity, evaluated.pullbackAt ?? -Infinity);
      const nextState: Ma30PriorityReignitionState = {
        ...previous,
        lastPullbackAt: Number.isFinite(lastPullbackAt) ? lastPullbackAt : null,
      };

      if (evaluated.signal && evaluated.pullbackAt !== null) {
        const hasFreshPullback = evaluated.pullbackAt > (previous.lastIgnitedPullbackAt ?? -Infinity);
        const unseen = !seenEventKeys.has(evaluated.signal.eventKey);
        if (hasFreshPullback && unseen) {
          seenEventKeys.add(evaluated.signal.eventKey);
          reignitionEvents.push({ ...evaluated.signal, symbol: item.symbol, sources: item.sources, stage: item.stage });
          nextState.lastIgnitedPullbackAt = evaluated.pullbackAt;
          nextState.lastIgnitedAt = evaluated.signal.closeTime;
        } else if (!unseen && hasFreshPullback) {
          nextState.lastIgnitedPullbackAt = evaluated.pullbackAt;
          nextState.lastIgnitedAt = evaluated.signal.closeTime;
        }
      }
      reignitionState[stateKey] = nextState;
    }
  }

  return {
    runTimeUtc: now.toISOString(),
    coverage: {
      watched: active.length,
      fetched,
      failed: failures.length,
    },
    crossEvents,
    reignitionEvents,
    failures,
    seenEventKeys,
    reignitionState,
  } as const;
}