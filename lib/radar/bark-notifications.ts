import { notifyBark } from "../notifications/bark.ts";
import { diffNewCandidates, ma30OiCandidateKey, reversalCandidateKey } from "./alert-diff.ts";
import type { AtrBandLifecycle } from "./atr-band-lifecycle.ts";
import type { Ma30OiSnapshotCandidate } from "./ma30-oi-snapshot.ts";
import type { ReversalScanCandidate } from "./reversal-snapshot.ts";

export type RadarNotificationSummary = { attempted: number; sent: number; skipped: number; failed: number };
export type RadarBarkGroup = { key: string; title: string; body: string };
type LifecycleWithDuration = AtrBandLifecycle & { outsideBandBars?: number };

function emptySummary(): RadarNotificationSummary { return { attempted: 0, sent: 0, skipped: 0, failed: 0 }; }

function addResult(summary: RadarNotificationSummary, result: { status: string; error?: string }) {
  summary.attempted += 1;
  if (result.status === "SENT") summary.sent += 1;
  else if (result.error === "Bark is not configured") summary.skipped += 1;
  else summary.failed += 1;
}

function displaySymbol(symbol: string) { return symbol.replace(/USDT$/, ""); }
function displayInterval(interval: string) {
  if (interval === "1d") return "日线";
  if (interval === "1w") return "周线";
  return interval.toUpperCase();
}

function compareReversalStrength(left: ReversalScanCandidate, right: ReversalScanCandidate) {
  return right.closeBreakoutLookbackBars - left.closeBreakoutLookbackBars
    || right.score - left.score
    || left.symbol.localeCompare(right.symbol);
}

function displayReversalCandidate(candidate: ReversalScanCandidate) {
  const direction = candidate.direction === "LONG" ? "多" : "空";
  const extremum = candidate.direction === "LONG" ? "新高" : "新低";
  const arrow = candidate.direction === "LONG" ? "↑" : "↓";
  const breakoutBars = `${candidate.closeBreakoutLookbackBars}${candidate.closeBreakoutLookbackCapped ? "+" : ""}`;
  return `${displaySymbol(candidate.symbol)} · ${direction} · ${displayInterval(candidate.interval)} · 收盘突破近 ${breakoutBars} 根${extremum} · ${arrow.repeat(candidate.strengthArrows)}`;
}

export function buildHourlySuperReversalBarkGroups(candidates: ReversalScanCandidate[], scanBucket: string): RadarBarkGroup[] {
  const ordered = candidates
    .filter((candidate) => candidate.isSuperStrong && candidate.interval === "1h")
    .toSorted(compareReversalStrength);
  if (!ordered.length) return [];
  return [{
    key: `radar:reversal:hourly-super:${scanBucket}`,
    title: "超级强势破底翻／破顶翻",
    body: ordered.map(displayReversalCandidate).join("｜"),
  }];
}

export function buildFourHourlyReversalBarkGroups(candidates: ReversalScanCandidate[], scanBucket: string): RadarBarkGroup[] {
  const superStrong = candidates
    .filter((candidate) => candidate.isSuperStrong && (candidate.interval === "1h" || candidate.interval === "4h"))
    .toSorted(compareReversalStrength);
  const ordinaryFourHour = candidates
    .filter((candidate) => candidate.interval === "4h" && !candidate.isSuperStrong)
    .toSorted(compareReversalStrength);
  return [
    ...(superStrong.length ? [{
      key: `radar:reversal:four-hour-super:${scanBucket}`,
      title: "超级强势破底翻／破顶翻",
      body: superStrong.map(displayReversalCandidate).join("｜"),
    }] : []),
    ...(ordinaryFourHour.length ? [{
      key: `radar:reversal:four-hour-ordinary:${scanBucket}`,
      title: "普通破底翻／破顶翻",
      body: ordinaryFourHour.map(displayReversalCandidate).join("｜"),
    }] : []),
  ];
}

