type PlainObject = Record<string, unknown>;

type RadarCoin = {
  symbol: string;
  displayName: string;
  price: number;
  change15m: number;
  change1h: number;
  change4h: number;
  change24h: number;
  volume24h: number;
  heatScore: number;
  heatChange: number;
  mentionCount: number;
  oi15m: number;
  oi1h: number;
  oi4h: number;
  fundingRate: number;
  takerRatio: number;
  retailLsr: number;
  score: number;
  participation: "A" | "B" | "WATCH" | "AVOID";
  verdict: string;
  reasons: string[];
  risks: string[];
};

const demoCoins: Omit<RadarCoin, "participation" | "verdict" | "reasons" | "risks">[] = [
  { symbol: "HYPEUSDT", displayName: "HYPE", price: 42.68, change15m: 0.72, change1h: 2.84, change4h: 6.25, change24h: 11.7, volume24h: 894_000_000, heatScore: 91, heatChange: 48, mentionCount: 186, oi15m: 3.7, oi1h: 8.6, oi4h: 15.2, fundingRate: 0.0187, takerRatio: 1.21, retailLsr: 1.08, score: 82 },
  { symbol: "PENGUUSDT", displayName: "PENGU", price: 0.03418, change15m: -0.48, change1h: 1.35, change4h: 8.61, change24h: 19.4, volume24h: 322_000_000, heatScore: 86, heatChange: 63, mentionCount: 143, oi15m: 2.2, oi1h: 5.8, oi4h: 12.7, fundingRate: 0.0321, takerRatio: 1.09, retailLsr: 1.22, score: 73 },
  { symbol: "BMTUSDT", displayName: "BMT", price: 0.1864, change15m: 3.82, change1h: 12.4, change4h: 27.8, change24h: 58.6, volume24h: 76_000_000, heatScore: 95, heatChange: 112, mentionCount: 214, oi15m: 9.6, oi1h: 24.1, oi4h: 46.8, fundingRate: 0.087, takerRatio: 2.07, retailLsr: 1.92, score: 78 },
  { symbol: "SOLUSDT", displayName: "SOL", price: 198.31, change15m: 0.21, change1h: 0.92, change4h: 2.73, change24h: 5.2, volume24h: 3_820_000_000, heatScore: 72, heatChange: 18, mentionCount: 96, oi15m: 0.8, oi1h: 2.4, oi4h: 5.1, fundingRate: 0.0098, takerRatio: 1.04, retailLsr: 1.14, score: 68 },
  { symbol: "WIFUSDT", displayName: "WIF", price: 1.284, change15m: -1.12, change1h: -0.68, change4h: 4.16, change24h: 8.9, volume24h: 119_000_000, heatScore: 76, heatChange: 35, mentionCount: 105, oi15m: -1.9, oi1h: -3.4, oi4h: 2.2, fundingRate: 0.0144, takerRatio: 0.82, retailLsr: 1.31, score: 51 },
];

function object(value: unknown): PlainObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as PlainObject) : {};
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function firstValue(sources: PlainObject[], keys: string[]) {
  for (const source of sources) {
    for (const key of keys) {
      if (source[key] !== undefined && source[key] !== null) return source[key];
    }
  }
  return undefined;
}

function percentFunding(value: number) {
  return Math.abs(value) < 0.01 && value !== 0 ? value * 100 : value;
}

function analyze(base: Omit<RadarCoin, "participation" | "verdict" | "reasons" | "risks">): RadarCoin {
  const reasons: string[] = [];
  const risks: string[] = [];

  if (base.heatChange >= 25) reasons.push(`广场热度加速 ${base.heatChange.toFixed(0)}%，关注增量明显`);
  if (base.volume24h >= 20_000_000) reasons.push(`24h成交额 ${formatCompact(base.volume24h)}，基础流动性达标`);
  if (base.change1h >= 0 && base.change1h <= 10) reasons.push("1h动量为正且尚未进入极端拉升");
  if (base.oi15m > 0 && base.oi1h > 0) reasons.push("15m与1h持仓量同步增加，有新增资金参与");
  if (base.takerRatio > 0.9 && base.takerRatio < 1.8) reasons.push(`主动买卖比 ${base.takerRatio.toFixed(2)}，买盘健康但未极端`);

  if (base.volume24h < 20_000_000) risks.push("24h成交额低于2000万USDT，流动性不足");
  if (base.change4h > 25) risks.push(`4h涨幅 ${base.change4h.toFixed(1)}%，触发过热否决`);
  if (base.change24h > 50) risks.push(`24h涨幅 ${base.change24h.toFixed(1)}%，追涨风险过高`);
  if (base.fundingRate >= 0.05) risks.push(`资金费率 ${base.fundingRate.toFixed(4)}%，多头成本极端`);
  if (base.retailLsr >= 1.7) risks.push(`散户多空比 ${base.retailLsr.toFixed(2)}，方向过度拥挤`);
  if (base.takerRatio >= 1.8) risks.push(`主动买卖比 ${base.takerRatio.toFixed(2)}，短线买盘可能透支`);
  if (base.takerRatio < 0.85) risks.push("主动买盘衰退，暂不确认热度有效");
  if (base.oi15m <= 0 || base.oi1h <= 0) risks.push("短周期持仓量未同步增长，热度缺少资金确认");

  const hardVeto = risks.some((risk) => /否决|极端|不足|过度拥挤/.test(risk));
  const qualityCount = reasons.length;
  let participation: RadarCoin["participation"] = "WATCH";
  if (hardVeto) participation = "AVOID";
  else if (qualityCount >= 5 && base.score >= 65) participation = "A";
  else if (qualityCount >= 3 && base.score >= 55) participation = "B";

  const verdict =
    participation === "A"
      ? "热度、流动性与新增持仓形成共振，适合列入回撤参与候选，不适合直接追高。"
      : participation === "B"
        ? "线索具备，但确认条件还不完整；等待短周期量价或持仓量改善。"
        : participation === "AVOID"
          ? "热门不等于安全。当前已触发硬性风险条件，热度越高越应防范反向波动。"
          : "广场出现讨论增量，但市场数据暂未确认，保留观察即可。";

  return { ...base, participation, verdict, reasons: reasons.length ? reasons : ["已进入广场热度观察池"], risks };
}

