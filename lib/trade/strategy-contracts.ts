import { isBinanceFuturesSymbol } from "./symbols.ts";

export const STRATEGY_TIMEFRAMES = [
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
] as const;
export type StrategyTimeframe = typeof STRATEGY_TIMEFRAMES[number];
export type StrategySide = "LONG" | "SHORT";
export type StrategyStyle = "MA" | "HORIZONTAL";
export type MovingAverageKind = "SMA" | "EMA";
export type StrategyExecution = "LIMIT_POST_ONLY";
export type StrategyRefresh = "CLOSED_CANDLE";
export type EntryRefresh = "CLOSED_CANDLE" | "NONE";
export type GuardDirection = "BELOW" | "ABOVE";

export type ProfitTarget = {
  grossProfitMultiple: 1 | 2;
  initialQuantityPct: 25 | 40;
};

export type EntryLegConfig = {
  atrOffset: number;
  marginUsdt: number;
  staticLimitPrice?: number;
};

export type HorizontalEntryConfig = {
  price: number;
};

export type GuardConfig = {
  kind: "DYNAMIC_MA" | "HORIZONTAL";
  direction: GuardDirection;
  confirmationCandles: 1 | 2;
  firstTargetRemainingPct: 0 | 50;
  finalTargetRemainingPct: 0;
  atrMultiplier?: number;
  price?: number;
};

export type ProfitLot = {
  id: string;
  strategyId: string;
  legId: string;
  websiteOrderId: string;
  entryPrice: number;
  initialQuantity: number;
  initialNotional: number;
  exitedQuantity: number;
  realizedGrossPnl: number;
  completedProfitTargets: Array<1 | 2>;
};

export type StrategyDraft = {
  symbol?: string;
  side?: StrategySide | string;
  timeframe?: StrategyTimeframe | string;
  style?: StrategyStyle | string;
  mode?: "PAPER" | string;
  totalMarginUsdt?: number | string;
  ma?: { kind?: MovingAverageKind | string; length?: number | string };
  atr?: { length?: number | string };
  legs?: Array<{ atrOffset?: number; marginUsdt?: number | string }>;
  horizontalEntry?: { price?: number | string };
  execution?: StrategyExecution | string;
  refreshOn?: StrategyRefresh | string;
  expiryDays?: number | string;
  dynamicGuard?: false | Partial<GuardConfig>;
  horizontalGuard?: false | Partial<GuardConfig>;
};

export type StrategyConfig = {
  symbol: string;
  side: StrategySide;
  style: StrategyStyle;
  mode: "PAPER";
  timeframe: StrategyTimeframe;
  totalMarginUsdt: number;
  ma: { kind: MovingAverageKind; length: number };
  atr: { length: number };
  legs: EntryLegConfig[];
  horizontalEntry: HorizontalEntryConfig | null;
  execution: StrategyExecution;
  refreshOn: StrategyRefresh;
  entryRefresh: EntryRefresh;
  expiryDays: 7;
  profitTargets: ProfitTarget[];
  dynamicGuard: GuardConfig | null;
  horizontalGuard: GuardConfig | null;
};

export const DEFAULT_PROFIT_TARGETS: ProfitTarget[] = [
  { grossProfitMultiple: 1, initialQuantityPct: 25 },
  { grossProfitMultiple: 2, initialQuantityPct: 40 },
];

const TIMEFRAMES: StrategyTimeframe[] = [...STRATEGY_TIMEFRAMES];
const DEFAULT_LEG_OFFSETS = [1, 0, -1];
const STRATEGY_EXPIRY_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

