import { scoreShortCrowding } from "@/lib/radar/short-crowding";
import { fetchAsterOi } from "@/lib/radar/aster-public";
import { calculateTop10Concentration } from "@/lib/radar/chip-concentration";
import { fetchOnchainTop10 } from "@/lib/radar/onchain-holders";
import { binancePublicJson } from "@/lib/binance-public";
import { loadTvScreenerResearch, unavailableTvScreenerResearch, type TvScreenerResearch } from "./tvscreener/route";

type PlainObject = Record<string, unknown>;
type Participation = "SQUEEZE" | "A" | "B" | "WATCH" | "AVOID";
type CrowdMood = "SHORT_CROWD" | "TRAPPED" | "CHASE_LONG" | "MIXED" | "UNKNOWN";
type DataState = "live" | "partial" | "pending" | "demo";

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
  authorCount?: number;
  bullishRatio?: number;
  neutralRatio?: number;
  relativeBtc4h?: number;
  maxDrawdown24h?: number;
  shortLiquidations1h?: number;
  breakoutScore?: number;
  crowdMood: CrowdMood;
  shortCallRatio: number;
  trappedRatio: number;
  resilienceScore: number;
  oi15m: number;
  oi1h: number;
  oi4h: number;
  fundingRate: number;
  takerRatio: number;
  retailLsr: number;
  asterOi1h: number | null;
  top10Pct: number | null;
  top1Pct: number | null;
  cexPct: number | null;
  quietWalletPct: number | null;
  chipStage: string;
  chainAnomaly: number | null;
  chainSignal: string;
  score: number;
  participation: Participation;
  setupTags: string[];
  verdict: string;
  reasons: string[];
  risks: string[];
  coverage: {
    square: DataState;
    binanceOi: DataState;
    aster: DataState;
    chips: DataState;
    chain: DataState;
  };
  shortCrowding?: ReturnType<typeof scoreShortCrowding>;
};

type RadarBase = Omit<RadarCoin, "score" | "participation" | "setupTags" | "verdict" | "reasons" | "risks" | "shortCrowding">;

const BINANCE_FUTURES = "https://fapi.binance.com";
const BINANCE_FUTURES_DATA = "https://fapi.binance.com/futures/data";
const asterSnapshots = new Map<string, { symbol: string; openInterest: number; capturedAt: string }>();

