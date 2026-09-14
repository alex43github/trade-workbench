import { buildMa30PriorityCandidates, refreshMa30PriorityWatchlist, type Ma30PriorityScanLike, type Ma30PriorityWatchItem } from "./ma30-priority-watchlist.ts";

export type Ma30PriorityHourlySource = {
  runId: string;
  runTimeMs: number;
  notificationState: Ma30PriorityScanLike;
};

export function reconcilePriorityWatchlistFromHourlySource(options: {
  storedSourceRunId: string | null;
  storedWatchlist: readonly Ma30PriorityWatchItem[];
  source: Ma30PriorityHourlySource;
  nowMs: number;
}) {
  const sourceChanged = options.source.runId !== options.storedSourceRunId;
  if (!sourceChanged) {
    return {
      sourceChanged: false as const,
      sourceRunId: options.source.runId,
      watchlist: options.storedWatchlist.filter((item) => item.expiresAt > options.nowMs),
    };
  }

  const candidates = buildMa30PriorityCandidates(options.source.notificationState, options.source.runTimeMs);
  const refreshed = refreshMa30PriorityWatchlist(options.storedWatchlist, candidates, options.source.runTimeMs)
    .filter((item) => item.expiresAt > options.nowMs);
  return {
    sourceChanged: true as const,
    sourceRunId: options.source.runId,
    watchlist: refreshed,
  };
}