function object(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function positiveNumber(value: unknown, message: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(message);
  return parsed;
}

function positiveInteger(value: unknown, message: string): number {
  const parsed = positiveNumber(value, message);
  if (!Number.isInteger(parsed)) throw new Error(message);
  return parsed;
}

function finiteNumber(value: unknown, message: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new Error(message);
  return parsed;
}

function isPersistedCanonicalConfig(source: Record<string, unknown>): boolean {
  return source.mode === "PAPER"
    && source.execution === "LIMIT_POST_ONLY"
    && source.refreshOn === "CLOSED_CANDLE"
    && source.expiryDays === STRATEGY_EXPIRY_DAYS
    && (source.entryRefresh === "CLOSED_CANDLE" || source.entryRefresh === "NONE")
    && Array.isArray(source.profitTargets);
}

function normalizeGuard(
  value: unknown,
  kind: GuardConfig["kind"],
  side: StrategySide,
  allowPersistedNull = false,
): GuardConfig | null {
  if (value === false || (allowPersistedNull && value === null)) return null;
  if (value !== undefined && !isPlainObject(value)) {
    throw new Error(kind === "DYNAMIC_MA" ? "动态均线守卫配置不正确" : "横向守卫配置不正确");
  }
  const source = object(value);
  const expectedDirection: GuardDirection = side === "LONG" ? "BELOW" : "ABOVE";
  const direction = String(source.direction || expectedDirection).toUpperCase();
  if (direction !== expectedDirection) throw new Error("失效守卫方向不正确");

  const suppliedConfirmationCandles = source.confirmationCandles === undefined
    ? undefined
    : positiveInteger(source.confirmationCandles, "失效守卫确认根数不正确");
  if (kind === "DYNAMIC_MA" && suppliedConfirmationCandles !== undefined && suppliedConfirmationCandles !== 2) {
    throw new Error("动态均线守卫确认根数固定为2");
  }
  const confirmationCandles = kind === "DYNAMIC_MA" ? 2 : suppliedConfirmationCandles ?? 2;
  if (confirmationCandles !== 1 && confirmationCandles !== 2) throw new Error("失效守卫确认根数不正确");

  const expectedFirstTargetRemainingPct = confirmationCandles === 1 ? 0 : 50;
  const firstTargetRemainingPct = source.firstTargetRemainingPct === undefined
    ? expectedFirstTargetRemainingPct
    : finiteNumber(source.firstTargetRemainingPct, "失效守卫减仓比例不正确");
  if (firstTargetRemainingPct !== expectedFirstTargetRemainingPct) throw new Error("失效守卫减仓比例不正确");

  if (kind === "DYNAMIC_MA") {
    return {
      kind,
      direction: expectedDirection,
      confirmationCandles: confirmationCandles as 1 | 2,
      firstTargetRemainingPct: firstTargetRemainingPct as 0 | 50,
      finalTargetRemainingPct: 0,
      atrMultiplier: positiveNumber(source.atrMultiplier ?? 1, "ATR 倍数必须大于0"),
    };
  }

  return {
    kind,
    direction: expectedDirection,
    confirmationCandles: confirmationCandles as 1 | 2,
    firstTargetRemainingPct: firstTargetRemainingPct as 0 | 50,
    finalTargetRemainingPct: 0,
    price: positiveNumber(source.price, "横向关键位价格必须大于0"),
  };
}

function normalizeLegs(value: unknown, totalMarginUsdt: number, defaultOffsets = DEFAULT_LEG_OFFSETS): EntryLegConfig[] {
  const sourceLegs: Array<Record<string, unknown>> = value === undefined
    ? defaultOffsets.map((atrOffset) => ({ atrOffset }))
    : (() => {
      if (!Array.isArray(value) || value.length === 0) throw new Error("入场腿必须是非空对象数组");
      return value.map((leg) => {
        if (!isPlainObject(leg)) throw new Error("入场腿必须是对象");
        if (!Object.hasOwn(leg, "atrOffset") || typeof leg.atrOffset !== "number" || !Number.isFinite(leg.atrOffset)) {
          throw new Error("ATR 偏移量不正确");
        }
        return leg;
      });
    })();
  const hasExplicitMargins = sourceLegs.some((leg) => leg.marginUsdt !== undefined);

  const margins = hasExplicitMargins
    ? sourceLegs.map((leg) => positiveNumber(leg.marginUsdt, "每条入场腿金额必须大于0"))
    : sourceLegs.map((_, index) => index === sourceLegs.length - 1
      ? totalMarginUsdt - (totalMarginUsdt / sourceLegs.length) * (sourceLegs.length - 1)
      : totalMarginUsdt / sourceLegs.length);
  const marginTotal = margins.reduce((total, margin) => total + margin, 0);
  if (Math.abs(marginTotal - totalMarginUsdt) > 1e-8) throw new Error("分腿金额之和必须等于总投入");

  return sourceLegs.map((leg, index) => ({
    atrOffset: leg.atrOffset as number,
    marginUsdt: margins[index],
  }));
}

function normalizeHorizontalEntry(value: unknown): HorizontalEntryConfig {
  if (!isPlainObject(value)) throw new Error("横向入场必须填写静态限价");
  return { price: positiveNumber(value.price, "横向入场价格必须大于0") };
}

export function strategyExpiryAt(createdAt: Date): string {
  if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) throw new Error("创建时间不正确");
  return new Date(createdAt.getTime() + STRATEGY_EXPIRY_DAYS * DAY_MS).toISOString();
}

