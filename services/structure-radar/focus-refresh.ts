import { createFocusPoolRecord, isFocusPoolActive, mergeFocusPoolRecord, type FocusBias, type FocusClassification, type FocusPoolRecord, type FocusPoolSource } from "../../lib/structure-radar/focus-pool.ts";

type TrendLike = { symbol: string; stage: string; score?: number; signalState?: string | null };
type SqueezeLike = { symbol: string; stage: string; direction?: string | null };
type PositionLike = { symbol: string; quantity: number };
type Repository = { listFocus(): Promise<FocusPoolRecord[]>; saveFocus(record: FocusPoolRecord): Promise<void>; deleteFocus(symbol: string): Promise<void> };

const SQUEEZE_STAGES = new Set(["EARLY_FUEL_BUILDING", "SQUEEZE_BUILDING", "ACTIONABLE", "SQUEEZE_ACTIVE", "EXTENDED_NO_CHASE", "RESET_WATCH", "RECLAIM_PENDING", "SECOND_TEST", "REIGNITION_READY"]);

type SymbolAggregate = {
  sources: FocusPoolSource[];
  classifications: FocusClassification[];
  directions: Set<"LONG" | "SHORT">;
  trendStage?: string | null;
  squeezeStage?: string | null;
  meaningfulDetection: boolean;
};

function normalized(symbol: string) {
  return symbol.trim().toUpperCase();
}

function aggregate(map: Map<string, SymbolAggregate>, symbol: string) {
  const key = normalized(symbol);
  if (!map.has(key)) map.set(key, { sources: [], classifications: [], directions: new Set(), meaningfulDetection: false });
  return map.get(key)!;
}

function addUnique<T>(values: T[], value: T) {
  if (!values.includes(value)) values.push(value);
}

function biasOf(directions: Set<"LONG" | "SHORT">): FocusBias {
  if (directions.size > 1) return "NEUTRAL";
  if (directions.has("LONG")) return "LONG";
  if (directions.has("SHORT")) return "SHORT";
  return "UNKNOWN";
}

export async function refreshFocusPool(input: {
  repository: Repository;
  trends: readonly TrendLike[];
  squeezes: readonly SqueezeLike[];
  positions: readonly PositionLike[];
  watchlistSymbols: readonly string[];
  now: string;
}) {
  const aggregates = new Map<string, SymbolAggregate>();
  for (const trend of input.trends) {
    if (trend.stage !== "ACTIONABLE" || !Number.isFinite(trend.score) || Number(trend.score) < 80) continue;
    const item = aggregate(aggregates, trend.symbol);
    addUnique(item.sources, "HOURLY_TREND");
    addUnique(item.classifications, "STRONG_TREND");
    item.directions.add("LONG");
    item.trendStage = trend.stage;
    item.meaningfulDetection = true;
  }
  for (const squeeze of input.squeezes) {
    if (!SQUEEZE_STAGES.has(squeeze.stage)) continue;
    const direction = squeeze.direction === "SHORT_SQUEEZE_LONG_BIAS" ? "LONG" : squeeze.direction === "LONG_SQUEEZE_SHORT_BIAS" ? "SHORT" : null;
    if (!direction) continue;
    const item = aggregate(aggregates, squeeze.symbol);
    addUnique(item.sources, "HOURLY_SQUEEZE");
    addUnique(item.classifications, direction === "LONG" ? "SHORT_SQUEEZE" : "LONG_SQUEEZE");
    item.directions.add(direction);
    item.squeezeStage = squeeze.stage;
    item.meaningfulDetection = true;
  }
  for (const position of input.positions) {
    if (!Number.isFinite(position.quantity) || position.quantity <= 0) continue;
    addUnique(aggregate(aggregates, position.symbol).sources, "POSITION");
  }
  for (const symbol of input.watchlistSymbols) addUnique(aggregate(aggregates, symbol).sources, "WATCHLIST");

  const existing = await input.repository.listFocus();
  const symbols = new Set([...existing.map((item) => item.symbol), ...aggregates.keys()]);
  for (const symbol of symbols) {
    const previous = existing.find((item) => item.symbol === symbol) ?? createFocusPoolRecord(symbol, input.now);
    const item = aggregates.get(symbol);
    const next = mergeFocusPoolRecord(previous, {
      sources: item?.sources ?? [],
      classifications: item?.classifications ?? [],
      bias: biasOf(item?.directions ?? new Set()),
      meaningfulDetection: item?.meaningfulDetection ?? false,
      trendStage: item?.trendStage === undefined ? previous.trendStage : item.trendStage,
      squeezeStage: item?.squeezeStage === undefined ? previous.squeezeStage : item.squeezeStage,
    }, input.now);
    if (isFocusPoolActive(next, input.now)) await input.repository.saveFocus(next);
    else await input.repository.deleteFocus(symbol);
  }
  return (await input.repository.listFocus())
    .filter((item) => isFocusPoolActive(item, input.now))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}
