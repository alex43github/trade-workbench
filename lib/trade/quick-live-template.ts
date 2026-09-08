import { normalizeBinanceFuturesSymbol } from "./symbols.ts";

export const QUICK_LIVE_TEMPLATE_IDS = [
  "BALANCED_LONG_1H",
  "BALANCED_SHORT_1H",
  "BULL_CHASE_1H",
  "BEAR_CHASE_1H",
  "RANGE_LONG_1H",
  "RANGE_SHORT_1H",
] as const;

export const QUICK_LIVE_MARKET_TEMPLATE_IDS = [
  "MARKET_BALANCED_LONG_1H",
  "MARKET_BALANCED_SHORT_1H",
] as const;

export const QUICK_LIVE_ALL_TEMPLATE_IDS = [...QUICK_LIVE_TEMPLATE_IDS, ...QUICK_LIVE_MARKET_TEMPLATE_IDS] as const;

export type QuickLiveTemplateId = typeof QUICK_LIVE_ALL_TEMPLATE_IDS[number];
export type QuickLiveExitRule = "BALANCED_MA_1H" | "BULL_CHASE_1H" | "BEAR_CHASE_1H" | "RANGE_SHORT_1H" | "RANGE_LONG_1H";
export type QuickLiveEntryMode = "LIMIT" | "MARKET";

export type QuickLiveExitStop = {
  kind: "CLOSE_BELOW" | "CLOSE_ABOVE";
  offset: number;
  price: number;
  firstExitPct?: 50;
  triggerCount?: 2;
};

export type QuickLiveExitTarget =
  | { kind: "DEFAULT_PROFIT_TARGETS" }
  | { kind: "TOUCH_ABOVE" | "TOUCH_BELOW"; offset: number; price: number; remainingPct: 0 | 50 };

export type QuickLiveExitLevels = {
  stop: QuickLiveExitStop;
  takeProfit: QuickLiveExitTarget[];
};

export type QuickLiveTemplateSnapshot = {
  templateId: QuickLiveTemplateId;
  exitRule: QuickLiveExitRule;
  candleId: string;
  timeframe: "1h";
  maKind: "SMA";
  maLength: 30;
  atrLength: 14;
  totalEquityUsdt: number;
  totalMarginUsdt: number;
  ma: number;
  atr: number;
  entryOffsets: number[];
  entryPrices: number[];
  exitLevels: QuickLiveExitLevels;
};

export type QuickLiveTemplateRequest = {
  symbol: string;
  templateId: QuickLiveTemplateId;
  totalMarginUsdt?: number;
};

export type QuickLiveExpandedDraft = {
  symbol: string;
  side: "LONG" | "SHORT";
  style: "MA";
  mode: "LIVE_ARMED";
  timeframe: "1h";
  totalMarginUsdt: number;
  ma: { kind: "SMA"; length: 30 };
  atr: { length: 14 };
  legs: Array<{ atrOffset: number; marginUsdt: number }>;
  execution: "LIMIT_POST_ONLY";
  refreshOn: "CLOSED_CANDLE";
  expiryDays: 7;
  dynamicGuard: false | {
    kind: "DYNAMIC_MA";
    direction: "BELOW" | "ABOVE";
    confirmationCandles: 2;
    firstTargetRemainingPct: 50;
    finalTargetRemainingPct: 0;
    atrMultiplier: 1;
  };
  quickTemplateId: QuickLiveTemplateId;
  quickExitRule: QuickLiveExitRule;
  quickEntryMode: QuickLiveEntryMode;
  quickTemplateSnapshot: QuickLiveTemplateSnapshot;
};

type RecordValue = Record<string, unknown>;
type QuickLiveMarketSnapshot = {
  symbol: string;
  closedCandle: {
    id?: unknown;
    timeframe?: unknown;
    maKind?: unknown;
    maLength?: unknown;
    atrLength?: unknown;
    ma?: unknown;
    atr?: unknown;
  };
};

