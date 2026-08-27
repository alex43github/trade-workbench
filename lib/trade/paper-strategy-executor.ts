import { canCancelRemainingEntries, mergeGuardTargetRemainingPct, profitTargetState, refreshUnfilledLegs } from "./strategy-lifecycle.ts";
import type { GuardConfig, MovingAverageKind, StrategyTimeframe } from "./strategy-contracts.ts";
import { getD1 } from "../../db/index.ts";
import { cancelStrategy, expireStrategyIfNeeded, getStrategy, listStrategies, recordEntryFill, recordLotExit, recordRefresh, type PersistedStrategy, type StrategyLeg } from "./strategies.ts";

export type PaperClosedCandle = {
  id: string;
  isNewClosedCandle: true;
  close?: number;
  timeframe?: StrategyTimeframe;
  maKind?: MovingAverageKind;
  maLength?: number;
  atrLength?: number;
  ma: number;
  atr: number;
  tickSize: number;
  stepSize: number;
};

export type PaperStrategyTick = {
  strategyId?: string;
  symbol: string;
  markPrice: number;
  closedCandle?: PaperClosedCandle;
};

export type PaperStrategyTickResult = {
  expiredStrategyIds: string[];
  refreshedLegs: Array<{ strategyId: string; legId: string }>;
  filledLegs: Array<{ strategyId: string; legId: string; lotId: string }>;
  exitedLots: Array<{ strategyId: string; lotId: string; stage: 1 | 2 }>;
  guardExitedLots: Array<{ strategyId: string; lotId: string; guard: "DYNAMIC_MA" | "HORIZONTAL" | "MERGED" }>;
  canceledStrategyIds: string[];
};

type GuardState = {
  lastClosedCandleId: string | null;
  confirmations: number;
};

type GuardDecision = {
  guard: GuardConfig["kind"];
  target: number | null;
  observationId: string | null;
  checkpoint: { confirmationCount: number; violated: boolean; closedCandleId: string };
};

