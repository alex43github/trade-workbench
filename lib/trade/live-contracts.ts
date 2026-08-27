import {
  normalizeStrategyDraft,
  type StrategyConfig,
  type StrategyDraft,
} from "./strategy-contracts.ts";

export type LiveExecution = {
  entry: "LIMIT_POST_ONLY";
  profitTarget: "LIMIT_POST_ONLY";
  guardStop: "MARKET_REDUCE_ONLY";
};

export type LiveStrategyConfig = Omit<StrategyConfig, "mode" | "execution"> & {
  mode: "LIVE_ARMED";
  execution: LiveExecution;
  defaultLeverage?: never;
};

export type LiveStrategyDraft = StrategyDraft & {
  mode?: "LIVE_ARMED" | string;
  legCount?: number | string;
  firstGuardExitPct?: number | string;
  useDefaultProfitTargets?: boolean;
  leverage?: never;
  defaultLeverage?: never;
  marginType?: never;
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : {};
}

function legOffsets(value: unknown) {
  if (value === undefined) return undefined;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("分批下单数量必须是 1 到 10");
  return Array.from({ length: count }, (_, index) => ({ atrOffset: (count - 1) / 2 - index }));
}

export function normalizeLiveStrategyDraft(input: LiveStrategyDraft | unknown): LiveStrategyConfig {
  const source = record(input);
  if (source.leverage !== undefined || source.defaultLeverage !== undefined) throw new Error("实盘策略不允许修改杠杆");
  if (source.marginType !== undefined) throw new Error("实盘策略不允许修改保证金模式");
  if (source.mode !== undefined && String(source.mode).toUpperCase() !== "LIVE_ARMED") throw new Error("实盘策略模式不正确");
  if (source.firstGuardExitPct !== undefined && Number(source.firstGuardExitPct) !== 50) throw new Error("首段止损固定为50%");
  if (source.useDefaultProfitTargets === false) throw new Error("实盘策略必须使用默认止盈规则");

  const atr = record(source.atr);
  const paperConfig = normalizeStrategyDraft({
    ...source,
    mode: "PAPER",
    execution: "LIMIT_POST_ONLY",
    legs: source.legs ?? legOffsets(source.legCount),
    dynamicGuard: source.dynamicGuard === undefined
      ? { atrMultiplier: atr.multiplier ?? 1, firstTargetRemainingPct: 50 }
      : source.dynamicGuard,
  });
  return {
    ...paperConfig,
    mode: "LIVE_ARMED",
    execution: {
      entry: "LIMIT_POST_ONLY",
      profitTarget: "LIMIT_POST_ONLY",
      guardStop: "MARKET_REDUCE_ONLY",
    },
  };
}