const TEMPLATE_SPECS: Record<QuickLiveTemplateId, {
  side: "LONG" | "SHORT";
  offsets: readonly number[];
  entryMode: QuickLiveEntryMode;
  exitRule: QuickLiveExitRule;
  stopKind: "CLOSE_BELOW" | "CLOSE_ABOVE";
  stopOffset: number;
  takeProfit: "DEFAULT" | readonly { kind: "TOUCH_ABOVE" | "TOUCH_BELOW"; offset: number; remainingPct: 0 | 50 }[];
}> = {
  BALANCED_LONG_1H: {
    side: "LONG", offsets: [1, 0.5, 0, -0.5, -1], entryMode: "LIMIT", exitRule: "BALANCED_MA_1H",
    stopKind: "CLOSE_BELOW", stopOffset: -1, takeProfit: "DEFAULT",
  },
  BALANCED_SHORT_1H: {
    side: "SHORT", offsets: [1, 0.5, 0, -0.5, -1], entryMode: "LIMIT", exitRule: "BALANCED_MA_1H",
    stopKind: "CLOSE_ABOVE", stopOffset: 1, takeProfit: "DEFAULT",
  },
  BULL_CHASE_1H: {
    side: "LONG", offsets: [2.7, 2.85, 3, 3.15, 3.3], entryMode: "LIMIT", exitRule: "BULL_CHASE_1H",
    stopKind: "CLOSE_BELOW", stopOffset: 2.5,
    takeProfit: [
      { kind: "TOUCH_ABOVE", offset: 5, remainingPct: 50 },
      { kind: "TOUCH_ABOVE", offset: 7, remainingPct: 0 },
    ],
  },
  BEAR_CHASE_1H: {
    side: "SHORT", offsets: [-3.3, -3.15, -3, -2.85, -2.7], entryMode: "LIMIT", exitRule: "BEAR_CHASE_1H",
    stopKind: "CLOSE_ABOVE", stopOffset: -2.5,
    takeProfit: [
      { kind: "TOUCH_BELOW", offset: -5, remainingPct: 50 },
      { kind: "TOUCH_BELOW", offset: -7, remainingPct: 0 },
    ],
  },
  RANGE_LONG_1H: {
    side: "LONG", offsets: [-5, -4.75, -4.5, -4.25, -4], entryMode: "LIMIT", exitRule: "RANGE_LONG_1H",
    stopKind: "CLOSE_BELOW", stopOffset: -5,
    takeProfit: [{ kind: "TOUCH_ABOVE", offset: 4, remainingPct: 0 }],
  },
  RANGE_SHORT_1H: {
    side: "SHORT", offsets: [4, 4.25, 4.5, 4.75, 5], entryMode: "LIMIT", exitRule: "RANGE_SHORT_1H",
    stopKind: "CLOSE_ABOVE", stopOffset: 5,
    takeProfit: [{ kind: "TOUCH_BELOW", offset: -4, remainingPct: 0 }],
  },
  MARKET_BALANCED_LONG_1H: {
    side: "LONG", offsets: [0], entryMode: "MARKET", exitRule: "BALANCED_MA_1H",
    stopKind: "CLOSE_BELOW", stopOffset: -1, takeProfit: [],
  },
  MARKET_BALANCED_SHORT_1H: {
    side: "SHORT", offsets: [0], entryMode: "MARKET", exitRule: "BALANCED_MA_1H",
    stopKind: "CLOSE_ABOVE", stopOffset: 1, takeProfit: [],
  },
};

function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as RecordValue : {};
}

function finitePositive(value: unknown, message: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(message);
  return number;
}

function finiteNumber(value: unknown, message: string) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(message);
  return number;
}

function templateId(value: unknown): QuickLiveTemplateId {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!QUICK_LIVE_ALL_TEMPLATE_IDS.includes(normalized as QuickLiveTemplateId)) throw new Error("快捷模板标识不正确");
  return normalized as QuickLiveTemplateId;
}

export function isQuickLiveMarketTemplate(value: unknown): value is typeof QUICK_LIVE_MARKET_TEMPLATE_IDS[number] {
  return QUICK_LIVE_MARKET_TEMPLATE_IDS.includes(String(value ?? "").trim().toUpperCase() as typeof QUICK_LIVE_MARKET_TEMPLATE_IDS[number]);
}

export function isQuickLiveTemplateDraft(input: unknown): boolean {
  const source = record(input);
  return Object.hasOwn(source, "quickTemplateId") || Object.hasOwn(source, "templateId");
}

export function normalizeQuickLiveTemplateRequest(input: unknown): QuickLiveTemplateRequest {
  const source = record(input);
  const rawQuickId = source.quickTemplateId;
  const rawTemplateId = source.templateId;
  if (rawQuickId === undefined && rawTemplateId === undefined) throw new Error("快捷模板标识不能为空");
  const quickId = rawQuickId === undefined ? undefined : templateId(rawQuickId);
  const legacyId = rawTemplateId === undefined ? undefined : templateId(rawTemplateId);
  if (quickId && legacyId && quickId !== legacyId) throw new Error("快捷模板标识不一致");
  const totalMarginUsdt = source.totalMarginUsdt === undefined
    ? undefined
    : finitePositive(source.totalMarginUsdt, "快捷策略总保证金必须大于0");
  return {
    symbol: normalizeBinanceFuturesSymbol(source.symbol, "快捷策略币种格式不正确"),
    templateId: quickId ?? legacyId!,
    ...(totalMarginUsdt === undefined ? {} : { totalMarginUsdt }),
  };
}