export function normalizeStrategyDraft(input: StrategyDraft | unknown): StrategyConfig {
  const source = object(input);
  const execution = String(source.execution === undefined ? "LIMIT_POST_ONLY" : source.execution).toUpperCase();
  if (execution !== "LIMIT_POST_ONLY") throw new Error("策略只支持限价 Post Only 下单");
  const refreshOn = String(source.refreshOn === undefined ? "CLOSED_CANDLE" : source.refreshOn).toUpperCase();
  if (refreshOn !== "CLOSED_CANDLE") throw new Error("策略只能在已收盘 K 线刷新");
  const mode = String(source.mode === undefined ? "PAPER" : source.mode).toUpperCase();
  if (mode !== "PAPER") throw new Error("当前阶段仅支持 PAPER 策略");
  if (source.expiryDays !== undefined && Number(source.expiryDays) !== STRATEGY_EXPIRY_DAYS) {
    throw new Error("策略有效期固定为7天");
  }

  const side = String(source.side === undefined ? "LONG" : source.side).toUpperCase();
  if (side !== "LONG" && side !== "SHORT") throw new Error("方向不正确");
  const normalizedSide = side as StrategySide;
  const style = String(source.style === undefined ? "MA" : source.style).toUpperCase();
  if (style !== "MA" && style !== "HORIZONTAL") throw new Error("策略类型不正确");
  const horizontalEntry = style === "HORIZONTAL" ? normalizeHorizontalEntry(source.horizontalEntry) : null;
  const allowPersistedGuardNull = isPersistedCanonicalConfig(source);

  const dynamicGuard = normalizeGuard(source.dynamicGuard, "DYNAMIC_MA", normalizedSide, allowPersistedGuardNull);
  const horizontalGuard = source.horizontalGuard === undefined
    ? null
    : normalizeGuard(source.horizontalGuard, "HORIZONTAL", normalizedSide, allowPersistedGuardNull);

  const symbol = String(source.symbol || "").trim().toUpperCase();
  if (!isBinanceFuturesSymbol(symbol)) throw new Error("币种格式不正确");
  const timeframe = String(source.timeframe === undefined ? "1h" : source.timeframe);
  if (!TIMEFRAMES.includes(timeframe as StrategyTimeframe)) throw new Error("操作周期不正确");
  const totalMarginUsdt = positiveNumber(source.totalMarginUsdt, "总投入必须大于0");

  const ma = object(source.ma);
  const maKind = String(ma.kind || "SMA").toUpperCase();
  if (maKind !== "SMA" && maKind !== "EMA") throw new Error("均线类型只支持 SMA 或 EMA");
  const atr = object(source.atr);

  const legs = normalizeLegs(source.legs, totalMarginUsdt, style === "HORIZONTAL" ? [0, 0, 0] : DEFAULT_LEG_OFFSETS);
  if (style === "HORIZONTAL" && legs.some((leg) => leg.atrOffset !== 0)) {
    throw new Error("横向入场的 ATR 偏移量必须为0");
  }

  return {
    symbol,
    side: normalizedSide,
    style: style as StrategyStyle,
    mode: "PAPER",
    timeframe: timeframe as StrategyTimeframe,
    totalMarginUsdt,
    ma: { kind: maKind as MovingAverageKind, length: positiveInteger(ma.length ?? 30, "均线周期必须为正整数") },
    atr: { length: positiveInteger(atr.length ?? 14, "ATR 周期必须为正整数") },
    legs: style === "HORIZONTAL"
      ? legs.map((leg) => ({ ...leg, staticLimitPrice: horizontalEntry!.price }))
      : legs,
    horizontalEntry,
    execution: "LIMIT_POST_ONLY",
    refreshOn: "CLOSED_CANDLE",
    entryRefresh: style === "HORIZONTAL" ? "NONE" : "CLOSED_CANDLE",
    expiryDays: 7,
    profitTargets: DEFAULT_PROFIT_TARGETS.map((target) => ({ ...target })),
    dynamicGuard,
    horizontalGuard,
  };
}
