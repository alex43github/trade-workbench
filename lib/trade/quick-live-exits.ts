import {
  normalizeQuickLiveTemplateSnapshot,
  type QuickLiveExitRule,
  type QuickLiveTemplateSnapshot,
} from "./quick-live-template.ts";

export type QuickLiveExitCandle = {
  id: string;
  timeframe?: string;
  close: number;
  high?: number;
  low?: number;
};

export type QuickLiveExitState = {
  processedCandleIds?: string[];
  breachCount?: number;
  independentBreachCount?: number;
  completedTargets?: number[];
  completedTargetOffsets?: number[];
  exitCompleted?: boolean;
};

export type QuickLiveExitAction = "NOOP" | "PARTIAL_EXIT" | "FULL_EXIT";
export type QuickLiveExitReason =
  | "DUPLICATE_CANDLE"
  | "EXIT_COMPLETED"
  | "SAFE_CANDLE"
  | "NO_TRIGGER"
  | "STOP_CLOSE"
  | "BALANCED_FIRST_BREACH"
  | "TAKE_PROFIT_TOUCH";

export type QuickLiveExitDecision = {
  action: QuickLiveExitAction;
  reason: QuickLiveExitReason;
  exitPercent: 0 | 50 | 100;
  candleId: string;
  breachCount: number;
  completedTargets: number[];
  nextState: Required<QuickLiveExitState>;
  snapshot: QuickLiveTemplateSnapshot;
};

type ExitTarget = {
  kind: "TOUCH_ABOVE" | "TOUCH_BELOW";
  offset: number;
  price: number;
  remainingPct: 0 | 50;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : {};
}

function positive(value: unknown, message: string) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(message);
  return number;
}

function nonNegativeInteger(value: unknown, message: string) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(message);
  return number;
}

function candleId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!id) throw new Error("快捷退出缺少 K 线编号");
  return id;
}

function validateCandle(input: QuickLiveExitCandle) {
  if (!input || typeof input !== "object") throw new Error("快捷退出 K 线快照无效");
  if (input.timeframe !== undefined && String(input.timeframe) !== "1h") throw new Error("快捷退出只允许使用已收盘 1h K 线");
  const id = candleId(input.id);
  const close = positive(input.close, "快捷退出收盘价无效");
  if (input.high === undefined || input.low === undefined) throw new Error("快捷退出缺少 K 线真实高低价");
  const high = positive(input.high, "快捷退出最高价无效");
  const low = positive(input.low, "快捷退出最低价无效");
  if (low > high) throw new Error("快捷退出 K 线高低价无效");
  return { id, close, high, low };
}

function validateSnapshot(value: unknown) {
  const snapshot = normalizeQuickLiveTemplateSnapshot(value);
  const levels = record(snapshot.exitLevels);
  const stop = record(levels.stop);
  const targets = levels.takeProfit;
  const stopKind = String(stop.kind ?? "").toUpperCase();
  const stopPrice = positive(stop.price, "快捷退出止损价格无效");
  if (stopKind !== "CLOSE_BELOW" && stopKind !== "CLOSE_ABOVE") throw new Error("快捷退出止损类型无效");
  if (!Array.isArray(targets)) throw new Error("快捷退出止盈规则无效");
  const normalizedTargets: Array<{ kind: "DEFAULT_PROFIT_TARGETS" } | ExitTarget> = targets.map((raw) => {
    const target = record(raw);
    const kind = String(target.kind ?? "").toUpperCase();
    if (kind === "DEFAULT_PROFIT_TARGETS") return { kind: "DEFAULT_PROFIT_TARGETS" as const };
    if (kind !== "TOUCH_ABOVE" && kind !== "TOUCH_BELOW") throw new Error("快捷退出止盈类型无效");
    const remainingPct = Number(target.remainingPct);
    if (remainingPct !== 0 && remainingPct !== 50) throw new Error("快捷退出止盈比例无效");
    return {
      kind: kind as ExitTarget["kind"],
      offset: Number(target.offset),
      price: positive(target.price, "快捷退出止盈价格无效"),
      remainingPct: remainingPct as 0 | 50,
    };
  });
  if (snapshot.exitRule === "BALANCED_MA_1H" && normalizedTargets.some((target) => target.kind !== "DEFAULT_PROFIT_TARGETS")) {
    throw new Error("均衡快捷退出必须复用默认止盈规则");
  }
  if (snapshot.exitRule !== "BALANCED_MA_1H" && normalizedTargets.some((target) => target.kind === "DEFAULT_PROFIT_TARGETS")) {
    throw new Error("该快捷模板必须使用明确止盈价位");
  }
  return {
    ...snapshot,
    exitLevels: {
      stop: {
        kind: stopKind as "CLOSE_BELOW" | "CLOSE_ABOVE",
        offset: Number(stop.offset),
        price: stopPrice,
        ...(stop.firstExitPct === undefined ? {} : { firstExitPct: 50 as const }),
        ...(stop.triggerCount === undefined ? {} : { triggerCount: 2 as const }),
      },
      takeProfit: normalizedTargets,
    },
  } as QuickLiveTemplateSnapshot;
}