const demoCoins: RadarBase[] = [
  {
    symbol: "HYPEUSDT", displayName: "HYPE", price: 42.68, change15m: 0.72, change1h: 2.84,
    change4h: 6.25, change24h: 11.7, volume24h: 894_000_000, heatScore: 91, heatChange: 48,
    mentionCount: 186, crowdMood: "SHORT_CROWD", shortCallRatio: 64, trappedRatio: 18,
    resilienceScore: 82, oi15m: 3.7, oi1h: 8.6, oi4h: 15.2, fundingRate: 0.0187,
    takerRatio: 1.21, retailLsr: 0.78, asterOi1h: 6.4,
    top10Pct: 58.4, top1Pct: 18.6, cexPct: 12.4, quietWalletPct: 3.2, chipStage: "拉升中",
    chainAnomaly: 63, chainSignal: "净流出CEX", coverage: { square: "demo", binanceOi: "demo", aster: "demo", chips: "demo", chain: "demo" },
  },
  {
    symbol: "PENGUUSDT", displayName: "PENGU", price: 0.03418, change15m: -0.48, change1h: 1.35,
    change4h: 8.61, change24h: 19.4, volume24h: 322_000_000, heatScore: 86, heatChange: 63,
    mentionCount: 143, crowdMood: "TRAPPED", shortCallRatio: 38, trappedRatio: 47,
    resilienceScore: 69, oi15m: 2.2, oi1h: 5.8, oi4h: 12.7, fundingRate: 0.0321,
    takerRatio: 1.09, retailLsr: 1.22, asterOi1h: 2.1,
    top10Pct: 44.8, top1Pct: 9.4, cexPct: 18.2, quietWalletPct: 6.1, chipStage: "横盘整理",
    chainAnomaly: 41, chainSignal: "中性", coverage: { square: "demo", binanceOi: "demo", aster: "demo", chips: "demo", chain: "demo" },
  },
  {
    symbol: "BMTUSDT", displayName: "BMT", price: 0.1864, change15m: 3.82, change1h: 12.4,
    change4h: 27.8, change24h: 58.6, volume24h: 76_000_000, heatScore: 95, heatChange: 112,
    mentionCount: 214, crowdMood: "CHASE_LONG", shortCallRatio: 11, trappedRatio: 8,
    resilienceScore: 91, oi15m: 9.6, oi1h: 24.1, oi4h: 46.8, fundingRate: 0.087,
    takerRatio: 2.07, retailLsr: 1.92, asterOi1h: 16.5,
    top10Pct: 82.6, top1Pct: 61.4, cexPct: 34.7, quietWalletPct: 12.6, chipStage: "派发预警",
    chainAnomaly: 88, chainSignal: "CEX大额充值", coverage: { square: "demo", binanceOi: "demo", aster: "demo", chips: "demo", chain: "demo" },
  },
  {
    symbol: "SOLUSDT", displayName: "SOL", price: 198.31, change15m: 0.21, change1h: 0.92,
    change4h: 2.73, change24h: 5.2, volume24h: 3_820_000_000, heatScore: 72, heatChange: 18,
    mentionCount: 96, crowdMood: "MIXED", shortCallRatio: 36, trappedRatio: 19,
    resilienceScore: 61, oi15m: 0.8, oi1h: 2.4, oi4h: 5.1, fundingRate: 0.0098,
    takerRatio: 1.04, retailLsr: 1.14, asterOi1h: 1.3,
    top10Pct: 31.2, top1Pct: 7.3, cexPct: 22.4, quietWalletPct: 1.1, chipStage: "横盘整理",
    chainAnomaly: 28, chainSignal: "中性", coverage: { square: "demo", binanceOi: "demo", aster: "demo", chips: "demo", chain: "demo" },
  },
  {
    symbol: "WIFUSDT", displayName: "WIF", price: 1.284, change15m: -1.12, change1h: -0.68,
    change4h: 4.16, change24h: 8.9, volume24h: 119_000_000, heatScore: 76, heatChange: 35,
    mentionCount: 105, crowdMood: "SHORT_CROWD", shortCallRatio: 58, trappedRatio: 21,
    resilienceScore: 43, oi15m: -1.9, oi1h: -3.4, oi4h: 2.2, fundingRate: 0.0144,
    takerRatio: 0.82, retailLsr: 0.74, asterOi1h: -1.6,
    top10Pct: 39.5, top1Pct: 11.2, cexPct: 25.1, quietWalletPct: 2.4, chipStage: "派发中",
    chainAnomaly: 71, chainSignal: "大户转入CEX", coverage: { square: "demo", binanceOi: "demo", aster: "demo", chips: "demo", chain: "demo" },
  },
];

function object(value: unknown): PlainObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as PlainObject) : {};
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const parsed = number(value, Number.NaN);
  return Number.isFinite(parsed) ? parsed : null;
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function percentFunding(value: number) {
  return Math.abs(value) < 0.01 && value !== 0 ? value * 100 : value;
}

function formatCompact(value: number) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B USDT`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)}M USDT`;
  return `${value.toFixed(0)} USDT`;
}