function formatCompact(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B USDT`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M USDT`;
  return `${value.toFixed(0)} USDT`;
}

function extractRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const root = object(payload);
  for (const key of ["leaderboard", "items", "rows", "coins", "data"]) {
    if (Array.isArray(root[key])) return root[key] as unknown[];
    const nested = object(root[key]);
    for (const nestedKey of ["leaderboard", "items", "rows", "coins", "list"]) {
      if (Array.isArray(nested[nestedKey])) return nested[nestedKey] as unknown[];
    }
  }
  return [];
}

function normalizeRow(item: unknown): Omit<RadarCoin, "participation" | "verdict" | "reasons" | "risks"> | null {
  const row = object(item);
  const market = object(row.market ?? row.snapshot ?? row.market_snapshot);
  const signal = object(row.signal ?? row.analysis ?? row.signals);
  const heat = object(row.heat ?? row.social ?? row.heat_data);
  const sources = [row, market, signal, heat];
  const rawSymbol = string(firstValue(sources, ["symbol", "token", "coin", "asset"])).toUpperCase();
  if (!rawSymbol) return null;
  const displayName = rawSymbol.replace(/[-_/]?USDT$/i, "");
  const symbol = rawSymbol.endsWith("USDT") ? rawSymbol.replace(/[-_/]/g, "") : `${rawSymbol.replace(/[-_/]/g, "")}USDT`;
  const fundingRate = percentFunding(number(firstValue(sources, ["funding_rate", "fundingRate", "funding"])));

  return {
    symbol,
    displayName,
    price: number(firstValue(sources, ["price", "last_price", "lastPrice", "mark_price"])),
    change15m: number(firstValue(sources, ["change_15m", "change15m", "price_change_15m", "pct_15m"])),
    change1h: number(firstValue(sources, ["change_1h", "change1h", "price_change_1h", "pct_1h"])),
    change4h: number(firstValue(sources, ["change_4h", "change4h", "price_change_4h", "pct_4h"])),
    change24h: number(firstValue(sources, ["change_24h", "change24h", "price_change_24h", "pct_24h"])),
    volume24h: number(firstValue(sources, ["volume_24h", "quote_volume_24h", "quoteVolume", "turnover_24h"])),
    heatScore: number(firstValue(sources, ["heat_score", "heatScore", "heat", "social_score", "score"])),
    heatChange: number(firstValue(sources, ["heat_change", "heatChange", "heat_acceleration", "growth_rate"])),
    mentionCount: number(firstValue(sources, ["mention_count", "mentions", "post_count", "posts_count"])),
    oi15m: number(firstValue(sources, ["oi_change_15m", "oi15m", "open_interest_change_15m"])),
    oi1h: number(firstValue(sources, ["oi_change_1h", "oi1h", "open_interest_change_1h"])),
    oi4h: number(firstValue(sources, ["oi_change_4h", "oi4h", "open_interest_change_4h"])),
    fundingRate,
    takerRatio: number(firstValue(sources, ["taker_ratio", "takerRatio", "buy_sell_ratio"]), 1),
    retailLsr: number(firstValue(sources, ["global_lsr", "retail_lsr", "long_short_ratio", "lsr"]), 1),
    score: Math.round(number(firstValue([signal, row], ["score", "signal_score", "total_score"]), 50)),
  };
}

export async function GET() {
  const baseUrl = process.env.SQUARE_MONITOR_BASE_URL?.replace(/\/$/, "");

  if (baseUrl) {
    try {
      const response = await fetch(`${baseUrl}/api/leaderboard`, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(7_000),
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`monitor_${response.status}`);
      const payload: unknown = await response.json();
      const coins = extractRows(payload)
        .map(normalizeRow)
        .filter((coin): coin is NonNullable<typeof coin> => Boolean(coin))
        .map(analyze)
        .sort((a, b) => b.score - a.score);

      if (coins.length) {
        return Response.json({
          mode: "live",
          updatedAt: new Date().toISOString(),
          sourceStatus: `币安广场监控 · ${coins.length} 个有效币种`,
          coins,
        });
      }
    } catch {
      // Fall through to clearly labeled demo data when the independent collector is unavailable.
    }
  }

  return Response.json({
    mode: "demo",
    updatedAt: new Date().toISOString(),
    sourceStatus: baseUrl ? "采集服务离线 · 已切换演示数据" : "尚未连接采集服务",
    coins: demoCoins.map(analyze).sort((a, b) => b.score - a.score),
  });
}