function stateOf(value: QuickLiveExitState | undefined): Required<QuickLiveExitState> {
  const source = record(value);
  const processedCandleIds = Array.isArray(source.processedCandleIds)
    ? source.processedCandleIds.map((id) => candleId(id))
    : [];
  const rawBreachCount = source.breachCount ?? source.independentBreachCount ?? 0;
  const breachCount = nonNegativeInteger(rawBreachCount, "快捷退出跌破计数无效");
  const rawTargets = source.completedTargets ?? source.completedTargetOffsets ?? [];
  if (!Array.isArray(rawTargets)) throw new Error("快捷退出止盈完成记录无效");
  const completedTargets = [...new Set(rawTargets.map((offset) => {
    const number = Number(offset);
    if (!Number.isFinite(number)) throw new Error("快捷退出止盈完成记录无效");
    return number;
  }))].sort((left, right) => left - right);
  return {
    processedCandleIds,
    breachCount,
    independentBreachCount: breachCount,
    completedTargets,
    completedTargetOffsets: [...completedTargets],
    exitCompleted: source.exitCompleted === true,
  };
}

function nextState(state: Required<QuickLiveExitState>, candleIdValue: string, updates: Partial<QuickLiveExitState> = {}) {
  const processedCandleIds = state.processedCandleIds.includes(candleIdValue)
    ? [...state.processedCandleIds]
    : [...state.processedCandleIds, candleIdValue];
  const completedTargets = [...new Set(updates.completedTargets ?? state.completedTargets)].sort((left, right) => left - right);
  const breachCount = updates.breachCount ?? state.breachCount;
  const exitCompleted = updates.exitCompleted ?? state.exitCompleted;
  return {
    processedCandleIds,
    breachCount,
    independentBreachCount: breachCount,
    completedTargets,
    completedTargetOffsets: [...completedTargets],
    exitCompleted,
  };
}

function noAction(
  snapshot: QuickLiveTemplateSnapshot,
  candleIdValue: string,
  reason: QuickLiveExitReason,
  state: Required<QuickLiveExitState>,
  next: Required<QuickLiveExitState> = state,
): QuickLiveExitDecision {
  return {
    action: "NOOP", reason, exitPercent: 0, candleId: candleIdValue,
    breachCount: next.breachCount, completedTargets: [...next.completedTargets], nextState: next, snapshot,
  };
}

function stopTriggered(snapshot: QuickLiveTemplateSnapshot, close: number) {
  const stop = snapshot.exitLevels.stop;
  return stop.kind === "CLOSE_BELOW" ? close < stop.price : close > stop.price;
}

function targets(snapshot: QuickLiveTemplateSnapshot): ExitTarget[] {
  return snapshot.exitLevels.takeProfit.filter((target): target is ExitTarget => target.kind !== "DEFAULT_PROFIT_TARGETS");
}

