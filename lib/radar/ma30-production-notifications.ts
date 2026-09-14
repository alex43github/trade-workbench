import type { RadarBarkGroup } from "./bark-notifications.ts";
import type { Ma30LifecycleEvent } from "./ma30-lifecycle.ts";
import type { Ma30NotificationState } from "./ma30-notifications.ts";
import { isMa30BarkQuietHourBjt } from "./ma30-notifications.ts";

function displaySymbol(symbol: string): string {
  return symbol.replace(/USDT$/, "");
}

function displayScanBucket(scanBucket: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/.exec(scanBucket);
  if (!match) return scanBucket;
  return `${match[2]}${match[3]}-${match[4]}:00`;
}

function bySymbol<T extends { symbol: string }>(rows: readonly T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.symbol, row]));
}

function important(event: Ma30LifecycleEvent): boolean {
  return event.type === "ENTER"
    || event.type === "REENTER"
    || event.type === "STAGE_CHANGE"
    || event.type === "AI_CHANGE";
}

function chineseStage(stage: string | null | undefined): string {
  switch (stage) {
    case "EARLY_ACCELERATION": return "初加速";
    case "PERSISTENT_ACCELERATION": return "持续加速";
    case "STEADY_UPTREND": return "稳步上涨";
    case "LATE_EXTENSION": return "过热延伸";
    case "EARLY_DOWN_ACCELERATION": return "初加速下跌";
    case "PERSISTENT_DOWN_ACCELERATION": return "持续下跌";
    case "STEADY_DOWNTREND": return "稳步下跌";
    case "LATE_DOWNTREND": return "下跌过深";
    case "NOT_CANDIDATE": return "非加速";
    default: return "阶段未知";
  }
}

function chineseDirection(direction: string): string {
  if (direction === "LONG") return "多";
  if (direction === "SHORT") return "空";
  return "方向未知";
}

function chineseConfidence(confidence: string): string {
  if (confidence === "HIGH") return "高信心";
  if (confidence === "MEDIUM") return "中信心";
  if (confidence === "LOW") return "低信心";
  return "信心未知";
}

function signedPct(value: number): string {
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(1)}%`;
}

function signedSlope(value: number): string {
  const normalized = Math.abs(value) < 0.0005 ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(3)}`;
}

function rowsForEvents<T extends { symbol: string }>(
  events: readonly Ma30LifecycleEvent[],
  rows: Map<string, T>,
): T[] {
  const seen = new Set<string>();
  const selected: T[] = [];
  for (const event of events) {
    if (seen.has(event.symbol)) continue;
    const row = rows.get(event.symbol);
    if (!row) continue;
    seen.add(event.symbol);
    selected.push(row);
  }
  return selected;
}

/**
 * User-facing production Bark is intentionally terse:
 * - one coin per line
 * - Chinese stages only
 * - current group ranking first
 * - MA30 distance always visible
 * - scan-bucket time visible in every title
 * - no raw lifecycle transition strings or low-value acceleration decimals
 */