function positivePrice(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}必须大于0`);
  return value;
}

function matchesLimit(strategy: PersistedStrategy, price: number, markPrice: number) {
  return strategy.config.side === "LONG" ? markPrice <= price : markPrice >= price;
}

function restingPrice(leg: StrategyLeg) {
  return leg.price ?? leg.staticLimitPrice ?? null;
}

function realizedGrossPnl(strategy: PersistedStrategy, entryPrice: number, exitPrice: number, quantity: number) {
  return (strategy.config.side === "LONG" ? exitPrice - entryPrice : entryPrice - exitPrice) * quantity;
}

function matchesStrategyCandle(strategy: PersistedStrategy, candle: PaperClosedCandle | undefined) {
  return candle?.isNewClosedCandle === true
    && candle.timeframe === strategy.config.timeframe
    && candle.maKind === strategy.config.ma.kind
    && candle.maLength === strategy.config.ma.length
    && candle.atrLength === strategy.config.atr.length;
}

async function loadGuardState(strategyId: string, guard: GuardConfig["kind"]): Promise<GuardState> {
  const rows = await (await getD1()).prepare(`SELECT payload_json FROM trade_strategy_events
    WHERE strategy_id = ? AND type = 'GUARD_CHECKED' ORDER BY rowid DESC LIMIT 32`).bind(strategyId).all<{ payload_json: unknown }>();
  for (const row of rows.results) {
    try {
      const payload: unknown = JSON.parse(String(row.payload_json || "{}"));
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) continue;
      const value = payload as Record<string, unknown>;
      if (value.guard !== guard) continue;
      const confirmations = Number(value.confirmationCount);
      return {
        lastClosedCandleId: typeof value.closedCandleId === "string" ? value.closedCandleId : null,
        confirmations: Number.isSafeInteger(confirmations) && confirmations >= 0 ? confirmations : 0,
      };
    } catch {
      // A malformed historical audit row must not prevent PAPER execution.
    }
  }
  return { lastClosedCandleId: null, confirmations: 0 };
}

async function recordGuardCheckpoint(
  strategyId: string,
  guard: GuardConfig["kind"],
  values: { confirmationCount: number; violated: boolean; closedCandleId: string },
) {
  await (await getD1()).prepare(`INSERT INTO trade_strategy_events (id, strategy_id, type, payload_json)
    VALUES (?, ?, 'GUARD_CHECKED', ?)`).bind(
    crypto.randomUUID(), strategyId, JSON.stringify({ guard, ...values }),
  ).run();
}

function guardIsViolated(guard: GuardConfig, price: number) {
  return guard.direction === "BELOW" ? price < Number(guard.price) : price > Number(guard.price);
}

function targetAfterConfirmation(guard: GuardConfig, confirmations: number) {
  return confirmations >= guard.confirmationCandles
    ? guard.finalTargetRemainingPct
    : guard.firstTargetRemainingPct;
}

async function dynamicGuardTarget(strategy: PersistedStrategy, candle: PaperClosedCandle | undefined) {
  const guard = strategy.config.dynamicGuard;
  if (!guard || !candle || candle.isNewClosedCandle !== true || !Number.isFinite(candle.close)) return null;
  const state = await loadGuardState(strategy.id, "DYNAMIC_MA");
  if (state.lastClosedCandleId === candle.id) return null;
  const boundary = guard.direction === "BELOW"
    ? candle.ma - candle.atr * Number(guard.atrMultiplier)
    : candle.ma + candle.atr * Number(guard.atrMultiplier);
  const violated = guard.direction === "BELOW" ? candle.close! < boundary : candle.close! > boundary;
  const confirmations = violated ? state.confirmations + 1 : 0;
  return {
    guard: "DYNAMIC_MA",
    target: violated ? targetAfterConfirmation(guard, confirmations) : null,
    observationId: violated ? `candle:${candle.id}` : null,
    checkpoint: { closedCandleId: candle.id, confirmationCount: confirmations, violated },
  } satisfies GuardDecision;
}

async function horizontalGuardTarget(strategy: PersistedStrategy, candle: PaperClosedCandle | undefined) {
  const guard = strategy.config.horizontalGuard;
  if (!guard || !candle || candle.isNewClosedCandle !== true || !Number.isFinite(candle.close) || !Number.isFinite(guard.price)) return null;
  const state = await loadGuardState(strategy.id, "HORIZONTAL");
  if (state.lastClosedCandleId === candle.id) return null;
  const violated = guardIsViolated(guard, candle.close!);
  const confirmations = violated ? state.confirmations + 1 : 0;
  return {
    guard: "HORIZONTAL",
    target: violated ? targetAfterConfirmation(guard, confirmations) : null,
    observationId: violated ? `candle:${candle.id}` : null,
    checkpoint: { closedCandleId: candle.id, confirmationCount: confirmations, violated },
  } satisfies GuardDecision;
}

async function applyGuards(
  strategy: PersistedStrategy,
  markPrice: number,
  candle: PaperClosedCandle | undefined,
  result: PaperStrategyTickResult,
) {
  const dynamic = await dynamicGuardTarget(strategy, candle);
  const horizontal = await horizontalGuardTarget(strategy, candle);
  const targetRemainingPct = mergeGuardTargetRemainingPct([dynamic?.target, horizontal?.target]);
  if (targetRemainingPct === null) {
    for (const decision of [dynamic, horizontal]) {
      if (!decision) continue;
      await recordGuardCheckpoint(strategy.id, decision.guard, decision.checkpoint);
    }
    return;
  }

  const guard: "DYNAMIC_MA" | "HORIZONTAL" | "MERGED" = dynamic !== null && horizontal !== null
    ? "MERGED"
    : dynamic !== null ? "DYNAMIC_MA" : "HORIZONTAL";
  const sourceTick = dynamic?.observationId ?? horizontal?.observationId;
  for (const lot of strategy.lots) {
    const remainingQuantity = Math.max(0, lot.initialQuantity - lot.exitedQuantity);
    const targetRemainingQuantity = lot.initialQuantity * targetRemainingPct / 100;
    const quantity = Math.max(0, remainingQuantity - targetRemainingQuantity);
    if (quantity <= Number.EPSILON) continue;
    await recordLotExit(strategy.id, {
      lotId: lot.id,
      quantity,
      realizedGrossPnl: realizedGrossPnl(strategy, lot.entryPrice, markPrice, quantity),
      sourceExitId: `paper:exit:${strategy.id}:${lot.id}:guard:${guard.toLowerCase()}:${sourceTick}:remaining-${targetRemainingPct}`,
    });
    result.guardExitedLots.push({ strategyId: strategy.id, lotId: lot.id, guard });
  }
  for (const decision of [dynamic, horizontal]) {
    if (!decision) continue;
    await recordGuardCheckpoint(strategy.id, decision.guard, decision.checkpoint);
  }
}

async function refreshForClosedCandle(strategy: PersistedStrategy, candle: PaperClosedCandle, result: PaperStrategyTickResult) {
  const decisions = refreshUnfilledLegs({
    config: strategy.config,
    isNewClosedCandle: candle.isNewClosedCandle,
    closedCandleId: candle.id,
    tickSize: candle.tickSize,
    ma: candle.ma,
    atr: candle.atr,
    legs: strategy.legs.map((leg) => ({
      id: leg.id,
      atrOffset: leg.atrOffset,
      marginUsdt: leg.marginUsdt,
      stepSize: candle.stepSize,
      requestedQuantity: leg.requestedQuantity || 1,
      filledQuantity: leg.filledQuantity,
      price: restingPrice(leg) ?? Number.NaN,
    })),
  });
  for (const decision of decisions) {
    await recordRefresh(strategy.id, {
      legId: decision.legId,
      closedCandleId: decision.closedCandleId,
      price: decision.price,
      requestedQuantity: decision.quantity,
    });
    result.refreshedLegs.push({ strategyId: strategy.id, legId: decision.legId });
  }
}

async function fillRestingLimits(strategy: PersistedStrategy, markPrice: number, result: PaperStrategyTickResult) {
  for (const leg of strategy.legs) {
    const price = restingPrice(leg);
    const remainingQuantity = leg.requestedQuantity > 0
      ? Math.max(0, leg.requestedQuantity - leg.filledQuantity)
      : strategy.config.entryRefresh === "NONE" && leg.filledQuantity === 0 && price !== null
        ? leg.marginUsdt / price
        : 0;
    if (price === null || remainingQuantity <= 0 || !matchesLimit(strategy, price, markPrice)) continue;
    const lot = await recordEntryFill(strategy.id, {
      legId: leg.id,
      quantity: remainingQuantity,
      price,
      sourceFillId: `paper:entry:${strategy.id}:${leg.id}:r${leg.revision}`,
    });
    result.filledLegs.push({ strategyId: strategy.id, legId: leg.id, lotId: lot.id });
  }
}

async function applyProfitTargets(strategy: PersistedStrategy, markPrice: number, result: PaperStrategyTickResult) {
  for (const lot of strategy.lots) {
    const decision = profitTargetState({ ...lot, side: strategy.config.side, markPrice });
    if (!decision) continue;
    await recordLotExit(strategy.id, {
      lotId: lot.id,
      quantity: decision.reduceQuantity,
      realizedGrossPnl: Math.max(0, realizedGrossPnl(strategy, lot.entryPrice, markPrice, decision.reduceQuantity)),
      completedProfitTarget: decision.stage,
      sourceExitId: `paper:exit:${strategy.id}:${lot.id}:profit-${decision.stage}`,
    });
    result.exitedLots.push({ strategyId: strategy.id, lotId: lot.id, stage: decision.stage });
  }
}

export async function runPaperStrategyTick(input: PaperStrategyTick): Promise<PaperStrategyTickResult> {
  const symbol = String(input.symbol ?? "").trim().toUpperCase();
  const markPrice = positivePrice(Number(input.markPrice), "模拟标记价格");
  const result: PaperStrategyTickResult = {
    expiredStrategyIds: [], refreshedLegs: [], filledLegs: [], exitedLots: [], guardExitedLots: [], canceledStrategyIds: [],
  };
  const runnableStrategies = (await listStrategies(100)).filter((strategy): strategy is PersistedStrategy => strategy !== null
    && strategy.config.mode === "PAPER"
    && (strategy.status === "WAITING" || strategy.status === "ACTIVE"));
  for (const strategy of runnableStrategies) {
    if (await expireStrategyIfNeeded(strategy.id)) result.expiredStrategyIds.push(strategy.id);
  }
  const strategies = runnableStrategies.filter((strategy) => !result.expiredStrategyIds.includes(strategy.id)
    && (input.strategyId === undefined || strategy.id === input.strategyId)
    && strategy.config.symbol === symbol);

  for (const initial of strategies) {
    const closedCandle = matchesStrategyCandle(initial, input.closedCandle) ? input.closedCandle : undefined;
    if (closedCandle) await refreshForClosedCandle(initial, closedCandle, result);
    let strategy = await getStrategy(initial.id);
    if (!strategy || (strategy.status !== "WAITING" && strategy.status !== "ACTIVE")) continue;
    await fillRestingLimits(strategy, markPrice, result);
    strategy = await getStrategy(initial.id);
    if (!strategy || (strategy.status !== "WAITING" && strategy.status !== "ACTIVE")) continue;
    await applyProfitTargets(strategy, markPrice, result);
    strategy = await getStrategy(initial.id);
    if (!strategy || (strategy.status !== "WAITING" && strategy.status !== "ACTIVE")) continue;
    await applyGuards(strategy, markPrice, closedCandle, result);
    strategy = await getStrategy(initial.id);
    if (strategy && canCancelRemainingEntries(strategy.lots)) {
      await cancelStrategy(strategy.id, "ALL_LOTS_CLOSED");
      result.canceledStrategyIds.push(strategy.id);
    }
  }
  return result;
}
