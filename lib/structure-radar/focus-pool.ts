export const FOCUS_STICKY_MS = 72 * 60 * 60 * 1_000;

export type FocusPoolSource = "HOURLY_TREND" | "HOURLY_SQUEEZE" | "STICKY_72H" | "POSITION" | "WATCHLIST";
export type FocusBias = "LONG" | "SHORT" | "NEUTRAL" | "UNKNOWN";
export type FocusClassification = "STRONG_TREND" | "SHORT_SQUEEZE" | "LONG_SQUEEZE";
export type FocusDecision = "WATCH" | "WAIT_RESET" | "BUY_READY" | "ADD_READY" | "NO_CHASE" | "RISK_OFF" | "INVALIDATED";
export type FocusMa30Relation = "ABOVE" | "BELOW" | "AT" | "UNKNOWN";

export type FocusPoolRecord = {
  symbol: string;
  sources: FocusPoolSource[];
  classifications: FocusClassification[];
  bias: FocusBias;
  trendStage: string | null;
  squeezeStage: string | null;
  stickyUntil: string | null;
  firstDetectedAt: string | null;
  lastQualifiedAt: string | null;
  lastEventAt: string | null;
  ma30: {
    "5m": FocusMa30Relation;
    "15m": FocusMa30Relation;
    "1h": FocusMa30Relation;
  };
  lastDecision: FocusDecision;
  lastDecisionReasonCodes: string[];
  lastBarkEventKeys: string[];
  ma30EventWatermarks: Partial<Record<"15m" | "1h", string>>;
  updatedAt: string;
};

export type FocusPoolMergeInput = {
  sources: FocusPoolSource[];
  classifications: FocusClassification[];
  bias: FocusBias;
  meaningfulDetection?: boolean;
  trendStage?: string | null;
  squeezeStage?: string | null;
};

const SOURCE_ORDER: FocusPoolSource[] = ["HOURLY_TREND", "HOURLY_SQUEEZE", "STICKY_72H", "POSITION", "WATCHLIST"];
const CLASSIFICATION_ORDER: FocusClassification[] = ["STRONG_TREND", "SHORT_SQUEEZE", "LONG_SQUEEZE"];

function uniqueOrdered<T extends string>(values: readonly T[], order: readonly T[]): T[] {
  const present = new Set(values);
  return order.filter((value) => present.has(value));
}

function timestamp(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid ISO timestamp: ${value}`);
  return parsed;
}

function stickyActive(record: FocusPoolRecord, now: string) {
  return record.stickyUntil !== null && timestamp(record.stickyUntil) > timestamp(now);
}

export function createFocusPoolRecord(symbol: string, now: string): FocusPoolRecord {
  timestamp(now);
  const normalized = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,24}$/.test(normalized)) throw new Error("invalid focus symbol");
  return {
    symbol: normalized,
    sources: [],
    classifications: [],
    bias: "UNKNOWN",
    trendStage: null,
    squeezeStage: null,
    stickyUntil: null,
    firstDetectedAt: null,
    lastQualifiedAt: null,
    lastEventAt: null,
    ma30: { "5m": "UNKNOWN", "15m": "UNKNOWN", "1h": "UNKNOWN" },
    lastDecision: "WATCH",
    lastDecisionReasonCodes: [],
    lastBarkEventKeys: [],
    ma30EventWatermarks: {},
    updatedAt: now,
  };
}

export function mergeFocusPoolRecord(previous: FocusPoolRecord, input: FocusPoolMergeInput, now: string): FocusPoolRecord {
  const nowMs = timestamp(now);
  const meaningful = Boolean(input.meaningfulDetection) && input.sources.some((source) => source === "HOURLY_TREND" || source === "HOURLY_SQUEEZE");
  const nextStickyUntil = meaningful
    ? new Date(nowMs + FOCUS_STICKY_MS).toISOString()
    : previous.stickyUntil;
  const hasSticky = nextStickyUntil !== null && timestamp(nextStickyUntil) > nowMs;
  const explicitSources = input.sources.filter((source) => source !== "STICKY_72H");
  const sources = uniqueOrdered([...explicitSources, ...(hasSticky ? ["STICKY_72H" as const] : [])], SOURCE_ORDER);

  const retainsDiscoveryContext = hasSticky;
  const classifications = uniqueOrdered(
    retainsDiscoveryContext
      ? [...previous.classifications, ...input.classifications]
      : input.classifications,
    CLASSIFICATION_ORDER,
  );
  const incomingDirectional = input.bias !== "UNKNOWN" && input.bias !== "NEUTRAL";
  const bias = incomingDirectional ? input.bias : retainsDiscoveryContext ? previous.bias : input.bias;
  const firstDetectedAt = meaningful ? previous.firstDetectedAt ?? now : previous.firstDetectedAt;
  const lastQualifiedAt = meaningful ? now : previous.lastQualifiedAt;

  return {
    ...previous,
    sources,
    classifications,
    bias,
    trendStage: input.trendStage === undefined ? previous.trendStage : input.trendStage,
    squeezeStage: input.squeezeStage === undefined ? previous.squeezeStage : input.squeezeStage,
    stickyUntil: hasSticky ? nextStickyUntil : null,
    firstDetectedAt,
    lastQualifiedAt,
    updatedAt: now,
  };
}

export function isFocusPoolActive(record: FocusPoolRecord, now: string) {
  timestamp(now);
  const nonSticky = record.sources.some((source) => source !== "STICKY_72H");
  return nonSticky || stickyActive(record, now);
}