export function buildMa30LifecycleBarkGroups(options: {
  current: Ma30NotificationState;
  events: readonly Ma30LifecycleEvent[];
  scanBucket: string;
  bjtHour: number;
}): RadarBarkGroup[] {
  if (isMa30BarkQuietHourBjt(options.bjtHour)) return [];

  const events = options.events.filter(important);
  const a = bySymbol(options.current.a);
  const b = bySymbol(options.current.b);
  const c = bySymbol(options.current.c);
  const shorts = bySymbol(options.current.shorts);
  const ai = bySymbol(options.current.ai);
  const groups: RadarBarkGroup[] = [];
  const scanTime = displayScanBucket(options.scanBucket);

  for (const group of ["A", "B", "C", "SHORT", "AI"] as const) {
    const selected = events.filter((event) => event.group === group);
    if (!selected.length) continue;

    if (group === "A") {
      const rows = rowsForEvents(selected, a).sort((left, right) => left.rank - right.rank);
      if (rows.length) groups.push({
        key: `radar:ma30-slope:${options.scanBucket}:A:lifecycle`,
        title: `MA30 A组｜${scanTime}`,
        body: rows.map((row) => `${row.rank}.${displaySymbol(row.symbol)}，${chineseStage(row.stage)}，${signedPct(row.priceVsMa30Pct)}，斜率${signedSlope(row.slope20)}`).join("\n"),
      });
      continue;
    }

    if (group === "B") {
      const rows = rowsForEvents(selected, b).sort((left, right) => left.bRank - right.bRank);
      if (rows.length) groups.push({
        key: `radar:ma30-slope:${options.scanBucket}:B:lifecycle`,
        title: `MA30 B组｜${scanTime}`,
        body: rows.map((row) => `${row.bRank}.${displaySymbol(row.symbol)}，${chineseStage(row.stage)}，${signedPct(row.priceVsMa30Pct)}`).join("\n"),
      });
      continue;
    }

    if (group === "C") {
      const rows = rowsForEvents(selected, c).sort((left, right) => left.rank - right.rank);
      if (rows.length) groups.push({
        key: `radar:ma30-slope:${options.scanBucket}:C:lifecycle`,
        title: `MA30 C组｜${scanTime}`,
        body: rows.map((row) => `${row.rank}.${displaySymbol(row.symbol)}，${chineseStage(row.stage)}，${signedPct(row.priceVsMa30Pct)}`).join("\n"),
      });
      continue;
    }

    if (group === "SHORT") {
      const rows = rowsForEvents(selected, shorts).sort((left, right) => left.rank - right.rank);
      if (rows.length) groups.push({
        key: `radar:ma30-slope:${options.scanBucket}:SHORT:lifecycle`,
        title: `MA30 空头｜${scanTime}`,
        body: rows.map((row) => `${row.rank}.${displaySymbol(row.symbol)}，${chineseStage(row.stage)}，${signedPct(row.priceVsMa30Pct)}`).join("\n"),
      });
      continue;
    }

    const rows = rowsForEvents(selected, ai).sort((left, right) => left.aiRank - right.aiRank);
    if (rows.length) groups.push({
      key: `radar:ma30-slope:${options.scanBucket}:AI:lifecycle`,
      title: `MA30 AI精选｜${scanTime}`,
      body: rows.map((row) => {
        const stage = row.direction === "SHORT" ? row.shortStage : row.longStage;
        return `${row.aiRank}.${displaySymbol(row.symbol)}，${chineseDirection(row.direction)}，${chineseStage(stage)}，${signedPct(row.priceVsMa30Pct)}，${chineseConfidence(row.confidence)}`;
      }).join("\n"),
    });
  }

  return groups;
}

function renderA(rows: Ma30NotificationState["a"]): string {
  return rows.slice(0, 10)
    .sort((left, right) => left.rank - right.rank)
    .map((row) => `${row.rank}.${displaySymbol(row.symbol)}，${chineseStage(row.stage)}，${signedPct(row.priceVsMa30Pct)}，斜率${signedSlope(row.slope20)}`)
    .join("\n") || "无";
}

function renderB(rows: Ma30NotificationState["b"]): string {
  return rows.slice(0, 10)
    .sort((left, right) => left.bRank - right.bRank)
    .map((row) => `${row.bRank}.${displaySymbol(row.symbol)}，${chineseStage(row.stage)}，${signedPct(row.priceVsMa30Pct)}`)
    .join("\n") || "无";
}

function renderC(rows: Ma30NotificationState["c"]): string {
  return rows.slice(0, 8)
    .sort((left, right) => left.rank - right.rank)
    .map((row) => `${row.rank}.${displaySymbol(row.symbol)}，${chineseStage(row.stage)}，${signedPct(row.priceVsMa30Pct)}`)
    .join("\n") || "无";
}

function renderShort(rows: Ma30NotificationState["shorts"]): string {
  return rows.slice(0, 5)
    .sort((left, right) => left.rank - right.rank)
    .map((row) => `${row.rank}.${displaySymbol(row.symbol)}，${chineseStage(row.stage)}，${signedPct(row.priceVsMa30Pct)}`)
    .join("\n") || "无";
}

function renderAi(rows: Ma30NotificationState["ai"]): string {
  return [...rows].sort((left, right) => left.aiRank - right.aiRank)
    .map((row) => {
      const stage = row.direction === "SHORT" ? row.shortStage : row.longStage;
      return `${row.aiRank}.${displaySymbol(row.symbol)}，${chineseDirection(row.direction)}，${chineseStage(stage)}，${signedPct(row.priceVsMa30Pct)}，${chineseConfidence(row.confidence)}`;
    })
    .join("\n") || "无";
}

/**
 * Special 07:00 BJT digest. It intentionally bypasses ordinary 02:00-08:00
 * quiet-hour suppression; all other ordinary Bark remains quiet until 08:00.
 */
export function buildMa30OvernightBriefGroup(options: {
  current: Ma30NotificationState;
  scanBucket: string;
  bjtHour: number;
}): RadarBarkGroup | null {
  if (options.bjtHour !== 7) return null;

  return {
    key: `radar:ma30-slope:${options.scanBucket}:OVERNIGHT`,
    title: `MA30 夜间汇总｜${displayScanBucket(options.scanBucket)}`,
    body: [
      "A组", renderA(options.current.a),
      "", "B组", renderB(options.current.b),
      "", "C组", renderC(options.current.c),
      "", "空头", renderShort(options.current.shorts),
      "", "AI精选", renderAi(options.current.ai),
    ].join("\n"),
  };
}
