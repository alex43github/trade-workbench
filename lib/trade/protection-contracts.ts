export type ProtectionOrigin = "ALEX" | "TELEGRAM" | "WEB";
export type ProtectionSide = "LONG" | "SHORT";
export type ProtectionPositionSide = "BOTH" | ProtectionSide;
export type ProtectionKind = "TP" | "SL";
export type ProtectionStrategyType = "DEFAULT_TP" | "FIXED_TP" | "MA_SL" | "LEVEL_SL";

export type ProtectionPosition = {
  candidateId: string;
  /** Stable source batch identifier. Different partial fills of one entry order must not share a guard quantity. */
  sourceFillId?: string;
  symbol: string;
  side: ProtectionSide;
  quantity: number;
  entryPrice: number;
  markPrice: number;
  leverage: number;
  sourceOrderIds: string[];
  /** Local ownership aliases; Binance's original client order ids remain unchanged. */
  manualAliasIds?: string[];
  totalQuantity?: number;
  totalNotional?: number;
  totalMargin?: number;
  otherQuantity?: number;
  otherNotional?: number;
  otherMargin?: number;
  manualNotional?: number;
  manualMargin?: number;
  reconciliationRequired?: boolean;
};

export type ProtectionMarketConfig = {
  ma: { kind: "SMA" | "EMA"; length: number };
  atr: { length: number };
  atrMultiplier: number;
};

export type ProtectionOrderPlan = {
  strategyId: string;
  origin: ProtectionOrigin;
  symbol: string;
  side: "BUY" | "SELL";
  /** BOTH for one-way mode, or the matching LONG/SHORT side for Hedge Mode. */
  positionSide: ProtectionPositionSide;
  type: "MARKET" | "TAKE_PROFIT_MARKET" | "STOP_MARKET";
  quantity: string;
  stopPrice?: string;
  reduceOnly: true;
  newClientOrderId: string;
  stage: string;
};
