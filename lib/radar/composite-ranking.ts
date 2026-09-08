import { notifyBark } from "./../notifications/bark.ts";
import type { Ma30OiSnapshot } from "./ma30-oi-snapshot.ts";
import type { MultiTimeframeSnapshot } from "./multitimeframe.ts";
import type { ReversalDashboard } from "./reversal-snapshot.ts";

export type CompositeDirection = "LONG" | "SHORT";
export type CompositePriority = "WATCH" | "HIGH" | "CRITICAL";

export type RadarObservation = {
  symbol: string;
  participation?: string;
  top10Pct?: number | null;
  chipStage?: string | null;
  coverage?: { chips?: string; [key: string]: unknown };
};

export type CompositeCandidate = {
  symbol: string;
  direction: CompositeDirection;
  conditions: string[];
  conditionCount: number;
  qualityScore: number;
  totalWeight: number;
  priority: CompositePriority;
  sourceTimes: string[];
};

export type CompositeSnapshot = {
  status: "ready" | "degraded" | "pending";
  generatedAt: string;
  scannedAt: string;
  candidates: CompositeCandidate[];
  warnings: string[];
  realOrderRouteEnabled: false;
};

export type CompositeRadarInput = {
  mode?: string;
  status?: string;
  updatedAt?: string;
  observations?: RadarObservation[];
  coins?: RadarObservation[];
};

export type CompositeInput = {
  scannedAt: string;
  ma30Oi?: Pick<Ma30OiSnapshot, "status" | "scannedAt" | "candidates"> | null;
  reversal?: Pick<ReversalDashboard, "scans"> | null;
  multiTimeframe?: Pick<MultiTimeframeSnapshot, "status" | "scannedAt" | "vegas" | "vegasBearish" | "bySymbol"> | null;
  radar?: CompositeRadarInput | null;
};

type Evidence = {
  labels: Set<string>;
  kinds: Set<string>;
  quality: number;
  sourceTimes: Set<string>;
};

const priorityRank: Record<CompositePriority, number> = { WATCH: 1, HIGH: 2, CRITICAL: 3 };
const dayMs = 24 * 60 * 60 * 1_000;

function normalizedSymbol(value: unknown) {
  if (typeof value !== "string") return null;
  const symbol = value.trim().toUpperCase();
  return /^[A-Z0-9]{3,30}USDT$/.test(symbol) ? symbol : null;
}

function sourceIsCurrent(status: unknown, sourceTime: unknown, runTime: number) {
  if (status !== "ready") return false;
  const parsed = Date.parse(typeof sourceTime === "string" ? sourceTime : "");
  return Number.isFinite(parsed) && parsed <= runTime && runTime - parsed <= dayMs;
}

function addEvidence(records: Map<string, Evidence>, symbol: string, direction: CompositeDirection, kind: string, label: string, quality: number, sourceTime: string) {
  const key = `${symbol}:${direction}`;
  const record = records.get(key) ?? { labels: new Set<string>(), kinds: new Set<string>(), quality: 0, sourceTimes: new Set<string>() };
  if (!record.kinds.has(kind)) {
    record.kinds.add(kind);
    record.quality += Math.max(0, Math.min(25, quality));
  }
  record.labels.add(label);
  if (sourceTime) record.sourceTimes.add(sourceTime);
  records.set(key, record);
}

function attachNeutralEvidence(records: Map<string, Evidence>, symbol: string, direction: CompositeDirection, label: string, sourceTime: string) {
  const key = `${symbol}:${direction}`;
  const record = records.get(key);
  if (!record) return;
  if (!record.kinds.has("chips")) {
    record.kinds.add("chips");
    record.quality += 10;
  }
  record.labels.add(label);
  if (sourceTime) record.sourceTimes.add(sourceTime);
}

function priorityFor(count: number): CompositePriority {
  return count >= 4 ? "CRITICAL" : count === 3 ? "HIGH" : "WATCH";
}

function sourceWarning(warnings: string[], name: string, source: { status?: string } | null | undefined) {
  if (!source) warnings.push(`${name}快照不可用，已跳过该来源`);
  else if (source.status !== "ready") warnings.push(`${name}快照状态为 ${source.status ?? "unknown"}，已跳过该来源`);
}

