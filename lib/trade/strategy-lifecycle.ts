import type {
  EntryLegConfig,
  ProfitLot,
  StrategyConfig,
  StrategySide,
} from "./strategy-contracts";

export type StrategyEntryLeg = Pick<EntryLegConfig, "atrOffset"> & {
  id: string;
  marginUsdt: number;
  stepSize: number;
  requestedQuantity: number;
  filledQuantity: number;
  price: number;
};

export type RefreshUnfilledLegsInput = {
  config: Pick<StrategyConfig, "entryRefresh">;
  isNewClosedCandle: boolean;
  closedCandleId: string | number;
  lastProcessedClosedCandleId?: string | number;
  tickSize: number;
  ma: number;
  atr: number;
  legs: readonly StrategyEntryLeg[];
};

export type RefreshDecision = {
  legId: string;
  closedCandleId: string | number;
  price: number;
  quantity: number;
};

export type CreateProfitLotInput = {
  id: string;
  strategyId: string;
  legId: string;
  websiteOrderId: string;
  entryPrice: number;
  filledQuantity: number;
};

export type ProfitTargetStateInput = Pick<
  ProfitLot,
  "entryPrice" | "initialNotional" | "initialQuantity" | "exitedQuantity" | "realizedGrossPnl" | "completedProfitTargets"
> & {
  side: StrategySide;
  markPrice: number;
};

export type ProfitTargetDecision = {
  stage: 1 | 2;
  reduceQuantity: number;
};

function finitePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}必须大于0`);
  return value;
}

function finiteNonNegative(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label}不能小于0`);
  return value;
}

function roundToTick(value: number, tickSize: number): number {
  finitePositive(tickSize, "价格精度");
  if (!Number.isFinite(value)) throw new Error("限价不正确");
  return Number((Math.round(value / tickSize) * tickSize).toPrecision(15));
}

function roundDownToStep(value: number, stepSize: number): number {
  finitePositive(stepSize, "数量精度");
  if (!Number.isFinite(value) || value <= 0) throw new Error("委托数量必须大于0");
  return Number((Math.floor(value / stepSize + Number.EPSILON) * stepSize).toPrecision(15));
}

function completedTargets(lot: Pick<ProfitLot, "completedProfitTargets">): Set<1 | 2> {
  return new Set(lot.completedProfitTargets);
}

function grossUnrealizedPnl(input: ProfitTargetStateInput): number {
  const remainingQuantity = Math.max(0, input.initialQuantity - input.exitedQuantity);
  return input.side === "LONG"
    ? (input.markPrice - input.entryPrice) * remainingQuantity
    : (input.entryPrice - input.markPrice) * remainingQuantity;
}

export function refreshUnfilledLegs(input: RefreshUnfilledLegsInput): RefreshDecision[] {
  if (
    input.config.entryRefresh !== "CLOSED_CANDLE"
    || input.isNewClosedCandle !== true
    || input.lastProcessedClosedCandleId === input.closedCandleId
  ) return [];

  finitePositive(input.tickSize, "价格精度");
  if (!Number.isFinite(input.ma) || !Number.isFinite(input.atr)) throw new Error("均线或 ATR 数据不正确");

  return input.legs.flatMap((leg) => {
    finiteNonNegative(leg.filledQuantity, "已成交数量");
    finitePositive(leg.requestedQuantity, "委托数量");
    finitePositive(leg.marginUsdt, "入场金额");
    finitePositive(leg.stepSize, "数量精度");
    if (leg.filledQuantity > 0) return [];

    const price = roundToTick(input.ma + leg.atrOffset * input.atr, input.tickSize);
    const quantity = roundDownToStep(leg.marginUsdt / price, leg.stepSize);
    return price === leg.price && quantity === leg.requestedQuantity
      ? []
      : [{ legId: leg.id, closedCandleId: input.closedCandleId, price, quantity }];
  });
}

export function createProfitLot(input: CreateProfitLotInput): ProfitLot {
  finitePositive(input.entryPrice, "成交价格");
  finitePositive(input.filledQuantity, "新增成交数量");

  return {
    id: input.id,
    strategyId: input.strategyId,
    legId: input.legId,
    websiteOrderId: input.websiteOrderId,
    entryPrice: input.entryPrice,
    initialQuantity: input.filledQuantity,
    initialNotional: input.entryPrice * input.filledQuantity,
    exitedQuantity: 0,
    realizedGrossPnl: 0,
    completedProfitTargets: [],
  };
}

export function profitTargetState(input: ProfitTargetStateInput): ProfitTargetDecision | null {
  finitePositive(input.entryPrice, "成交价格");
  finitePositive(input.initialNotional, "成交金额");
  finitePositive(input.initialQuantity, "初始数量");
  finiteNonNegative(input.exitedQuantity, "已退出数量");
  if (!Number.isFinite(input.realizedGrossPnl) || !Number.isFinite(input.markPrice)) {
    throw new Error("利润数据不正确");
  }

  const remainingQuantity = Math.max(0, input.initialQuantity - input.exitedQuantity);
  if (remainingQuantity <= 0) return null;

  const grossPnl = input.realizedGrossPnl + grossUnrealizedPnl(input);
  const targets = completedTargets(input);
  const stages: ReadonlyArray<{ stage: 1 | 2; grossProfitMultiple: number; initialQuantityPct: number }> = [
    { stage: 1, grossProfitMultiple: 1, initialQuantityPct: 25 },
    { stage: 2, grossProfitMultiple: 2, initialQuantityPct: 40 },
  ];

  for (const target of stages) {
    if (targets.has(target.stage) || grossPnl < input.initialNotional * target.grossProfitMultiple) continue;
    const reduceQuantity = Math.min(remainingQuantity, input.initialQuantity * target.initialQuantityPct / 100);
    return reduceQuantity > 0 ? { stage: target.stage, reduceQuantity } : null;
  }

  return null;
}

export function canCancelRemainingEntries(lots: ReadonlyArray<Pick<ProfitLot, "initialQuantity" | "exitedQuantity">>): boolean {
  return lots.length > 0 && lots.every((lot) => lot.exitedQuantity >= lot.initialQuantity);
}

export function mergeGuardTargetRemainingPct(targets: ReadonlyArray<number | null | undefined>): number | null {
  const activeTargets = targets.filter((target): target is number => target !== null && target !== undefined);
  if (activeTargets.length === 0) return null;
  for (const target of activeTargets) {
    if (!Number.isFinite(target) || target < 0 || target > 100) throw new Error("守卫目标剩余仓位比例不正确");
  }
  return Math.min(...activeTargets);
}
