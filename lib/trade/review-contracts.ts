export const ORDER_SOURCES = [
  "TELEGRAM",
  "WEB",
  "ALEX",
  "BINANCE_NATIVE",
  "UNCLASSIFIED",
] as const;

export type OrderSource = typeof ORDER_SOURCES[number];
export type ReviewSide = "LONG" | "SHORT";
export type FillRole = "ENTRY" | "EXIT";
export type AttributionConfidence = "EXACT" | "UNCERTAIN" | "UNPAIRED";

export type ArchivedFill = {
  accountId?: string;
  orderId?: string | number;
  tradeId?: string | number;
  clientOrderId?: string | null;
  symbol: string;
  side: "BUY" | "SELL";
  positionSide?: "BOTH" | "LONG" | "SHORT";
  role: FillRole;
  quantity: number | string;
  price: number | string;
  time: number | string | Date;
  commission?: number | string | null;
  commissionAsset?: string | null;
  commissionInQuote?: number | string | null;
  commissionAmountInQuote?: number | string | null;
  funding?: number | string | null;
  fundingIncome?: number | string | null;
  fundingFee?: number | string | null;
  fundingAsset?: string | null;
  fundingIncomeInQuote?: number | string | null;
  fundingInQuote?: number | string | null;
  fundingAmountInQuote?: number | string | null;
  realizedPnl?: number | string | null;
  source?: OrderSource;
  confidence?: AttributionConfidence;
};

export type ReviewGroup = {
  id: string;
  symbol: string;
  side: ReviewSide;
  source: OrderSource;
  confidence: AttributionConfidence;
  timeframe?: string | null;
  fills: ArchivedFill[];
  status?: "OPEN" | "COMPLETE" | "UNPAIRED" | "INCOMPLETE";
};

export type AttributionInput = {
  source?: OrderSource | string | null;
  clientOrderId?: unknown;
  strategyId?: string | null;
  strategyGroupId?: string | null;
  manualReviewGroupId?: string | null;
  userCreatedReviewGroup?: boolean;
  nativeOrdersOverlap?: boolean;
  overlappingNativeOrders?: boolean;
  /** Legacy flags are retained for callers but are not auditable evidence. */
  directEvidence?: boolean;
  hasDirectEvidence?: boolean;
  hasDirectRealizedPnl?: boolean;
  exchangeRealizedPnl?: number | string | null;
  /** Stable reference to an independently stored fill/order/PnL linkage. */
  directEvidenceId?: string | number | null;
};

function normalizedClientOrderId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedSource(value: unknown): OrderSource | null {
  const source = String(value ?? "").trim().toUpperCase();
  if (source === "TELE" || source === "TELEGRAM") return "TELEGRAM";
  if (source === "WEB") return "WEB";
  if (source === "ALEX") return "ALEX";
  if (source === "RAW" || source === "BINANCE_NATIVE") return "BINANCE_NATIVE";
  if (source === "UNCLASSIFIED") return "UNCLASSIFIED";
  return null;
}

/** Classify only evidence present in Binance's original client order id. */
export function classifyOrderSource(clientOrderId: unknown): OrderSource {
  const value = normalizedClientOrderId(clientOrderId);
  if (!value) return "UNCLASSIFIED";
  if (value.toLowerCase().startsWith("tele")) return "TELEGRAM";
  if (value.toLowerCase().startsWith("web")) return "WEB";
  if (value.toLowerCase().startsWith("alex")) return "ALEX";
  return "BINANCE_NATIVE";
}

function normalizedReference(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value).trim();
  return "";
}

function hasAuditableDirectEvidence(input: AttributionInput): boolean {
  return Boolean(normalizedReference(input.directEvidenceId));
}

function strategyIdentifier(input: AttributionInput): string {
  return String(input.strategyId ?? input.strategyGroupId ?? "").trim();
}

/** Return exact only when the order-to-review relationship is independently verifiable. */
export function attributionConfidence(input: AttributionInput): AttributionConfidence {
  const classifiedSource = classifyOrderSource(input.clientOrderId);
  const source = classifiedSource === "UNCLASSIFIED"
    ? normalizedSource(input.source) ?? classifiedSource
    : classifiedSource;
  const strategyId = strategyIdentifier(input);
  const hasStrategyEvidence = /^TW-L-S-[A-Z0-9-]+$/i.test(strategyId);
  const manualReviewGroupId = normalizedReference(input.manualReviewGroupId);
  const explicitlyGrouped = Boolean(manualReviewGroupId) && input.userCreatedReviewGroup !== false;
  const overlaps = input.nativeOrdersOverlap === true || input.overlappingNativeOrders === true;

  if (explicitlyGrouped) return "EXACT";
  if ((source === "TELEGRAM" || source === "WEB") && hasStrategyEvidence) return "EXACT";
  if ((source === "ALEX" || source === "BINANCE_NATIVE") && hasAuditableDirectEvidence(input)) return "EXACT";
  if (source === "BINANCE_NATIVE" && overlaps) return "UNPAIRED";
  return "UNCERTAIN";
}