export function quickLiveTemplateMarketDraft(request: QuickLiveTemplateRequest): RecordValue {
  const normalized = normalizeQuickLiveTemplateRequest(request);
  const totalMarginUsdt = normalized.totalMarginUsdt ?? 1;
  return {
    symbol: normalized.symbol,
    side: TEMPLATE_SPECS[normalized.templateId].side,
    style: "MA",
    mode: "LIVE_ARMED",
    timeframe: "1h",
    totalMarginUsdt,
    ma: { kind: "SMA", length: 30 },
    atr: { length: 14 },
    legs: TEMPLATE_SPECS[normalized.templateId].entryMode === "MARKET"
      ? [{ atrOffset: 0, marginUsdt: totalMarginUsdt }]
      : Array.from({ length: 5 }, () => ({ atrOffset: 0, marginUsdt: totalMarginUsdt / 5 })),
    execution: "LIMIT_POST_ONLY",
    refreshOn: "CLOSED_CANDLE",
    expiryDays: 7,
  };
}

function validateMarket(request: QuickLiveTemplateRequest, market: QuickLiveMarketSnapshot) {
  if (!market || typeof market !== "object") throw new Error("快捷模板行情快照无效");
  const marketSymbol = normalizeBinanceFuturesSymbol(market.symbol, "快捷模板行情币种无效");
  if (marketSymbol !== request.symbol) throw new Error("快捷模板行情币种与请求不一致");
  const candle = market.closedCandle;
  if (!candle || typeof candle !== "object") throw new Error("快捷模板缺少已收盘 1h K 线");
  if (candle.timeframe !== "1h") throw new Error("快捷模板只允许使用已收盘 1h K 线");
  if (candle.maKind !== "SMA" || Number(candle.maLength) !== 30 || Number(candle.atrLength) !== 14) {
    throw new Error("快捷模板指标必须固定为 1h SMA30 和 ATR14");
  }
  const candleId = String(candle.id ?? "").trim();
  if (!candleId) throw new Error("快捷模板缺少已收盘 K 线编号");
  return {
    candleId,
    ma: finitePositive(candle.ma, "快捷模板均线快照无效"),
    atr: finitePositive(candle.atr, "快捷模板 ATR 快照无效"),
  };
}

export function expandQuickLiveTemplate(
  input: unknown,
  snapshot: { totalEquityUsdt: unknown; market: QuickLiveMarketSnapshot },
): QuickLiveExpandedDraft {
  const request = normalizeQuickLiveTemplateRequest(input);
  const equity = finitePositive(snapshot?.totalEquityUsdt, "账户总权益快照无效");
  const { candleId, ma, atr } = validateMarket(request, snapshot?.market);
  const spec = TEMPLATE_SPECS[request.templateId];
  const totalMarginUsdt = request.totalMarginUsdt ?? equity * 0.05;
  const marginUsdt = totalMarginUsdt / (spec.entryMode === "MARKET" ? 1 : 5);
  const entryPrices = spec.offsets.map((offset) => ma + offset * atr);
  const stopPrice = ma + spec.stopOffset * atr;
  if (![totalMarginUsdt, marginUsdt, stopPrice, ...entryPrices].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error("快捷模板计算出的价格或保证金无效");
  }
  const takeProfit = spec.takeProfit === "DEFAULT"
    ? [{ kind: "DEFAULT_PROFIT_TARGETS" as const }]
    : spec.takeProfit.map((target) => ({ ...target, price: ma + target.offset * atr }));
  if (!takeProfit.every((target) => target.kind === "DEFAULT_PROFIT_TARGETS" || Number.isFinite(target.price) && target.price > 0)) {
    throw new Error("快捷模板止盈价格无效");
  }
  const exitLevels: QuickLiveExitLevels = {
    stop: {
      kind: spec.stopKind,
      offset: spec.stopOffset,
      price: stopPrice,
      ...(spec.exitRule === "BALANCED_MA_1H" ? { firstExitPct: 50 as const, triggerCount: 2 as const } : {}),
    },
    takeProfit,
  };
  const quickTemplateSnapshot: QuickLiveTemplateSnapshot = {
    templateId: request.templateId,
    exitRule: spec.exitRule,
    candleId,
    timeframe: "1h",
    maKind: "SMA",
    maLength: 30,
    atrLength: 14,
    totalEquityUsdt: equity,
    totalMarginUsdt,
    ma,
    atr,
    entryOffsets: [...spec.offsets],
    entryPrices,
    exitLevels,
  };
  return {
    symbol: request.symbol,
    side: spec.side,
    style: "MA",
    mode: "LIVE_ARMED",
    timeframe: "1h",
    totalMarginUsdt,
    ma: { kind: "SMA", length: 30 },
    atr: { length: 14 },
    legs: spec.offsets.map((atrOffset) => ({ atrOffset, marginUsdt })),
    execution: "LIMIT_POST_ONLY",
    refreshOn: "CLOSED_CANDLE",
    expiryDays: 7,
    dynamicGuard: spec.exitRule === "BALANCED_MA_1H"
      ? {
        kind: "DYNAMIC_MA",
        direction: spec.side === "LONG" ? "BELOW" : "ABOVE",
        confirmationCandles: 2,
        firstTargetRemainingPct: 50,
        finalTargetRemainingPct: 0,
        atrMultiplier: 1,
      }
      : false,
    quickTemplateId: request.templateId,
    quickExitRule: spec.exitRule,
    quickEntryMode: spec.entryMode,
    quickTemplateSnapshot,
  };
}