export function buildReversalBarkGroups(options: {
  current: ReversalScanCandidate[];
  previous: ReversalScanCandidate[];
  scanBucket: string;
}): RadarBarkGroup[] {
  const fresh = diffNewCandidates(options.current, options.previous, reversalCandidateKey).filter((candidate) => candidate.interval !== "15m");
  const groups = new Map<string, ReversalScanCandidate[]>();
  for (const candidate of fresh) {
    const groupKey = `${candidate.interval}:${candidate.direction}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), candidate]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([groupKey, candidates]) => {
    const [interval, direction] = groupKey.split(":") as [string, "LONG" | "SHORT"];
    const ordered = [...candidates].sort((left, right) => right.score - left.score || left.symbol.localeCompare(right.symbol));
    return {
      key: `radar:reversal:${options.scanBucket}:${interval}:${direction}`,
      title: `${displayInterval(interval)} ${direction === "LONG" ? "破底翻" : "破顶翻"} · 新增 ${ordered.length}`,
      body: ordered.map((candidate) => `${displaySymbol(candidate.symbol)} ${candidate.score.toFixed(2)}`).join("｜"),
    };
  });
}

export function buildMa30OiBarkGroups(options: {
  current: Ma30OiSnapshotCandidate[];
  previous: Ma30OiSnapshotCandidate[];
  scanBucket: string;
}): RadarBarkGroup[] {
  const fresh = diffNewCandidates(options.current, options.previous, ma30OiCandidateKey);
  return (["LONG", "SHORT"] as const).flatMap((direction) => {
    const ordered = fresh.filter((candidate) => candidate.direction === direction)
      .sort((left, right) => right.currentOi - left.currentOi || left.symbol.localeCompare(right.symbol));
    if (ordered.length === 0) return [];
    return [{
      key: `radar:ma30-oi:${options.scanBucket}:${direction}`,
      title: `MA30×OI ${direction === "LONG" ? "多头" : "空头"} · 新增 ${ordered.length}`,
      body: ordered.map((candidate) => {
        const streak = direction === "LONG" ? candidate.consecutiveAboveMa : candidate.consecutiveBelowMa;
        return `${displaySymbol(candidate.symbol)} ${streak ?? 0}根 +${candidate.oiExpansionPct.toFixed(2)}%`;
      }).join("｜"),
    }];
  });
}

export function buildAtrLifecycleTransitionBarkGroups(options: {
  previous: LifecycleWithDuration[];
  current: LifecycleWithDuration[];
  scanBucket: string;
}): RadarBarkGroup[] {
  const previousById = new Map(options.previous.map((item) => [`${item.symbol}:${item.direction}:${item.entryTime}`, item]));
  const groups = new Map<string, LifecycleWithDuration[]>();
  for (const lifecycle of options.current) {
    const previous = previousById.get(`${lifecycle.symbol}:${lifecycle.direction}:${lifecycle.entryTime}`);
    const event = !previous && lifecycle.status === "STRONG" ? "ENTRY"
      : previous?.status === "STRONG" && lifecycle.status === "WARNING" ? "WARNING"
        : previous?.status === "WARNING" && lifecycle.status === "HISTORY" ? "HISTORY" : null;
    if (!event) continue;
    const groupKey = `${lifecycle.direction}:${event}`;
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), lifecycle]);
  }
  const eventLabel = { ENTRY: "入池", WARNING: "警示", HISTORY: "历史" } as const;
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([groupKey, lifecycles]) => {
    const [direction, event] = groupKey.split(":") as ["LONG" | "SHORT", keyof typeof eventLabel];
    const ordered = [...lifecycles].sort((left, right) => right.maxFavorablePct - left.maxFavorablePct || left.symbol.localeCompare(right.symbol));
    return {
      key: `radar:atr-lifecycle:${options.scanBucket}:${direction}:${event}`,
      title: `ATR ${direction === "LONG" ? "多头" : "空头"}${eventLabel[event]} · ${ordered.length}`,
      body: ordered.map((item) => `${displaySymbol(item.symbol)} ${item.outsideBandBars ?? 0}根 最高+${item.maxFavorablePct.toFixed(2)}%`).join("｜"),
    };
  });
}

async function notifyGroups(db: D1Database, groups: RadarBarkGroup[], fetcher?: typeof fetch) {
  const summary = emptySummary();
  for (const group of groups) addResult(summary, await notifyBark({ db, ...group, fetcher }));
  return summary;
}

export async function notifyReversalBarkGroups(options: {
  db: D1Database;
  groups: RadarBarkGroup[];
  fetcher?: typeof fetch;
}) {
  return notifyGroups(options.db, options.groups, options.fetcher);
}

export async function notifyNewMa30OiCandidates(options: {
  db: D1Database;
  current: Ma30OiSnapshotCandidate[];
  previous: Ma30OiSnapshotCandidate[];
  scanBucket?: string;
  fetcher?: typeof fetch;
}) {
  return notifyGroups(options.db, buildMa30OiBarkGroups({
    current: options.current, previous: options.previous,
    scanBucket: options.scanBucket ?? options.current[0]?.scannedAt ?? new Date().toISOString(),
  }), options.fetcher);
}

export async function notifyNewReversalCandidates(options: {
  db: D1Database;
  current: ReversalScanCandidate[];
  previous: ReversalScanCandidate[];
  scanBucket?: string;
  fetcher?: typeof fetch;
}) {
  return notifyGroups(options.db, buildReversalBarkGroups({
    current: options.current, previous: options.previous,
    scanBucket: options.scanBucket ?? new Date().toISOString(),
  }), options.fetcher);
}

export async function notifyAtrLifecycleTransitions(options: {
  db: D1Database;
  previous: LifecycleWithDuration[];
  current: LifecycleWithDuration[];
  scanBucket: string;
  fetcher?: typeof fetch;
}) {
  return notifyGroups(options.db, buildAtrLifecycleTransitionBarkGroups(options), options.fetcher);
}
