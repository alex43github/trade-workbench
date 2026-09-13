import type { FocusPoolRecord } from "./focus-pool.ts";
import type { FocusDecisionResult } from "./focus-decision.ts";
import type { FocusMa30Event } from "./focus-ma30.ts";

export type FocusBarkMessage = { key: string; title: string; body: string; group: string };

export type ExecutionGuidance = {
  aEntryZone: [number, number];
  aStop: number;
  aTakeProfit: number;
  aContinuation: string;
  bTrigger: number;
  bStop: number;
  bTakeProfit: number;
  bContinuation: string;
};

function round(value: number) {
  if (!Number.isFinite(value)) return 0;
  const digits = Math.abs(value) < 1 ? 6 : 4;
  return Number(value.toFixed(digits));
}

export function deriveExecutionGuidance(input: { price: number; ma30: number; atr: number; retestLow?: number; breakoutHigh?: number }): ExecutionGuidance {
  const atr = Math.max(Math.abs(input.atr), Math.abs(input.price) * 0.001);
  const zoneLow = Math.min(input.price - atr * 0.65, input.ma30 + atr * 0.1);
  const zoneHigh = Math.max(zoneLow, input.price - atr * 0.2);
  const aStop = Math.min(input.retestLow ?? input.ma30 - atr * 0.75, input.ma30 - atr * 0.6);
  const aRisk = Math.max(zoneHigh - aStop, atr * 0.5);
  const bTrigger = Math.max(input.breakoutHigh ?? input.price + atr * 0.2, input.price);
  const bStop = Math.min(input.ma30 - atr * 0.35, bTrigger - atr * 0.9);
  const bRisk = Math.max(bTrigger - bStop, atr * 0.5);
  return {
    aEntryZone: [round(zoneLow), round(zoneHigh)],
    aStop: round(aStop),
    aTakeProfit: round(zoneHigh + aRisk * 1.5),
    aContinuation: "TP1 后回收风险，尾仓跟随 15m/1H MA30 与结构高低点。",
    bTrigger: round(bTrigger),
    bStop: round(bStop),
    bTakeProfit: round(bTrigger + bRisk * 1.5),
    bContinuation: "突破确认后若 15m 重新跌回触发区且动量衰减，停止加仓；尾仓跟随 1H MA30。",
  };
}

function classification(record: FocusPoolRecord) {
  return record.classifications.length ? record.classifications.join(" + ") : "WATCHLIST_ONLY";
}

function stage(record: FocusPoolRecord) {
  return record.squeezeStage || record.trendStage || "WATCH";
}

function structuralLabel(event: FocusMa30Event) {
  if (event.eventType.endsWith("RECLAIM")) return `${event.timeframe} MA30 收回`;
  return `${event.timeframe} MA30 失守`;
}

export function buildFocusStructuralBark(record: FocusPoolRecord, event: FocusMa30Event, decision: FocusDecisionResult): FocusBarkMessage {
  const actionable = decision.state === "BUY_READY" || decision.state === "ADD_READY";
  const warning = event.eventType.endsWith("LOSS") ? "结构转弱，优先检查风险与失效条件。" : actionable
    ? `AI 已升级为 ${decision.state}。`
    : "结构改善，但 AI 尚未给出买入许可。";
  return {
    key: event.eventKey,
    title: `【重点监控】${record.symbol} ${structuralLabel(event)}`,
    group: "强势币结构雷达",
    body: [
      `${record.symbol}｜${classification(record)}｜方向：${record.bias}`,
      `Stage：${stage(record)}｜事件：${event.eventType}`,
      `AI：${decision.state}｜原因：${decision.reasonCodes.join(", ") || "—"}`,
      warning,
      "仅供研究与决策提醒，不自动下单。",
    ].join("\n"),
  };
}

export function buildFocusDecisionBark(record: FocusPoolRecord, decision: FocusDecisionResult, levels: ExecutionGuidance, candleCloseTime: number): FocusBarkMessage {
  const actionLabel = decision.state === "BUY_READY" ? "买入条件成立" : decision.state === "ADD_READY" ? "加仓条件成立" : decision.state;
  return {
    key: `focus:decision:${record.symbol}:${decision.state}:${candleCloseTime}`,
    title: `【AI重点机会】${record.symbol} ${actionLabel}`,
    group: "强势币结构雷达",
    body: [
      `${record.symbol}｜${classification(record)}｜方向：${record.bias}`,
      `Stage：${stage(record)}｜AI：${decision.state}`,
      `原因：${decision.reasonCodes.join(", ") || "—"}`,
      `A组｜回踩/二测入场区 ${levels.aEntryZone[0]}–${levels.aEntryZone[1]}｜止损/失效 ${levels.aStop}｜首段止盈/风险回收 ${levels.aTakeProfit}｜${levels.aContinuation}`,
      `B组｜确认/突破触发 ${levels.bTrigger}｜止损/失效 ${levels.bStop}｜首段止盈/风险回收 ${levels.bTakeProfit}｜${levels.bContinuation}`,
      "仓位大小按止损距离与风险预算推导；杠杆不设固定倍数；仅提醒，不自动下单。",
    ].join("\n"),
  };
}
