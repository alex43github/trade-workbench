export const MA30_PRIORITY_TTL_MS = 8 * 60 * 60 * 1000;

export type Ma30PriorityDirection = "LONG" | "SHORT";
export type Ma30PrioritySource = "AI" | "C" | "SHORT" | "A" | "B";

export type Ma30PriorityCandidate = {
  symbol: string;
  direction: Ma30PriorityDirection;
  sources: Ma30PrioritySource[];
  ranks: { a: number | null; b: number | null; c: number | null; ai: number | null };
  stage: string | null;
  qualifiedAt: number;
};

export type Ma30PriorityWatchItem = Ma30PriorityCandidate & {
  firstSeenAt: number;
  lastQualifiedAt: number;
  expiresAt: number;
};

type ScanRow = { symbol: string; stage?: string | null; rank?: number | null; bRank?: number | null };
type AiRow = { symbol: string; direction: Ma30PriorityDirection; aiRank?: number | null; longStage?: string | null; shortStage?: string | null };
export type Ma30PriorityScanLike = {
  a: readonly ScanRow[];
  b: readonly ScanRow[];
  c: readonly ScanRow[];
  shorts: readonly ScanRow[];
  ai: readonly AiRow[];
};

const ELIGIBLE_AB_LONG_STAGES = new Set(["STEADY_UPTREND", "EARLY_ACCELERATION", "PERSISTENT_ACCELERATION"]);
const SOURCE_ORDER: readonly Ma30PrioritySource[] = ["AI", "C", "SHORT", "A", "B"];

function key(symbol: string, direction: Ma30PriorityDirection) {
  return `${symbol}:${direction}`;
}

function ensureCandidate(
  map: Map<string, Ma30PriorityCandidate>,
  symbol: string,
  direction: Ma30PriorityDirection,
  nowMs: number,
) {
  const normalized = symbol.trim();
  const candidateKey = key(normalized, direction);
  let row = map.get(candidateKey);
  if (!row) {
    row = {
      symbol: normalized,
      direction,
      sources: [],
      ranks: { a: null, b: null, c: null, ai: null },
      stage: null,
      qualifiedAt: nowMs,
    };
    map.set(candidateKey, row);
  }
  return row;
}

function addSource(row: Ma30PriorityCandidate, source: Ma30PrioritySource) {
  if (!row.sources.includes(source)) row.sources.push(source);
  row.sources.sort((left, right) => SOURCE_ORDER.indexOf(left) - SOURCE_ORDER.indexOf(right));
}

export function buildMa30PriorityCandidates(scan: Ma30PriorityScanLike, nowMs: number): Ma30PriorityCandidate[] {
  const map = new Map<string, Ma30PriorityCandidate>();

  for (const item of scan.ai) {
    const row = ensureCandidate(map, item.symbol, item.direction, nowMs);
    addSource(row, "AI");
    row.ranks.ai = item.aiRank ?? null;
    row.stage = item.direction === "LONG" ? (item.longStage ?? row.stage) : (item.shortStage ?? row.stage);
  }

  for (const item of scan.c) {
    const row = ensureCandidate(map, item.symbol, "LONG", nowMs);
    addSource(row, "C");
    row.ranks.c = item.rank ?? null;
    row.stage = item.stage ?? row.stage;
  }

  for (const item of scan.shorts) {
    const row = ensureCandidate(map, item.symbol, "SHORT", nowMs);
    addSource(row, "SHORT");
    row.stage = item.stage ?? row.stage;
  }

  for (const item of scan.a) {
    if (!ELIGIBLE_AB_LONG_STAGES.has(item.stage ?? "")) continue;
    const row = ensureCandidate(map, item.symbol, "LONG", nowMs);
    addSource(row, "A");
    row.ranks.a = item.rank ?? null;
    row.stage = item.stage ?? row.stage;
  }

  for (const item of scan.b) {
    if (!ELIGIBLE_AB_LONG_STAGES.has(item.stage ?? "")) continue;
    const row = ensureCandidate(map, item.symbol, "LONG", nowMs);
    addSource(row, "B");
    row.ranks.b = item.bRank ?? item.rank ?? null;
    row.stage = item.stage ?? row.stage;
  }

  const aiDirectionBySymbol = new Map(scan.ai.map((item) => [item.symbol.trim(), item.direction] as const));
  const explicitDirectionBySymbol = new Map<string, Ma30PriorityDirection>();
  for (const item of scan.c) explicitDirectionBySymbol.set(item.symbol.trim(), "LONG");
  for (const item of scan.shorts) explicitDirectionBySymbol.set(item.symbol.trim(), "SHORT");

  const selected = [...map.values()].filter((row) => {
    const aiDirection = aiDirectionBySymbol.get(row.symbol);
    if (aiDirection) return row.direction === aiDirection;
    const explicit = explicitDirectionBySymbol.get(row.symbol);
    if (explicit) return row.direction === explicit;
    return true;
  });

  const priority = (row: Ma30PriorityCandidate) => {
    if (row.sources.includes("AI")) return 0;
    if (row.sources.includes("C")) return 1;
    if (row.sources.includes("SHORT")) return 2;
    if (row.sources.includes("A")) return 3;
    return 4;
  };

  return selected.sort((left, right) =>
    priority(left) - priority(right)
    || (left.ranks.ai ?? Number.POSITIVE_INFINITY) - (right.ranks.ai ?? Number.POSITIVE_INFINITY)
    || (left.ranks.c ?? Number.POSITIVE_INFINITY) - (right.ranks.c ?? Number.POSITIVE_INFINITY)
    || (left.ranks.a ?? Number.POSITIVE_INFINITY) - (right.ranks.a ?? Number.POSITIVE_INFINITY)
    || (left.ranks.b ?? Number.POSITIVE_INFINITY) - (right.ranks.b ?? Number.POSITIVE_INFINITY)
    || left.symbol.localeCompare(right.symbol)
  );
}

export function refreshMa30PriorityWatchlist(
  previous: readonly Ma30PriorityWatchItem[],
  candidates: readonly Ma30PriorityCandidate[],
  nowMs: number,
): Ma30PriorityWatchItem[] {
  const currentDirectionBySymbol = new Map(candidates.map((candidate) => [candidate.symbol, candidate.direction] as const));
  const previousByKey = new Map(previous.map((item) => [key(item.symbol, item.direction), item] as const));
  const next = new Map<string, Ma30PriorityWatchItem>();

  for (const candidate of candidates) {
    const old = previousByKey.get(key(candidate.symbol, candidate.direction));
    next.set(key(candidate.symbol, candidate.direction), {
      ...candidate,
      firstSeenAt: old?.firstSeenAt ?? nowMs,
      lastQualifiedAt: nowMs,
      expiresAt: nowMs + MA30_PRIORITY_TTL_MS,
    });
  }

  for (const item of previous) {
    if (next.has(key(item.symbol, item.direction))) continue;
    const newDirection = currentDirectionBySymbol.get(item.symbol);
    if (newDirection && newDirection !== item.direction) continue;
    if (item.expiresAt <= nowMs) continue;
    next.set(key(item.symbol, item.direction), item);
  }

  return [...next.values()].sort((left, right) => left.firstSeenAt - right.firstSeenAt || left.symbol.localeCompare(right.symbol));
}