export function buildCompositeSnapshot(input: CompositeInput): CompositeSnapshot {
  const generatedAt = new Date().toISOString();
  const scannedAt = typeof input.scannedAt === "string" && Number.isFinite(Date.parse(input.scannedAt)) ? input.scannedAt : generatedAt;
  const runTime = Date.parse(scannedAt);
  const records = new Map<string, Evidence>();
  const warnings: string[] = [];
  let usableSources = 0;

  sourceWarning(warnings, "MA30×OI", input.ma30Oi);
  if (input.ma30Oi && sourceIsCurrent(input.ma30Oi.status, input.ma30Oi.scannedAt, runTime)) {
    usableSources += 1;
    for (const candidate of input.ma30Oi.candidates ?? []) {
      const symbol = normalizedSymbol(candidate.symbol);
      if (!symbol) continue;
      const direction = candidate.direction === "SHORT" ? "SHORT" : "LONG";
      addEvidence(records, symbol, direction, "ma30Oi", "MA30×OI 增仓", 20, input.ma30Oi.scannedAt);
    }
  } else if (input.ma30Oi?.status === "ready") {
    warnings.push("MA30×OI快照已过期，已跳过该来源");
  }

  sourceWarning(warnings, "破底翻", input.reversal ? { status: Object.values(input.reversal.scans).some((scan) => scan?.status === "ready") ? "ready" : "degraded" } : null);
  for (const scan of Object.values(input.reversal?.scans ?? {})) {
    // The daily composite is deliberately anchored to the daily structural signal;
    // intraday candidates remain visible in the dedicated research panel only.
    if (scan?.interval !== "1d") continue;
    if (!scan || !sourceIsCurrent(scan.status, scan.scannedAt, runTime)) {
      if (scan?.status === "ready") warnings.push(`破底翻 ${scan.interval} 快照已过期，已跳过该来源`);
      continue;
    }
    usableSources += 1;
    for (const candidate of scan.candidates ?? []) {
      const symbol = normalizedSymbol(candidate.symbol);
      const direction = candidate.direction === "LONG" || candidate.direction === "SHORT" ? candidate.direction : null;
      if (!symbol || !direction) continue;
      const label = direction === "LONG" ? "破底翻" : "破顶翻";
      const quality = Number.isFinite(candidate.score) ? Math.min(20, candidate.score / 5) : 10;
      addEvidence(records, symbol, direction, "reversal", `${label}（${scan.interval}）`, quality, scan.scannedAt);
    }
  }

  sourceWarning(warnings, "Vegas", input.multiTimeframe);
  if (input.multiTimeframe && sourceIsCurrent(input.multiTimeframe.status, input.multiTimeframe.scannedAt, runTime)) {
    usableSources += 1;
    for (const interval of ["1h", "4h", "1d"] as const) {
      for (const symbolValue of input.multiTimeframe.vegas?.[interval] ?? []) {
        const symbol = normalizedSymbol(symbolValue);
        if (symbol) addEvidence(records, symbol, "LONG", "vegas", `Vegas 强势（${interval}）`, 22, input.multiTimeframe.scannedAt);
      }
      for (const symbolValue of input.multiTimeframe.vegasBearish?.[interval] ?? []) {
        const symbol = normalizedSymbol(symbolValue);
        if (symbol) addEvidence(records, symbol, "SHORT", "vegas", `Vegas 弱势（${interval}）`, 22, input.multiTimeframe.scannedAt);
      }
    }
  } else if (input.multiTimeframe?.status === "ready") {
    warnings.push("Vegas快照已过期，已跳过该来源");
  }

  const radar = input.radar;
  const radarIsLive = radar?.mode === "live" || radar?.status === "live";
  const radarTime = radar?.updatedAt ?? scannedAt;
  const radarIsCurrent = radarIsLive && sourceIsCurrent("ready", radarTime, runTime);
  if (radarIsCurrent) usableSources += 1;
  if (!radarIsLive) {
    warnings.push("实时雷达不是 live，本轮跳过逼空与筹码条件");
  } else if (!radarIsCurrent) {
    warnings.push("实时雷达数据已过期，已跳过逼空与筹码条件");
  } else {
    const observations = radar.observations ?? radar.coins ?? [];
    for (const observation of observations) {
      const symbol = normalizedSymbol(observation.symbol);
      if (!symbol) continue;
      if (observation.participation === "SQUEEZE") addEvidence(records, symbol, "LONG", "squeeze", "逼空重点", 20, radarTime);
      const top10 = observation.top10Pct;
      const stage = observation.chipStage ?? "";
      const chipsLive = observation.coverage?.chips === undefined || observation.coverage.chips === "live";
      if (chipsLive && typeof top10 === "number" && Number.isFinite(top10) && top10 >= 45 && top10 <= 85 && !/派发|分发|distribution|distribut/i.test(stage)) {
        for (const direction of ["LONG", "SHORT"] as const) attachNeutralEvidence(records, symbol, direction, "筹码集中（中性佐证）", radarTime);
      }
    }
  }

  const candidates = [...records.entries()]
    .map(([key, evidence]) => {
      const [symbol, direction] = key.split(":") as [string, CompositeDirection];
      const conditionCount = evidence.kinds.size;
      const priority = priorityFor(conditionCount);
      return {
        symbol, direction, conditions: [...evidence.labels], conditionCount,
        qualityScore: Math.round(Math.min(100, evidence.quality)),
        totalWeight: Math.round(conditionCount * 25 + Math.min(100, evidence.quality)),
        priority, sourceTimes: [...evidence.sourceTimes].sort(),
      } satisfies CompositeCandidate;
    })
    .filter((candidate) => candidate.conditionCount >= 2)
    .sort((left, right) => right.conditionCount - left.conditionCount
      || priorityRank[right.priority] - priorityRank[left.priority]
      || right.qualityScore - left.qualityScore
      || left.symbol.localeCompare(right.symbol)
      || left.direction.localeCompare(right.direction));

  return { status: usableSources > 0 ? "ready" : "degraded", generatedAt, scannedAt, candidates, warnings, realOrderRouteEnabled: false };
}

