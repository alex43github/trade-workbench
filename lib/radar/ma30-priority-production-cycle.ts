import { buildMa30PriorityBarkGroups, type Ma30PriorityBarkGroup } from "./ma30-priority-bark.ts";
import type { Ma30PriorityCyclePersistenceInput, Ma30PriorityHourlySourceRecord, Ma30PriorityPersistedEvent, Ma30PriorityStoredState } from "./ma30-priority-persistence.ts";
import { reconcilePriorityWatchlistFromHourlySource } from "./ma30-priority-runtime-state.ts";
import { executeMa30PriorityWatcherCycle, type Ma30PriorityWatcherFetcher } from "./ma30-priority-watcher-cycle.ts";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const EVENT_DEDUPE_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export type Ma30PriorityNotificationMode = "DRY_RUN" | "LIVE";

export type Ma30PriorityProductionDeps = {
  hasRun: (runId: string) => Promise<boolean>;
  loadSource: () => Promise<Ma30PriorityHourlySourceRecord | null>;
  loadState: () => Promise<Ma30PriorityStoredState>;
  loadRecentEventKeys: (sinceCloseTime: number) => Promise<Set<string>>;
  fetchClosedBars: Ma30PriorityWatcherFetcher;
  persist: (input: Ma30PriorityCyclePersistenceInput) => Promise<void>;
  notify: (group: Ma30PriorityBarkGroup) => Promise<unknown>;
};

export function ma30PriorityRunIdFor(now: Date): string {
  const boundary = Math.floor(now.getTime() / FIFTEEN_MINUTES_MS) * FIFTEEN_MINUTES_MS;
  const iso = new Date(boundary).toISOString();
  return `ma30-priority:${iso.slice(0, 16)}Z`;
}

function barkBucketFor(now: Date) {
  const boundary = Math.floor(now.getTime() / FIFTEEN_MINUTES_MS) * FIFTEEN_MINUTES_MS;
  return new Date(boundary).toISOString().slice(0, 16);
}

function toPersistedEvents(
  crossEvents: readonly Array<{ eventKey: string; symbol: string; direction: "LONG" | "SHORT"; interval: "15m" | "1h"; closeTime: number }>,
  reignitionEvents: readonly Array<{ eventKey: string; symbol: string; direction: "LONG" | "SHORT"; interval: "15m"; closeTime: number }>,
): Ma30PriorityPersistedEvent[] {
  return [
    ...crossEvents.map((event) => ({
      eventKey: event.eventKey,
      eventType: "MA30_CROSS" as const,
      symbol: event.symbol,
      direction: event.direction,
      interval: event.interval,
      signalCloseTime: event.closeTime,
      payload: event,
    })),
    ...reignitionEvents.map((event) => ({
      eventKey: event.eventKey,
      eventType: "REIGNITION" as const,
      symbol: event.symbol,
      direction: event.direction,
      interval: event.interval,
      signalCloseTime: event.closeTime,
      payload: event,
    })),
  ];
}

export async function executeMa30PriorityProductionCycle(options: {
  now?: Date;
  notifications?: Ma30PriorityNotificationMode;
  deps: Ma30PriorityProductionDeps;
}) {
  const now = options.now ?? new Date();
  const notifications = options.notifications ?? "DRY_RUN";
  const runId = ma30PriorityRunIdFor(now);

  if (await options.deps.hasRun(runId)) {
    return {
      status: "SKIPPED_DUPLICATE" as const,
      runId,
      notifications,
      notificationGroups: [] as Ma30PriorityBarkGroup[],
    };
  }

  const source = await options.deps.loadSource();
  if (!source) {
    return {
      status: "NO_FULL_SOURCE" as const,
      runId,
      notifications,
      notificationGroups: [] as Ma30PriorityBarkGroup[],
    };
  }

  const stored = await options.deps.loadState();
  const reconciled = reconcilePriorityWatchlistFromHourlySource({
    storedSourceRunId: stored.sourceRunId,
    storedWatchlist: stored.watchlist,
    source,
    nowMs: now.getTime(),
  });
  const seenEventKeys = await options.deps.loadRecentEventKeys(now.getTime() - EVENT_DEDUPE_LOOKBACK_MS);
  const cycle = await executeMa30PriorityWatcherCycle({
    now,
    watchlist: reconciled.watchlist,
    seenEventKeys,
    reignitionState: stored.reignitionState,
    fetchClosedBars: options.deps.fetchClosedBars,
  });

  const events = toPersistedEvents(cycle.crossEvents, cycle.reignitionEvents);
  await options.deps.persist({
    runId,
    runTimeUtc: now.toISOString(),
    sourceRunId: source.runId,
    coverage: {
      ...cycle.coverage,
      sourceChanged: reconciled.sourceChanged,
      priorityPool: reconciled.watchlist.length,
      crossEvents: cycle.crossEvents.length,
      reignitionEvents: cycle.reignitionEvents.length,
    },
    watchlist: reconciled.watchlist,
    reignitionState: cycle.reignitionState,
    events,
  });

  const notificationGroups = buildMa30PriorityBarkGroups({
    scanBucket: barkBucketFor(now),
    crossEvents: cycle.crossEvents,
    reignitionEvents: cycle.reignitionEvents,
  });

  if (notifications === "LIVE") {
    for (const group of notificationGroups) await options.deps.notify(group);
  }

  return {
    status: "COMPLETED" as const,
    runId,
    notifications,
    sourceRunId: source.runId,
    sourceChanged: reconciled.sourceChanged,
    watchlist: reconciled.watchlist,
    coverage: cycle.coverage,
    crossEvents: cycle.crossEvents,
    reignitionEvents: cycle.reignitionEvents,
    failures: cycle.failures,
    notificationGroups,
  };
}