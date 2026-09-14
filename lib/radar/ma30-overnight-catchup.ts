export type Ma30OvernightLifecycleEvent = {
  type: "ENTER" | "REENTER" | "EXIT" | "STAGE_CHANGE" | "AI_CHANGE";
  group: "A" | "B" | "C" | "SHORT" | "AI";
  symbol: string;
  at: string;
  previousRank: number | null;
  currentRank: number | null;
  previousStage: string | null;
  currentStage: string | null;
};

export type Ma30OvernightEventRecord = {
  runId: string;
  eventIndex: number;
  runTimeBjt: string;
  event: Ma30OvernightLifecycleEvent;
  notificationState: {
    a: Array<Record<string, unknown> & { symbol: string }>;
    b: Array<Record<string, unknown> & { symbol: string }>;
    c: Array<Record<string, unknown> & { symbol: string }>;
    shorts: Array<Record<string, unknown> & { symbol: string }>;
    ai: Array<Record<string, unknown> & { symbol: string }>;
  };
};

export type Ma30OvernightCatchupGroup = {
  key: string;
  title: string;
  body: string;
};

const IMPORTANT = new Set(["ENTER", "REENTER", "STAGE_CHANGE", "AI_CHANGE"]);

function displaySymbol(symbol: string): string {
  return symbol.replace(/USDT$/, "");
}

function stageZh(stage: unknown): string | null {
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
    default: return null;
  }
}

function directionZh(direction: unknown): string | null {
  if (direction === "LONG") return "多";
  if (direction === "SHORT") return "空";
  return null;
}

function confidenceZh(confidence: unknown): string | null {
  if (confidence === "HIGH") return "高信心";
  if (confidence === "MEDIUM") return "中信心";
  if (confidence === "LOW") return "低信心";
  return null;
}

function signedPct(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const normalized = Math.abs(value) < 0.05 ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(1)}%`;
}

function groupLabel(group: Ma30OvernightLifecycleEvent["group"]): string {
  if (group === "SHORT") return "空头";
  if (group === "AI") return "AI";
  return `${group}组`;
}

function rowsForGroup(record: Ma30OvernightEventRecord): Array<Record<string, unknown> & { symbol: string }> {
  const state = record.notificationState;
  if (record.event.group === "A") return state.a;
  if (record.event.group === "B") return state.b;
  if (record.event.group === "C") return state.c;
  if (record.event.group === "SHORT") return state.shorts;
  return state.ai;
}

function rowForRecord(record: Ma30OvernightEventRecord): (Record<string, unknown> & { symbol: string }) | undefined {
  return rowsForGroup(record).find((row) => row.symbol === record.event.symbol);
}

function eventLabel(type: Ma30OvernightLifecycleEvent["type"]): string {
  if (type === "ENTER") return "新入榜";
  if (type === "REENTER") return "重新入榜";
  if (type === "STAGE_CHANGE") return "阶段变化";
  if (type === "AI_CHANGE") return "变化";
  return "已退出";
}

function timeHm(value: string): string {
  const match = value.match(/(?:T|\s)(\d{2}:\d{2})/);
  return match?.[1] ?? value;
}

function renderRecord(record: Ma30OvernightEventRecord): string {
  const event = record.event;
  const base = `${timeHm(record.runTimeBjt)} ${groupLabel(event.group)} ${displaySymbol(event.symbol)}，${eventLabel(event.type)}`;
  if (event.type === "EXIT") return base;
  const row = rowForRecord(record);
  if (!row) return base;

  const parts: string[] = [];
  if (event.group === "AI") {
    const direction = directionZh(row.direction);
    const stage = stageZh(row.direction === "SHORT" ? row.shortStage : row.longStage);
    const distance = signedPct(row.priceVsMa30Pct);
    const confidence = confidenceZh(row.confidence);
    if (direction) parts.push(direction);
    if (stage) parts.push(stage);
    if (distance) parts.push(distance);
    if (confidence) parts.push(confidence);
  } else {
    const stage = stageZh(row.stage ?? event.currentStage);
    const distance = signedPct(row.priceVsMa30Pct);
    if (stage) parts.push(stage);
    if (distance) parts.push(distance);
  }
  return parts.length ? `${base}，${parts.join("，")}` : base;
}

export function ma30QuietWindowForScanBucket(scanBucket: string) {
  const match = scanBucket.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}$/);
  if (!match) throw new Error(`invalid MA30 scan bucket: ${scanBucket}`);
  const [, year, month, day] = match;
  const dateKey = `${year}-${month}-${day}`;
  return {
    dateKey,
    startBjt: `${dateKey} 02:00:00`,
    endBjt: `${dateKey} 08:00:00`,
  };
}

export function selectMa30OvernightCatchupRecords(records: readonly Ma30OvernightEventRecord[]): Ma30OvernightEventRecord[] {
  const ordered = [...records].sort((a, b) =>
    a.runTimeBjt.localeCompare(b.runTimeBjt) || a.eventIndex - b.eventIndex,
  );
  const relevantPairs = new Set<string>();
  const selected: Ma30OvernightEventRecord[] = [];
  for (const record of ordered) {
    const pair = `${record.event.group}:${record.event.symbol}`;
    if (IMPORTANT.has(record.event.type)) {
      relevantPairs.add(pair);
      selected.push(record);
      continue;
    }
    if (record.event.type === "EXIT" && relevantPairs.has(pair)) selected.push(record);
  }
  return selected;
}

export function buildMa30OvernightCatchupGroup(options: {
  records: readonly Ma30OvernightEventRecord[];
  scanBucket: string;
  bjtHour: number;
}): Ma30OvernightCatchupGroup | null {
  if (options.bjtHour < 8) return null;
  const window = ma30QuietWindowForScanBucket(options.scanBucket);
  const selected = selectMa30OvernightCatchupRecords(options.records);
  if (!selected.length) return null;
  return {
    key: `radar:ma30-slope:${window.dateKey}:OVERNIGHT-CATCHUP`,
    title: `MA30 夜间变化｜${window.dateKey.slice(5, 7)}${window.dateKey.slice(8, 10)}-08:00`,
    body: selected.map(renderRecord).join("\n"),
  };
}
