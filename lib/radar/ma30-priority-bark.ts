export type Ma30PriorityBarkGroup = { key: string; title: string; body: string };

type CrossEventLike = {
  symbol: string;
  interval: "15m" | "1h";
  direction: "LONG" | "SHORT";
  closeVsMa30Pct: number;
  stage: string | null;
};

type ReignitionEventLike = {
  symbol: string;
  interval: "15m";
  direction: "LONG" | "SHORT";
  closeVsMa30Pct: number;
  stage: string | null;
};

function displaySymbol(symbol: string) {
  return symbol.replace(/USDT$/, "");
}

function signedPct(value: number) {
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${normalized >= 0 ? "+" : ""}${normalized.toFixed(1)}%`;
}

function chineseStage(stage: string | null | undefined) {
  if (stage === "EARLY_ACCELERATION") return "初加速";
  if (stage === "PERSISTENT_ACCELERATION") return "持续加速";
  if (stage === "STEADY_UPTREND") return "稳步上涨";
  if (stage === "LATE_EXTENSION") return "过热延伸";
  if (stage === "EARLY_DOWN_ACCELERATION") return "初加速下跌";
  if (stage === "PERSISTENT_DOWN_ACCELERATION") return "持续下跌";
  if (stage === "STEADY_DOWNTREND") return "稳步下跌";
  if (stage === "LATE_DOWNTREND") return "下跌过深";
  return "重点观察";
}

function intervalLabel(interval: "15m" | "1h") {
  return interval === "1h" ? "1H" : "15m";
}

export function buildMa30PriorityBarkGroups(options: {
  scanBucket: string;
  crossEvents: readonly CrossEventLike[];
  reignitionEvents: readonly ReignitionEventLike[];
}): Ma30PriorityBarkGroup[] {
  const groups: Ma30PriorityBarkGroup[] = [];
  const crossBuckets = new Map<string, CrossEventLike[]>();

  for (const event of options.crossEvents) {
    const key = `${event.interval}:${event.direction}`;
    const bucket = crossBuckets.get(key) ?? [];
    bucket.push(event);
    crossBuckets.set(key, bucket);
  }

  for (const interval of ["15m", "1h"] as const) {
    for (const direction of ["LONG", "SHORT"] as const) {
      const rows = crossBuckets.get(`${interval}:${direction}`) ?? [];
      if (!rows.length) continue;
      const up = direction === "LONG";
      groups.push({
        key: `ma30-priority:cross:${options.scanBucket}:${interval}:${direction}`,
        title: `重点观察｜MA30${up ? "上穿" : "下穿"}｜${intervalLabel(interval)}`,
        body: rows.map((event, index) =>
          `${index + 1}.${displaySymbol(event.symbol)}，实体${up ? "上穿" : "下穿"}MA30，${signedPct(event.closeVsMa30Pct)}，${chineseStage(event.stage)}`
        ).join("\n"),
      });
    }
  }

  if (options.reignitionEvents.length) {
    groups.push({
      key: `ma30-priority:reignite:${options.scanBucket}`,
      title: "重点观察｜二次点火｜15m",
      body: options.reignitionEvents.map((event, index) =>
        `${index + 1}.${displaySymbol(event.symbol)}，${event.direction === "LONG" ? "多" : "空"}，回调后二次点火，${signedPct(event.closeVsMa30Pct)}，${chineseStage(event.stage)}`
      ).join("\n"),
    });
  }

  return groups;
}