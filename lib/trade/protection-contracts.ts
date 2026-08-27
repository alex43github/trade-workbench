export type ProtectionOrigin = "ALEX" | "TELEGRAM" | "WEB";
export type ProtectionSide = "LONG" | "SHORT";
export type ProtectionKind = "TP" | "SL";
export type ProtectionStrategyType = "DEFAULT_TP" | "FIXED_TP" | "MA_SL" | "LEVEL_SL";

export type ProtectionPosition = {
  candidateId: string;
  symbol: string;
  side: ProtectionSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  sourceOrderIds: string[];
};

export type ProtectionOrderPlan = {
  strategyId: string;
  origin: ProtectionOrigin;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide: ProtectionSide;
  type: "MARKET" | "TAKE_PROFIT_MARKET" | "STOP_MARKET";
  quantity: string;
  stopPrice?: string;
  reduceOnly: true;
  newClientOrderId: string;
  stage: string;
};