export function evaluateQuickLiveExit(input: {
  snapshot: QuickLiveTemplateSnapshot | unknown;
  candle: QuickLiveExitCandle;
  state?: QuickLiveExitState;
}): QuickLiveExitDecision {
  const snapshot = validateSnapshot(input.snapshot);
  const currentCandle = validateCandle(input.candle);
  const state = stateOf(input.state);
  if (state.processedCandleIds.includes(currentCandle.id)) return noAction(snapshot, currentCandle.id, "DUPLICATE_CANDLE", state);
  const recordedState = nextState(state, currentCandle.id);
  if (state.exitCompleted) return noAction(snapshot, currentCandle.id, "EXIT_COMPLETED", state, recordedState);

  if (snapshot.exitRule === "BALANCED_MA_1H") {
    const breachCount = state.breachCount + (stopTriggered(snapshot, currentCandle.close) ? 1 : 0);
    const countedState = nextState(recordedState, currentCandle.id, { breachCount });
    if (!breachCount || !stopTriggered(snapshot, currentCandle.close)) return noAction(snapshot, currentCandle.id, "SAFE_CANDLE", state, countedState);
    if (breachCount === 1) {
      return {
        action: "PARTIAL_EXIT", reason: "BALANCED_FIRST_BREACH", exitPercent: 50, candleId: currentCandle.id,
        breachCount, completedTargets: [...countedState.completedTargets], nextState: countedState, snapshot,
      };
    }
    const completed = nextState(countedState, currentCandle.id, { exitCompleted: true });
    return {
      action: "FULL_EXIT", reason: "STOP_CLOSE", exitPercent: 100, candleId: currentCandle.id,
      breachCount, completedTargets: [...completed.completedTargets], nextState: completed, snapshot,
    };
  }

  if (stopTriggered(snapshot, currentCandle.close)) {
    const completed = nextState(recordedState, currentCandle.id, { exitCompleted: true });
    return {
      action: "FULL_EXIT", reason: "STOP_CLOSE", exitPercent: 100, candleId: currentCandle.id,
      breachCount: completed.breachCount, completedTargets: [...completed.completedTargets], nextState: completed, snapshot,
    };
  }

  const reached = targets(snapshot).filter((target) => !state.completedTargets.includes(target.offset)
    && (target.kind === "TOUCH_ABOVE" ? currentCandle.high >= target.price : currentCandle.low <= target.price));
  if (!reached.length) return noAction(snapshot, currentCandle.id, "NO_TRIGGER", state, recordedState);
  const completedTargets = [...state.completedTargets, ...reached.map((target) => target.offset)];
  const finalTarget = reached.find((target) => target.remainingPct === 0) ?? reached[reached.length - 1];
  const completed = nextState(recordedState, currentCandle.id, {
    completedTargets,
    exitCompleted: finalTarget.remainingPct === 0,
  });
  if (finalTarget.remainingPct === 0) {
    return {
      action: "FULL_EXIT", reason: "TAKE_PROFIT_TOUCH", exitPercent: 100, candleId: currentCandle.id,
      breachCount: completed.breachCount, completedTargets: [...completed.completedTargets], nextState: completed, snapshot,
    };
  }
  return {
    action: "PARTIAL_EXIT", reason: "TAKE_PROFIT_TOUCH", exitPercent: 50, candleId: currentCandle.id,
    breachCount: completed.breachCount, completedTargets: [...completed.completedTargets], nextState: completed, snapshot,
  };
}

export const decideQuickLiveExit = evaluateQuickLiveExit;

export function quickLiveExitRule(value: unknown): QuickLiveExitRule | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  return ["BALANCED_MA_1H", "BULL_CHASE_1H", "BEAR_CHASE_1H", "RANGE_SHORT_1H", "RANGE_LONG_1H"].includes(normalized)
    ? normalized as QuickLiveExitRule
    : null;
}
