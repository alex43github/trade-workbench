import type { FocusBias, FocusMa30Relation } from "./focus-pool.ts";

export type FocusMa30Timeframe = "5m" | "15m" | "1h";
export type FocusMa30EventType = "15M_MA30_RECLAIM" | "15M_MA30_LOSS" | "1H_MA30_RECLAIM" | "1H_MA30_LOSS";
export type FocusMa30Event = {
  symbol: string;
  timeframe: "15m" | "1h";
  candleCloseTime: number;
  eventType: FocusMa30EventType;
  eventKey: string;
  previousRelation: FocusMa30Relation;
  currentRelation: FocusMa30Relation;
};

type Bar = { close: number; time: number; closed?: boolean };

type DetectInput = {
  symbol: string;
  timeframe: FocusMa30Timeframe;
  bias: FocusBias;
  previousBar: Bar;
  currentBar: Bar;
  previousMa30: number;
  currentMa30: number;
  lastEventKey?: string | null;
};

export function ma30Relation(close: number, ma30: number): FocusMa30Relation {
  if (!Number.isFinite(close) || !Number.isFinite(ma30)) return "UNKNOWN";
  if (close > ma30) return "ABOVE";
  if (close < ma30) return "BELOW";
  return "AT";
}

function eventType(timeframe: "15m" | "1h", kind: "RECLAIM" | "LOSS"): FocusMa30EventType {
  return `${timeframe === "15m" ? "15M" : "1H"}_MA30_${kind}` as FocusMa30EventType;
}

export function detectFocusMa30Event(input: DetectInput): FocusMa30Event | null {
  if (input.bias !== "LONG" || (input.timeframe !== "15m" && input.timeframe !== "1h")) return null;
  if (input.previousBar.closed === false || input.currentBar.closed === false) return null;
  if (!Number.isFinite(input.currentBar.time) || input.currentBar.time <= 0) return null;

  const previousRelation = ma30Relation(input.previousBar.close, input.previousMa30);
  const currentRelation = ma30Relation(input.currentBar.close, input.currentMa30);
  if (previousRelation === "UNKNOWN" || currentRelation === "UNKNOWN") return null;

  let kind: "RECLAIM" | "LOSS" | null = null;
  if ((previousRelation === "BELOW" || previousRelation === "AT") && currentRelation === "ABOVE") kind = "RECLAIM";
  else if ((previousRelation === "ABOVE" || previousRelation === "AT") && currentRelation === "BELOW") kind = "LOSS";
  if (!kind) return null;

  const type = eventType(input.timeframe, kind);
  const symbol = input.symbol.trim().toUpperCase();
  const eventKey = `ma30:${symbol}:${input.timeframe}:${input.currentBar.time}:${type}`;
  if (input.lastEventKey === eventKey) return null;

  return {
    symbol,
    timeframe: input.timeframe,
    candleCloseTime: input.currentBar.time,
    eventType: type,
    eventKey,
    previousRelation,
    currentRelation,
  };
}