function analyze(base: RadarBase): RadarCoin {
  const reasons: string[] = [];
  const risks: string[] = [];
  const setupTags: string[] = [];
  let score = 0;

  if (base.coverage.square !== "pending") {
    score += clamp(base.heatScore / 100, 0, 1) * 13;
    score += clamp(base.heatChange / 80, 0, 1) * 5;
    if (base.heatChange >= 25) reasons.push(`广场热度加速 ${base.heatChange.toFixed(0)}%，讨论正在放大`);
    if (base.crowdMood === "SHORT_CROWD") setupTags.push("喊空集中");
    if (base.crowdMood === "TRAPPED") setupTags.push("套牢/扛单");
  } else {
    risks.push("币安广场语义尚未接入，本轮不计算喊空和套牢信号");
  }

  const squeezeContext =
    base.crowdMood === "SHORT_CROWD" && base.shortCallRatio >= 55 &&
    base.resilienceScore >= 60 && base.oi1h > 0 && base.change1h >= -0.5;
  if (squeezeContext) {
    score += 16;
    setupTags.push("反向情绪");
    reasons.push(`喊空占比 ${base.shortCallRatio.toFixed(0)}%，但价格抗压且1h OI仍增加`);
  }
  if (base.crowdMood === "TRAPPED" && base.resilienceScore >= 65) {
    score += 8;
    reasons.push("广场套牢/扛单语义偏多，但价格尚未出现有效破位");
  }

  if (base.volume24h >= 20_000_000) {
    score += 8;
    reasons.push(`24h成交额 ${formatCompact(base.volume24h)}，基础流动性达标`);
  } else {
    risks.push("24h成交额低于2000万USDT，触发流动性否决");
  }

  if (base.change1h >= 0 && base.change1h <= 10) {
    score += 7;
    reasons.push("1h动量为正且尚未进入极端拉升");
  }
  if (base.resilienceScore >= 65) {
    score += 6;
    setupTags.push("价格抗压");
  }

  if (base.coverage.binanceOi !== "pending") {
    if (base.oi15m > 0 && base.oi1h > 0) {
      score += 16;
      setupTags.push("OI共振");
      reasons.push("15m与1h OI同步增加，存在新增对手盘");
    } else if (base.oi1h > 0) {
      score += 7;
    } else {
      risks.push("短周期OI没有同步增加，热度缺少新增持仓确认");
    }
    if (base.takerRatio >= 0.9 && base.takerRatio <= 1.55) {
      score += 5;
      reasons.push(`主动买卖比 ${base.takerRatio.toFixed(2)}，承接存在但未极端`);
    }
  } else {
    risks.push("Binance Futures OI尚未接入，无法确认新增持仓");
  }

  if (base.coverage.aster !== "pending" && base.asterOi1h !== null) {
    if (base.asterOi1h > 2) {
      score += 5;
      setupTags.push("Aster增仓");
      reasons.push(`Aster 1h OI增加 ${base.asterOi1h.toFixed(1)}%，跨市场持仓同步`);
    }
  } else {
    risks.push("Aster OI暂无上一时点快照，本轮不计算跨市场增仓");
  }

  if (base.coverage.chips !== "pending" && base.top10Pct !== null) {
    if (base.top10Pct >= 35 && base.top10Pct <= 70) {
      score += 11;
      setupTags.push("筹码集中");
      reasons.push(`Top10持仓 ${base.top10Pct.toFixed(1)}%，具备控盘特征但未达到极端阈值`);
    }
    if (/吸筹|拉升/.test(base.chipStage)) score += 4;
  } else {
    risks.push("筹码快照待接入，尚未排除交易所、LP和锁仓地址");
  }

  if (base.coverage.chain !== "pending" && base.chainAnomaly !== null) {
    if (/净流出CEX|聪明钱流入/.test(base.chainSignal)) {
      score += 7;
      setupTags.push("链上流入");
      reasons.push(`链上信号：${base.chainSignal}`);
    }
    if (/转入CEX|充值|派发/.test(base.chainSignal) && base.chainAnomaly >= 65) {
      risks.push(`链上出现${base.chainSignal}，异常度 ${base.chainAnomaly}/100`);
    }
  } else {
    risks.push("链上资金流与异常转账待接入，不计入当前评分");
  }

  if (base.change4h > 30) risks.push(`4h涨幅 ${base.change4h.toFixed(1)}%，触发过热否决`);
  if (base.change24h > 60) risks.push(`24h涨幅 ${base.change24h.toFixed(1)}%，追涨风险过高`);
  if (Math.abs(base.fundingRate) >= 0.08) risks.push(`资金费率 ${base.fundingRate.toFixed(3)}%，方向成本极端`);
  if (base.retailLsr >= 1.8) risks.push(`散户多空比 ${base.retailLsr.toFixed(2)}，追多过度拥挤`);
  if (base.takerRatio >= 1.9) risks.push(`主动买卖比 ${base.takerRatio.toFixed(2)}，短线买盘可能透支`);
  if ((base.top10Pct ?? 0) > 85) risks.push("排除交易所后的Top10筹码过度集中，少数地址集群具备砸盘能力");
  if (/派发预警|派发中/.test(base.chipStage)) risks.push(`筹码阶段为“${base.chipStage}”`);

  const hardVeto = risks.some((risk) => /触发|极端|过度集中|派发中|CEX大额充值/.test(risk));
  score = Math.round(clamp(score, 0, 100));
  let participation: Participation = "WATCH";
  if (hardVeto) participation = "AVOID";
  else if (squeezeContext && score >= 65) participation = "SQUEEZE";
  else if (score >= 72 && base.coverage.square !== "pending") participation = "A";
  else if (score >= 50) participation = "B";

  const verdict =
    participation === "SQUEEZE"
      ? "广场喊空与市场抗跌形成背离，OI继续增长，进入逼空重点池；仍需等待回撤结构和卖盘吸收确认。"
      : participation === "A"
        ? "热度、流动性和资金证据形成共振，可列入回撤参与候选，不适合直接追高。"
        : participation === "B"
          ? "已有部分有效线索，但数据源或确认条件尚未补齐，等待证据升级。"
          : participation === "AVOID"
            ? "当前命中硬风险条件。热度越高越应谨慎，不因反向情绪强行参与。"
            : "存在波动或讨论线索，但目前不足以形成可执行计划，保留观察。";

  const shortCrowding = scoreShortCrowding({
    bearishRatio: base.shortCallRatio, mentionCount: base.mentionCount, authorCount: base.authorCount ?? Math.max(0, Math.round(base.mentionCount * .35)), heatChange: base.heatChange,
    change4h: base.change4h, relativeBtc4h: base.relativeBtc4h ?? 0, maxDrawdown24h: base.maxDrawdown24h ?? Math.max(0, -Math.min(base.change1h, base.change4h, base.change24h)), resilienceScore: base.resilienceScore,
    oi1h: base.oi1h, oi4h: base.oi4h, fundingRate: base.fundingRate, takerRatio: base.takerRatio,
    shortLiquidations1h: base.shortLiquidations1h ?? 0, breakoutScore: base.breakoutScore ?? Math.max(0, Math.min(100, base.resilienceScore + base.change4h * 3)),
    squareCovered: base.coverage.square !== "pending", positionCovered: base.coverage.binanceOi !== "pending",
  });
  return {
    ...base,
    score,
    participation,
    setupTags: setupTags.length ? [...new Set(setupTags)].slice(0, 5) : ["证据待补齐"],
    verdict,
    reasons: reasons.length ? reasons.slice(0, 7) : ["已进入高波动初筛池，等待更多证据"],
    risks: risks.slice(0, 7),
    shortCrowding,
  };
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

function normalizeCrowd(value: unknown, shortRatio: number, trappedRatio: number): CrowdMood {
  const normalized = string(value).toLowerCase();
  if (/short|bear|喊空|做空/.test(normalized) || shortRatio >= 55) return "SHORT_CROWD";
  if (/trap|套牢|扛单|哭/.test(normalized) || trappedRatio >= 40) return "TRAPPED";
  if (/long|bull|追多/.test(normalized)) return "CHASE_LONG";
  if (normalized) return "MIXED";
  return "UNKNOWN";
}

function normalizeRow(item: unknown): RadarBase | null {
  const row = object(item);
  const market = object(row.market ?? row.snapshot ?? row.market_snapshot);
  const signal = object(row.signal ?? row.analysis ?? row.signals);
  const heat = object(row.heat ?? row.social ?? row.heat_data);
  const chip = object(row.chip ?? row.chips ?? row.holders ?? row.chip_analysis);
  const chain = object(row.chain ?? row.onchain ?? row.on_chain);
  const aster = object(row.aster ?? row.aster_data);
  const sources = [row, market, signal, heat];
  const rawSymbol = string(firstValue(sources, ["symbol", "token", "coin", "asset"])).toUpperCase();
  if (!rawSymbol) return null;
  const displayName = rawSymbol.replace(/[-_/]?USDT$/i, "");
  const symbol = rawSymbol.endsWith("USDT") ? rawSymbol.replace(/[-_/]/g, "") : `${rawSymbol.replace(/[-_/]/g, "")}USDT`;
  const fundingRate = percentFunding(number(firstValue(sources, ["funding_rate", "fundingRate", "funding"])));
  const shortCallRatio = number(firstValue([heat, row], ["short_call_ratio", "shortCallRatio", "bearish_ratio", "short_ratio"]));
  const trappedRatio = number(firstValue([heat, row], ["trapped_ratio", "trappedRatio", "loss_complaint_ratio", "holding_bag_ratio"]));
  const oi1hRaw = firstValue(sources, ["oi_change_1h", "oi1h", "open_interest_change_1h"]);
  const rawHolders = firstValue([row, chip], ["holders", "top_holders", "topHolders", "holder_list"]);
  const concentration = Array.isArray(rawHolders) ? calculateTop10Concentration(rawHolders.map((holder) => {
    const item = object(holder);
    return {
      address: string(firstValue([item], ["address", "holder", "wallet", "id"])),
      balance: number(firstValue([item], ["balance", "amount", "value", "quantity"])),
      label: string(firstValue([item], ["label", "name", "entity", "annotation"])),
      category: string(firstValue([item], ["category", "type", "entity_type"])),
    };
  })) : null;
  const top10Pct = concentration?.status === "live" ? concentration.top10Pct : nullableNumber(firstValue([chip, row], ["top10_excluding_exchanges_pct", "top10FilteredPct", "top10_filtered_pct"]));
  const chainAnomaly = nullableNumber(firstValue([chain, row], ["anomaly_score", "chainAnomaly", "risk_score"]));
  const asterOi1h = nullableNumber(firstValue([aster, row], ["oi_change_1h", "oi1h", "open_interest_change_1h"]));

  return {
    symbol, displayName,
    price: number(firstValue(sources, ["price", "last_price", "lastPrice", "mark_price"])),
    change15m: number(firstValue(sources, ["change_15m", "change15m", "price_change_15m", "pct_15m"])),
    change1h: number(firstValue(sources, ["change_1h", "change1h", "price_change_1h", "pct_1h"])),
    change4h: number(firstValue(sources, ["change_4h", "change4h", "price_change_4h", "pct_4h"])),
    change24h: number(firstValue(sources, ["change_24h", "change24h", "price_change_24h", "pct_24h"])),
    volume24h: number(firstValue(sources, ["volume_24h", "quote_volume_24h", "quoteVolume", "turnover_24h"])),
    heatScore: number(firstValue(sources, ["heat_score", "heatScore", "heat", "social_score", "score"])),
    heatChange: number(firstValue(sources, ["heat_change", "heatChange", "heat_acceleration", "growth_rate"])),
    mentionCount: number(firstValue(sources, ["mention_count", "mentions", "post_count", "posts_count"])),
    authorCount: number(firstValue(sources, ["author_count", "authors", "unique_authors", "creator_count"])),
    bullishRatio: number(firstValue([heat, row], ["bullish_ratio", "long_call_ratio", "bull_ratio"])),
    neutralRatio: number(firstValue([heat, row], ["neutral_ratio", "neutralRatio"])),
    relativeBtc4h: number(firstValue(sources, ["relative_btc_4h", "relativeBtc4h", "btc_relative_strength_4h"])),
    maxDrawdown24h: number(firstValue(sources, ["max_drawdown_24h", "maxDrawdown24h", "drawdown_24h"])),
    shortLiquidations1h: number(firstValue(sources, ["short_liquidations_1h", "shortLiquidations1h", "short_liq_1h"])),
    breakoutScore: number(firstValue(sources, ["breakout_score", "breakoutScore", "structure_score"])),
    crowdMood: normalizeCrowd(firstValue([heat, row], ["crowd_mood", "crowdMood", "sentiment_label"]), shortCallRatio, trappedRatio),
    shortCallRatio, trappedRatio,
    resilienceScore: number(firstValue(sources, ["resilience_score", "resilienceScore", "absorption_score"]), 50),
    oi15m: number(firstValue(sources, ["oi_change_15m", "oi15m", "open_interest_change_15m"])),
    oi1h: number(oi1hRaw),
    oi4h: number(firstValue(sources, ["oi_change_4h", "oi4h", "open_interest_change_4h"])),
    fundingRate,
    takerRatio: number(firstValue(sources, ["taker_ratio", "takerRatio", "buy_sell_ratio"]), 1),
    retailLsr: number(firstValue(sources, ["global_lsr", "retail_lsr", "long_short_ratio", "lsr"]), 1),
    asterOi1h,
    top10Pct,
    top1Pct: nullableNumber(firstValue([chip, row], ["top1_pct", "top1Pct", "top_holder_pct"])),
    cexPct: nullableNumber(firstValue([chip, row], ["cex_pct", "cexPct", "cex_pool_pct"])),
    quietWalletPct: nullableNumber(firstValue([chip, row], ["quiet_wallet_pct", "quietWalletPct", "quiet_pct"])),
    chipStage: string(firstValue([chip, row], ["stage", "chip_stage", "chipStage", "lifecycle"]), top10Pct === null ? "待接入" : "横盘整理"),
    chainAnomaly,
    chainSignal: string(firstValue([chain, row], ["signal", "chain_signal", "chainSignal", "flow_label"]), chainAnomaly === null ? "待接入" : "中性"),
    coverage: {
      square: "live",
      binanceOi: oi1hRaw === undefined ? "pending" : "live",
      aster: asterOi1h === null ? "pending" : "live",
    chips: top10Pct === null ? "pending" : "live",
      chain: chainAnomaly === null ? "pending" : "live",
    },
  };
}

async function fetchJson(url: string, timeout = 6_000): Promise<unknown> {
  const endpoint = new URL(url);
  if (endpoint.origin === BINANCE_FUTURES) {
    return (await binancePublicJson(`${endpoint.pathname}${endpoint.search}`, { signal: AbortSignal.timeout(timeout) })).data;
  }
  const response = await fetch(url, {
    headers: { accept: "application/json", "user-agent": "streetlight-radar/0.2" },
    signal: AbortSignal.timeout(timeout),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`upstream_${response.status}`);
  return response.json();
}

function percentChange(values: number[], periodsBack: number) {
  if (values.length <= periodsBack) return 0;
  const current = values.at(-1) ?? 0;
  const previous = values.at(-(periodsBack + 1)) ?? 0;
  return previous ? ((current - previous) / previous) * 100 : 0;
}

async function fetchLiveMarketCoin(ticker: PlainObject, fundingMap: Map<string, number>): Promise<RadarBase> {
  const symbol = string(ticker.symbol).toUpperCase();
  const [klinesPayload, oiPayload, takerPayload, lsrPayload] = await Promise.allSettled([
    fetchJson(`${BINANCE_FUTURES}/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=5m&limit=49`),
    fetchJson(`${BINANCE_FUTURES_DATA}/openInterestHist?symbol=${encodeURIComponent(symbol)}&period=5m&limit=49`),
    fetchJson(`${BINANCE_FUTURES_DATA}/takerlongshortRatio?symbol=${encodeURIComponent(symbol)}&period=5m&limit=13`),
    fetchJson(`${BINANCE_FUTURES_DATA}/globalLongShortAccountRatio?symbol=${encodeURIComponent(symbol)}&period=5m&limit=2`),
  ]);

  const klines = klinesPayload.status === "fulfilled" && Array.isArray(klinesPayload.value) ? klinesPayload.value : [];
  const closeValues = klines.map((row) => Array.isArray(row) ? number(row[4]) : 0).filter((value) => value > 0);
  const oiRows = oiPayload.status === "fulfilled" && Array.isArray(oiPayload.value) ? oiPayload.value : [];
  const oiValues = oiRows.map((row) => number(object(row).sumOpenInterestValue)).filter((value) => value > 0);
  const takerRows = takerPayload.status === "fulfilled" && Array.isArray(takerPayload.value) ? takerPayload.value : [];
  const lsrRows = lsrPayload.status === "fulfilled" && Array.isArray(lsrPayload.value) ? lsrPayload.value : [];
  const change15m = percentChange(closeValues, 3);
  const change1h = percentChange(closeValues, 12);
  const change4h = percentChange(closeValues, 48);
  const oi1h = percentChange(oiValues, 12);
  const oi15m = percentChange(oiValues, 3);
  const oi4h = percentChange(oiValues, 48);
  const takerRatio = number(object(takerRows.at(-1)).buySellRatio, 1);
  const retailLsr = number(object(lsrRows.at(-1)).longShortRatio, 1);
  const resilienceScore = Math.round(clamp(50 + change1h * 5 + oi1h * 1.5 - Math.max(0, 1 - takerRatio) * 20, 0, 100));

  return {
    symbol,
    displayName: symbol.replace(/USDT$/, ""),
    price: number(ticker.lastPrice),
    change15m, change1h, change4h,
    change24h: number(ticker.priceChangePercent),
    volume24h: number(ticker.quoteVolume),
    heatScore: 0, heatChange: 0, mentionCount: 0,
    crowdMood: "UNKNOWN", shortCallRatio: 0, trappedRatio: 0, resilienceScore,
    oi15m, oi1h, oi4h,
    fundingRate: percentFunding(fundingMap.get(symbol) ?? 0),
    takerRatio, retailLsr,
    asterOi1h: null,
    top10Pct: null, top1Pct: null, cexPct: null, quietWalletPct: null, chipStage: "待接入",
    chainAnomaly: null, chainSignal: "待接入",
    coverage: {
      square: "pending",
      binanceOi: oiValues.length > 12 ? "live" : "partial",
      aster: "pending", chips: "pending", chain: "pending",
    },
  };
}

async function enrichReferenceSources(bases: RadarBase[]) {
  for (const base of bases) {
    try {
      const observation = await fetchAsterOi(base.symbol, { previous: asterSnapshots.get(base.symbol) ?? null, timeoutMs: 2_500 });
      asterSnapshots.set(base.symbol, { symbol: base.symbol, openInterest: observation.openInterest, capturedAt: new Date().toISOString() });
      if (observation.changePct !== null) { base.asterOi1h = observation.changePct; base.coverage.aster = "live"; }
    } catch {
      // Aster is an optional reference source; never block market rendering.
    }
  }
  let tokenMap: Record<string, { chain?: string; address?: string }> = {};
  try { tokenMap = JSON.parse(process.env.ONCHAIN_TOKEN_MAP_JSON ?? "{}"); } catch { tokenMap = {}; }
  for (const base of bases) {
    const token = tokenMap[base.symbol] ?? tokenMap[base.displayName];
    if (!token?.address) continue;
    try {
      const concentration = await fetchOnchainTop10(token.chain ?? "ethereum", token.address);
      if (concentration.status === "live") { base.top10Pct = concentration.top10Pct; base.coverage.chips = "live"; }
    } catch {
      // Missing provider credentials or a throttled provider remains explicitly pending.
    }
  }
}

async function buildLiveMarketFallback(): Promise<RadarCoin[]> {
  const [exchangePayload, tickersPayload, premiumPayload] = await Promise.all([
    fetchJson(`${BINANCE_FUTURES}/fapi/v1/exchangeInfo`),
    fetchJson(`${BINANCE_FUTURES}/fapi/v1/ticker/24hr`),
    fetchJson(`${BINANCE_FUTURES}/fapi/v1/premiumIndex`),
  ]);
  const exchangeRows = extractRows(object(exchangePayload).symbols);
  const tradable = new Set(
    exchangeRows
      .map(object)
      .filter((row) => row.status === "TRADING" && row.contractType === "PERPETUAL" && row.quoteAsset === "USDT")
      .map((row) => string(row.symbol)),
  );
  const fundingMap = new Map(
    (Array.isArray(premiumPayload) ? premiumPayload : []).map((row) => {
      const entry = object(row);
      return [string(entry.symbol), number(entry.lastFundingRate)] as [string, number];
    }),
  );
  const candidates = (Array.isArray(tickersPayload) ? tickersPayload : [])
    .map(object)
    .filter((ticker) => tradable.has(string(ticker.symbol)) && number(ticker.quoteVolume) >= 20_000_000)
    .sort((a, b) => {
      const aRank = Math.abs(number(a.priceChangePercent)) * Math.log10(Math.max(10, number(a.quoteVolume)));
      const bRank = Math.abs(number(b.priceChangePercent)) * Math.log10(Math.max(10, number(b.quoteVolume)));
      return bRank - aRank;
    })
    .slice(0, 8);
  const bases = await Promise.all(candidates.map((ticker) => fetchLiveMarketCoin(ticker, fundingMap)));
  await enrichReferenceSources(bases);
  return bases.map(analyze).sort((a, b) => b.score - a.score);
}

let radarTvScreenerCache: { key: string; value: TvScreenerResearch; cachedAt: number } | null = null;
let radarTvScreenerRefresh: Promise<void> | null = null;

function startRadarTvScreenerRefresh(symbols: string[]) {
  const uniqueSymbols = [...new Set(symbols)].sort();
  const key = uniqueSymbols.join(",");
  const cacheIsFresh = radarTvScreenerCache?.key === key && Date.now() - radarTvScreenerCache.cachedAt <= 30_000;
  if (!key || radarTvScreenerRefresh || cacheIsFresh) return;
  radarTvScreenerRefresh = loadTvScreenerResearch(uniqueSymbols)
    .then((value) => {
      if (value.coverage !== "unavailable" || !radarTvScreenerCache) {
        radarTvScreenerCache = { key, value, cachedAt: Date.now() };
      }
    })
    .catch(() => undefined)
    .finally(() => { radarTvScreenerRefresh = null; });
}

function radarTvScreenerValue(symbols: string[]): TvScreenerResearch {
  startRadarTvScreenerRefresh(symbols);
  const key = [...new Set(symbols)].sort().join(",");
  if (!radarTvScreenerCache || radarTvScreenerCache.key !== key) return unavailableTvScreenerResearch();
  const age = Date.now() - radarTvScreenerCache.cachedAt;
  const canMarkStale = radarTvScreenerCache.value.coverage === "live" || radarTvScreenerCache.value.coverage === "partial";
  if (age > 30_000 && canMarkStale) {
    return { ...radarTvScreenerCache.value, coverage: "stale" };
  }
  return radarTvScreenerCache.value;
}

function withTvScreener<T extends { coins: RadarCoin[] }>(payload: T) {
  return { ...payload, tvScreener: radarTvScreenerValue(payload.coins.map((coin) => coin.symbol)) };
}

export async function GET() {
  const baseUrl = process.env.SQUARE_MONITOR_BASE_URL?.replace(/\/$/, "");

  if (baseUrl) {
    try {
      const payload = await fetchJson(`${baseUrl}/api/leaderboard`, 7_000);
      const bases = extractRows(payload)
        .map(normalizeRow)
        .filter((coin): coin is RadarBase => Boolean(coin));
      await enrichReferenceSources(bases);
      const coins = bases
        .map(analyze)
        .sort((a, b) => b.score - a.score);
      if (coins.length) {
        const hotCoins = [...coins].sort((a, b) => (b.mentionCount + b.heatChange) - (a.mentionCount + a.heatChange)).slice(0, 10);
        const resilientCoins = coins.filter((item) => item.shortCallRatio >= 65 && (item.change4h >= 0 || (item.relativeBtc4h ?? 0) > 0)).sort((a, b) => (b.shortCrowding?.score ?? 0) - (a.shortCrowding?.score ?? 0));
        const shortCrowding = coins.filter((item) => ["CANDIDATE", "HIGH_CONFIDENCE", "SQUEEZE_TRIGGER"].includes(item.shortCrowding?.level ?? "")).sort((a, b) => (b.shortCrowding?.score ?? 0) - (a.shortCrowding?.score ?? 0));
        return Response.json(withTvScreener({
          mode: "live",
          updatedAt: new Date().toISOString(),
          sourceStatus: `币安广场监控已连接 · ${coins.length} 个有效币种 · 缺失字段不参与评分`,
          coins, hotCoins, resilientCoins, shortCrowding,
        }), { headers: { "cache-control": "public, max-age=20, s-maxage=45" } });
      }
    } catch {
      // Continue with Binance public market data. The response labels missing sources explicitly.
    }
  }

  try {
    const coins = await buildLiveMarketFallback();
    if (coins.length) {
      return Response.json(withTvScreener({
        mode: "hybrid",
        updatedAt: new Date().toISOString(),
        sourceStatus: `Binance Futures实时行情 · ${coins.length} 个高波动合约 · Aster OI与链上Top10按可用快照显示`,
        coins,
      }), { headers: { "cache-control": "public, max-age=20, s-maxage=45" } });
    }
  } catch {
    // A fully labeled demo keeps the product usable when the public endpoint is regionally unavailable.
  }

  return Response.json(withTvScreener({
    mode: "demo",
    updatedAt: new Date().toISOString(),
    sourceStatus: baseUrl ? "外部采集暂不可用 · 已切换演示样本" : "尚未连接广场采集服务 · 当前为演示样本",
    coins: demoCoins.map(analyze).sort((a, b) => b.score - a.score),
    hotCoins: demoCoins.map(analyze).sort((a, b) => b.mentionCount - a.mentionCount).slice(0, 10),
    resilientCoins: demoCoins.map(analyze).filter((item) => item.shortCallRatio >= 65),
    shortCrowding: demoCoins.map(analyze).filter((item) => ["CANDIDATE", "HIGH_CONFIDENCE", "SQUEEZE_TRIGGER"].includes(item.shortCrowding?.level ?? "")),
  }), { headers: { "cache-control": "no-store" } });
}
