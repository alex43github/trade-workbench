import {
  normalizeStrategyDraft,
  type StrategyConfig,
  type StrategyDraft,
} from "./strategy-contracts.ts";
import {
  normalizeQuickLiveTemplateSnapshot,
  QUICK_LIVE_ALL_TEMPLATE_IDS,
  isQuickLiveMarketTemplate,
  type QuickLiveExitRule,
  type QuickLiveEntryMode,
  type QuickLiveTemplateId,
  type QuickLiveTemplateSnapshot,
} from "./quick-live-template.ts";

export type LiveExecution = {
  entry: "LIMIT_POST_ONLY";
  profitTarget: "LIMIT_POST_ONLY";
  guardStop: "MARKET_REDUCE_ONLY";
};

export type LiveStrategyConfig = Omit<StrategyConfig, "mode" | "execution"> & {
  mode: "LIVE_ARMED";
  execution: LiveExecution;
  defaultLeverage?: never;
  entryLeverageAtSubmission?: number | null;
  quickTemplateId?: QuickLiveTemplateId;
  quickExitRule?: QuickLiveExitRule;
  quickEntryMode?: QuickLiveEntryMode;
  quickTemplateSnapshot?: QuickLiveTemplateSnapshot;
  /** Internal cutover marker: only strategies created after the protected-entry release may auto-create source-bound stops. */
  sourceProtectionVersion?: "SOURCE_BOUND_V2";
};

export type LiveStrategyDraft = StrategyDraft & {
  mode?: "LIVE_ARMED" | string;
  legCount?: number | string;
  firstGuardExitPct?: number | string;
  useDefaultProfitTargets?: boolean;
  quickTemplateId?: QuickLiveTemplateId | string;
  templateId?: QuickLiveTemplateId | string;
  quickExitRule?: QuickLiveExitRule | string;
  quickEntryMode?: QuickLiveEntryMode | string;
  quickTemplateSnapshot?: unknown;
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
  const quickTemplateId = source.quickTemplateId === undefined ? undefined : String(source.quickTemplateId).trim().toUpperCase();
  const quickTemplateSnapshot = source.quickTemplateSnapshot;
  if (quickTemplateSnapshot !== undefined && quickTemplateId === undefined) {
    throw new Error("快捷模板快照必须由服务端生成");
  }
  if (quickTemplateId !== undefined && !QUICK_LIVE_ALL_TEMPLATE_IDS.includes(quickTemplateId as QuickLiveTemplateId)) {
    throw new Error("快捷模板标识不正确");
  }
  const quickEntryMode = source.quickEntryMode === undefined
    ? quickTemplateId === undefined ? undefined : isQuickLiveMarketTemplate(quickTemplateId) ? "MARKET" : "LIMIT"
    : String(source.quickEntryMode).trim().toUpperCase() as QuickLiveEntryMode;
  if (quickEntryMode !== undefined && quickEntryMode !== "LIMIT" && quickEntryMode !== "MARKET") {
    throw new Error("快捷模板入场模式不正确");
  }
  if (quickTemplateId !== undefined && quickEntryMode !== (isQuickLiveMarketTemplate(quickTemplateId) ? "MARKET" : "LIMIT")) {
    throw new Error("快捷模板入场模式与模板不一致");
  }
  const quickExitRule = source.quickExitRule === undefined ? undefined : String(source.quickExitRule).trim().toUpperCase() as QuickLiveExitRule;
  const normalizedSnapshot = quickTemplateSnapshot === undefined
    ? undefined
    : normalizeQuickLiveTemplateSnapshot(quickTemplateSnapshot);
  if (quickTemplateId !== undefined && (!quickExitRule || !normalizedSnapshot || normalizedSnapshot.templateId !== quickTemplateId || normalizedSnapshot.exitRule !== quickExitRule)) {
    throw new Error("快捷模板退出快照不完整");
  }
  return {
    ...paperConfig,
    mode: "LIVE_ARMED",
    entryLeverageAtSubmission: source.entryLeverageAtSubmission == null
      ? null
      : (() => {
        const leverage = Number(source.entryLeverageAtSubmission);
        if (!Number.isFinite(leverage) || leverage <= 0) throw new Error("下单杠杆快照无效");
        return leverage;
      })(),
    execution: {
      entry: "LIMIT_POST_ONLY",
      profitTarget: "LIMIT_POST_ONLY",
      guardStop: "MARKET_REDUCE_ONLY",
    },
    ...(quickTemplateId === undefined ? {} : {
      quickTemplateId: quickTemplateId as QuickLiveTemplateId,
      quickExitRule,
      quickEntryMode,
      quickTemplateSnapshot: normalizedSnapshot,
    }),
    ...(source.sourceProtectionVersion === "SOURCE_BOUND_V2" ? { sourceProtectionVersion: "SOURCE_BOUND_V2" as const } : {}),
  };
}