type CompositeDb = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => { run: () => Promise<unknown>; first: <T>() => Promise<T | null> };
  };
};

export async function saveCompositeSnapshot(db: CompositeDb, snapshot: CompositeSnapshot) {
  await db.prepare(
    `INSERT OR REPLACE INTO radar_composite_snapshots (id, generated_at, status, payload_json)
     VALUES (?, ?, ?, ?)`,
  ).bind(snapshot.generatedAt, snapshot.generatedAt, snapshot.status, JSON.stringify(snapshot)).run();
}

export async function loadLatestCompositeSnapshot(db: CompositeDb): Promise<CompositeSnapshot | null> {
  const row = await db.prepare("SELECT payload_json FROM radar_composite_snapshots ORDER BY generated_at DESC LIMIT 1").bind().first<{ payload_json: string }>();
  if (!row?.payload_json) return null;
  try {
    const snapshot = JSON.parse(row.payload_json) as CompositeSnapshot;
    if (!snapshot || !["ready", "degraded", "pending"].includes(snapshot.status) || !Array.isArray(snapshot.candidates)) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export type CompositeNotificationSummary = { attempted: number; sent: number; skipped: number; failed: number };

function emptySummary(): CompositeNotificationSummary { return { attempted: 0, sent: 0, skipped: 0, failed: 0 }; }
function addResult(summary: CompositeNotificationSummary, result: { status: string; error?: string }) {
  summary.attempted += 1;
  if (result.status === "SENT") summary.sent += 1;
  else if (result.error === "Bark is not configured") summary.skipped += 1;
  else summary.failed += 1;
}

function compositeKey(candidate: CompositeCandidate) {
  return `${candidate.symbol}:${candidate.direction}:${candidate.priority}`;
}

export function shouldNotifyCompositeCandidate(candidate: CompositeCandidate, previous: CompositeCandidate[]) {
  const old = previous.find((item) => item.symbol === candidate.symbol && item.direction === candidate.direction);
  return !old || priorityRank[candidate.priority] > priorityRank[old.priority];
}

export async function notifyCompositeRankingChanges(options: {
  db: D1Database;
  current: CompositeCandidate[] | CompositeSnapshot;
  previous?: CompositeCandidate[] | CompositeSnapshot | null;
  fetcher?: typeof fetch;
}) {
  const summary = emptySummary();
  const current = Array.isArray(options.current) ? options.current : options.current.candidates;
  const previous = Array.isArray(options.previous) ? options.previous : options.previous?.candidates ?? [];
  for (const candidate of current) {
    const newKey = compositeKey(candidate);
    if (!shouldNotifyCompositeCandidate(candidate, previous)) continue;
    const result = await notifyBark({
      db: options.db,
      key: `radar:composite:${newKey}`,
      title: `综合榜 ${candidate.priority} · ${candidate.symbol.replace(/USDT$/, "")}`,
      body: `${candidate.direction === "LONG" ? "多头" : "空头"}；命中 ${candidate.conditions.join("、")}；条件数 ${candidate.conditionCount}。仅作研究提醒，请人工复核，不代表下单建议。`,
      fetcher: options.fetcher,
    });
    addResult(summary, result);
  }
  return summary;
}

export { compositeKey };