/** Rebuild a server-owned quick-template channel from a newer closed 1h candle. */
export function refreshQuickLiveTemplateSnapshot(
  snapshotValue: QuickLiveTemplateSnapshot | unknown,
  market: QuickLiveMarketSnapshot,
): QuickLiveTemplateSnapshot {
  const snapshot = normalizeQuickLiveTemplateSnapshot(snapshotValue);
  return expandQuickLiveTemplate({
    symbol: market.symbol,
    quickTemplateId: snapshot.templateId,
    totalMarginUsdt: snapshot.totalMarginUsdt,
  }, {
    totalEquityUsdt: snapshot.totalEquityUsdt,
    market,
  }).quickTemplateSnapshot;
}

export function normalizeQuickLiveTemplateSnapshot(value: unknown): QuickLiveTemplateSnapshot {
  const source = record(value);
  const id = templateId(source.templateId);
  const exitRule = String(source.exitRule ?? "").trim().toUpperCase() as QuickLiveExitRule;
  if (!["BALANCED_MA_1H", "BULL_CHASE_1H", "BEAR_CHASE_1H", "RANGE_SHORT_1H", "RANGE_LONG_1H"].includes(exitRule)) {
    throw new Error("快捷模板退出规则不正确");
  }
  if (TEMPLATE_SPECS[id].exitRule !== exitRule) throw new Error("快捷模板退出规则与模板不一致");
  const timeframe = String(source.timeframe ?? "");
  if (timeframe !== "1h" || source.maKind !== "SMA" || Number(source.maLength) !== 30 || Number(source.atrLength) !== 14) {
    throw new Error("快捷模板快照指标不正确");
  }
  const entryOffsets = Array.isArray(source.entryOffsets) ? source.entryOffsets.map((offset) => finiteNumber(offset, "快捷模板入场偏移无效")) : [];
  const entryPrices = Array.isArray(source.entryPrices) ? source.entryPrices.map((price) => finitePositive(price, "快捷模板入场价格无效")) : [];
  const expectedEntryCount = isQuickLiveMarketTemplate(id) ? 1 : 5;
  if (entryOffsets.length !== expectedEntryCount || entryPrices.length !== expectedEntryCount) {
    throw new Error(`快捷模板快照必须包含${expectedEntryCount === 1 ? "一笔" : "五笔"}入场腿`);
  }
  const snapshot: QuickLiveTemplateSnapshot = {
    templateId: id,
    exitRule,
    candleId: String(source.candleId ?? ""),
    timeframe: "1h",
    maKind: "SMA",
    maLength: 30,
    atrLength: 14,
    totalEquityUsdt: finitePositive(source.totalEquityUsdt, "快捷模板权益快照无效"),
    totalMarginUsdt: finitePositive(source.totalMarginUsdt, "快捷模板保证金快照无效"),
    ma: finitePositive(source.ma, "快捷模板均线快照无效"),
    atr: finitePositive(source.atr, "快捷模板 ATR 快照无效"),
    entryOffsets,
    entryPrices,
    exitLevels: source.exitLevels as QuickLiveExitLevels,
  };
  if (!snapshot.candleId) throw new Error("快捷模板快照缺少 K 线编号");
  return snapshot;
}

export function quickLiveTemplateSpec(template: QuickLiveTemplateId) {
  return TEMPLATE_SPECS[templateId(template)];
}
