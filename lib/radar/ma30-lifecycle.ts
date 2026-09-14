import type { Ma30NotificationState } from "./ma30-notifications.ts";

export type Ma30LifecycleGroup = "A" | "B" | "C" | "SHORT" | "AI";
export type Ma30LifecycleEventType = "ENTER" | "REENTER" | "EXIT" | "STAGE_CHANGE" | "AI_CHANGE";

export type Ma30LifecycleItem = {
  symbol: string;
  active: boolean;
  isNew: boolean;
  isReEntry: boolean;
  reEntryCount: number;
  firstSeenAt: string;
  enteredAt: string;
  lastSeenAt: string;
  exitedAt: string | null;
  previousRank: number | null;
  currentRank: number | null;
  rankChanged: boolean;
  previousStage: string | null;
  currentStage: string | null;
  stageChanged: boolean;
  previousDirection: string | null;
  currentDirection: string | null;
  previousConfidence: string | null;
  currentConfidence: string | null;
  aiChanged: boolean;
};

export type Ma30LifecycleState = {
  version: "MA30_LIFECYCLE_V1";
  lastRunAt: string;
  groups: Record<Ma30LifecycleGroup, Record<string, Ma30LifecycleItem>>;
};

export type Ma30LifecycleEvent = {
  type: Ma30LifecycleEventType;
  group: Ma30LifecycleGroup;
  symbol: string;
  at: string;
  previousRank: number | null;
  currentRank: number | null;
  previousStage: string | null;
  currentStage: string | null;
};

type CurrentDescriptor = {
  symbol: string;
  rank: number | null;
  stage: string | null;
  direction: string | null;
  confidence: string | null;
};

const GROUPS: readonly Ma30LifecycleGroup[] = ["A", "B", "C", "SHORT", "AI"];

function descriptors(group: Ma30LifecycleGroup, current: Ma30NotificationState): CurrentDescriptor[] {
  if (group === "A") return current.a.map((row) => ({ symbol: row.symbol, rank: row.rank, stage: null, direction: null, confidence: null }));
  if (group === "B") return current.b.map((row) => ({ symbol: row.symbol, rank: row.rank, stage: null, direction: null, confidence: null }));
  if (group === "C") return current.c.map((row) => ({ symbol: row.symbol, rank: row.rank, stage: row.stage, direction: null, confidence: null }));
  if (group === "SHORT") return current.shorts.map((row, index) => ({ symbol: row.symbol, rank: index + 1, stage: row.stage, direction: "SHORT", confidence: null }));
  return current.ai.map((row) => ({
    symbol: row.symbol,
    rank: row.aiRank,
    stage: row.longStage ?? row.shortStage ?? null,
    direction: row.direction,
    confidence: row.confidence,
  }));
}

function emptyGroups(): Ma30LifecycleState["groups"] {
  return { A: {}, B: {}, C: {}, SHORT: {}, AI: {} };
}

function cloneGroups(previous?: Ma30LifecycleState): Ma30LifecycleState["groups"] {
  const groups = emptyGroups();
  if (!previous) return groups;
  for (const group of GROUPS) {
    for (const [symbol, item] of Object.entries(previous.groups[group] ?? {})) {
      groups[group][symbol] = { ...item };
    }
  }
  return groups;
}

function pushEvent(
  events: Ma30LifecycleEvent[],
  type: Ma30LifecycleEventType,
  group: Ma30LifecycleGroup,
  item: Ma30LifecycleItem,
  at: string,
) {
  events.push({
    type,
    group,
    symbol: item.symbol,
    at,
    previousRank: item.previousRank,
    currentRank: item.currentRank,
    previousStage: item.previousStage,
    currentStage: item.currentStage,
  });
}

/**
 * Evolve durable membership state for A/B/C/SHORT/AI without mutating prior snapshots.
 *
 * Product semantics:
 * - First entry is NEW.
 * - A symbol that drops out and later re-enters is NEW again and increments reEntryCount.
 * - Rank movement alone is audit metadata, not an entry event.
 * - C/SHORT phase changes remain visible even when membership is unchanged.
 * - AI rank/direction/confidence changes are separately surfaced as AI_CHANGE.
 */
export function evolveMa30Lifecycle(
  previous: Ma30LifecycleState | undefined,
  current: Ma30NotificationState,
  runAt: string,
): { state: Ma30LifecycleState; events: Ma30LifecycleEvent[] } {
  if (!runAt.trim()) throw new Error("runAt is required");

  const groups = cloneGroups(previous);
  const events: Ma30LifecycleEvent[] = [];

  for (const group of GROUPS) {
    const currentRows = descriptors(group, current);
    const currentBySymbol = new Map(currentRows.map((row) => [row.symbol, row]));
    const knownSymbols = new Set([...Object.keys(groups[group]), ...currentBySymbol.keys()]);

    for (const symbol of knownSymbols) {
      const prior = groups[group][symbol];
      const next = currentBySymbol.get(symbol);

      if (next) {
        const firstEntry = !prior;
        const reEntry = Boolean(prior && !prior.active);
        const stayedActive = Boolean(prior?.active);
        const previousRank = prior?.currentRank ?? null;
        const previousStage = prior?.currentStage ?? null;
        const previousDirection = prior?.currentDirection ?? null;
        const previousConfidence = prior?.currentConfidence ?? null;
        const rankChanged = stayedActive && previousRank !== next.rank;
        const stageChanged = stayedActive && previousStage !== next.stage;
        const aiChanged = group === "AI" && stayedActive && (
          previousRank !== next.rank ||
          previousDirection !== next.direction ||
          previousConfidence !== next.confidence
        );

        const item: Ma30LifecycleItem = {
          symbol,
          active: true,
          isNew: firstEntry || reEntry,
          isReEntry: reEntry,
          reEntryCount: (prior?.reEntryCount ?? 0) + (reEntry ? 1 : 0),
          firstSeenAt: prior?.firstSeenAt ?? runAt,
          enteredAt: firstEntry || reEntry ? runAt : prior.enteredAt,
          lastSeenAt: runAt,
          exitedAt: null,
          previousRank,
          currentRank: next.rank,
          rankChanged,
          previousStage,
          currentStage: next.stage,
          stageChanged,
          previousDirection,
          currentDirection: next.direction,
          previousConfidence,
          currentConfidence: next.confidence,
          aiChanged,
        };
        groups[group][symbol] = item;

        if (firstEntry) pushEvent(events, "ENTER", group, item, runAt);
        else if (reEntry) pushEvent(events, "REENTER", group, item, runAt);
        else {
          if ((group === "C" || group === "SHORT") && stageChanged) pushEvent(events, "STAGE_CHANGE", group, item, runAt);
          if (group === "AI" && aiChanged) pushEvent(events, "AI_CHANGE", group, item, runAt);
        }
        continue;
      }

      if (!prior) continue;
      if (!prior.active) {
        groups[group][symbol] = { ...prior, isNew: false, isReEntry: false, rankChanged: false, stageChanged: false, aiChanged: false };
        continue;
      }

      const item: Ma30LifecycleItem = {
        ...prior,
        active: false,
        isNew: false,
        isReEntry: false,
        lastSeenAt: prior.lastSeenAt,
        exitedAt: runAt,
        previousRank: prior.currentRank,
        currentRank: null,
        rankChanged: false,
        previousStage: prior.currentStage,
        currentStage: null,
        stageChanged: false,
        previousDirection: prior.currentDirection,
        currentDirection: null,
        previousConfidence: prior.currentConfidence,
        currentConfidence: null,
        aiChanged: false,
      };
      groups[group][symbol] = item;
      pushEvent(events, "EXIT", group, item, runAt);
    }
  }

  return {
    state: {
      version: "MA30_LIFECYCLE_V1",
      lastRunAt: runAt,
      groups,
    },
    events,
  };
}
