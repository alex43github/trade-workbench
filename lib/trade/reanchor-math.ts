export type ReanchorTimeframe = "15m" | "1h" | "4h" | "1d";
export type ReanchorSide = "LONG" | "SHORT";

type SupportedTimeframe = {
  intervalMs: number;
  subsequentCloses: number;
};

const SUPPORTED_TIMEFRAMES: Record<ReanchorTimeframe, SupportedTimeframe> = {
  "15m": { intervalMs: 15 * 60 * 1000, subsequentCloses: 1 },
  "1h": { intervalMs: 60 * 60 * 1000, subsequentCloses: 1 },
  "4h": { intervalMs: 4 * 60 * 60 * 1000, subsequentCloses: 1 },
  "1d": { intervalMs: 24 * 60 * 60 * 1000, subsequentCloses: 1 },
};

function finiteNumber(value: number, label: string) {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

function nonNegative(value: number, label: string) {
  finiteNumber(value, label);
  if (value < 0) throw new Error(`${label} must be non-negative`);
  return value;
}

function positive(value: number, label: string) {
  finiteNumber(value, label);
  if (value <= 0) throw new Error(`${label} must be positive`);
  return value;
}

type Decimal = {
  coefficient: bigint;
  scale: number;
};

function decimal(value: number, label: string): Decimal {
  finiteNumber(value, label);
  const normalized = Number(value.toPrecision(15)).toString().toLowerCase();
  const [coefficientText, exponentText] = normalized.split("e");
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  const [whole, fraction = ""] = coefficientText.split(".");
  const coefficientTextWithoutPoint = `${whole}${fraction}`;
  const scale = Math.max(0, fraction.length - exponent);
  const shiftedCoefficient = BigInt(coefficientTextWithoutPoint) * BigInt(10) ** BigInt(Math.max(0, exponent - fraction.length));
  return { coefficient: shiftedCoefficient, scale };
}

function atScale(value: Decimal, scale: number) {
  return value.coefficient * BigInt(10) ** BigInt(scale - value.scale);
}

function decimalNumber(coefficient: bigint, scale: number) {
  return Number(coefficient) / 10 ** scale;
}

function integerTimestamp(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer timestamp`);
  return value;
}

function roundToTick(value: number, tickSize: number) {
  const normalizedValue = decimal(value, "price");
  const normalizedTick = decimal(positive(tickSize, "tick size"), "tick size");
  const scale = Math.max(normalizedValue.scale, normalizedTick.scale);
  const valueAtScale = atScale(normalizedValue, scale);
  const tickAtScale = atScale(normalizedTick, scale);
  const quotient = valueAtScale / tickAtScale;
  const remainder = valueAtScale % tickAtScale;
  const roundedUnits = remainder * BigInt(2) >= tickAtScale ? quotient + BigInt(1) : quotient;
  return decimalNumber(roundedUnits * tickAtScale, scale);
}

function floorToStep(value: number, stepSize: number) {
  const normalizedValue = decimal(value, "quantity");
  const normalizedStep = decimal(positive(stepSize, "step size"), "step size");
  const scale = Math.max(normalizedValue.scale, normalizedStep.scale);
  const valueAtScale = atScale(normalizedValue, scale);
  const stepAtScale = atScale(normalizedStep, scale);
  const units = valueAtScale / stepAtScale;
  return decimalNumber(units * stepAtScale, scale);
}

export function refreshCadence(timeframe: string): number | null {
  return SUPPORTED_TIMEFRAMES[timeframe as ReanchorTimeframe]?.subsequentCloses ?? null;
}

export type ReanchorDueInput = {
  timeframe: string;
  anchorCandleOpenTime: number;
  latestClosedCandleOpenTime: number;
};

export function isReanchorDue(input: ReanchorDueInput): boolean {
  const timeframe = SUPPORTED_TIMEFRAMES[input.timeframe as ReanchorTimeframe];
  if (!timeframe) return false;

  const anchor = integerTimestamp(input.anchorCandleOpenTime, "anchor candle open time");
  const latest = integerTimestamp(input.latestClosedCandleOpenTime, "latest closed candle open time");
  if (latest <= anchor) return false;

  const elapsed = latest - anchor;
  if (elapsed % timeframe.intervalMs !== 0) return false;
  return elapsed >= timeframe.intervalMs * timeframe.subsequentCloses;
}

export type RemainingTargetQuantityInput = {
  targetQuantity: number;
  executedQuantity: number;
};

const EXECUTED_QUANTITY_EXCEEDS_TARGET = "EXECUTED_QUANTITY_EXCEEDS_TARGET" as const;

export function remainingTargetQuantity({ targetQuantity, executedQuantity }: RemainingTargetQuantityInput): number {
  nonNegative(targetQuantity, "target quantity");
  nonNegative(executedQuantity, "executed quantity");
  const normalizedTarget = decimal(targetQuantity, "target quantity");
  const normalizedExecuted = decimal(executedQuantity, "executed quantity");
  const scale = Math.max(normalizedTarget.scale, normalizedExecuted.scale);
  const difference = atScale(normalizedTarget, scale) - atScale(normalizedExecuted, scale);
  if (difference < BigInt(0)) {
    const error = new Error("executed quantity exceeds target quantity") as Error & { code: typeof EXECUTED_QUANTITY_EXCEEDS_TARGET };
    error.code = EXECUTED_QUANTITY_EXCEEDS_TARGET;
    throw error;
  }
  return decimalNumber(difference, scale);
}

export type OrderSignatureInput = {
  side: ReanchorSide;
  price: number;
  quantity: number;
  tickSize: number;
  stepSize: number;
};

export function orderSignature({ side, price, quantity, tickSize, stepSize }: OrderSignatureInput): string {
  if (side !== "LONG" && side !== "SHORT") throw new Error("side must be LONG or SHORT");
  const normalizedPrice = roundToTick(positive(price, "price"), tickSize);
  const normalizedQuantity = floorToStep(positive(quantity, "quantity"), stepSize);
  if (normalizedPrice <= 0 || normalizedQuantity <= 0) throw new Error("normalized order values must be positive");
  return `${side}|${normalizedPrice}|${normalizedQuantity}`;
}

export type Fill = {
  price: number;
  quantity: number;
};

export function weightedAverage(fills: readonly Fill[]): number {
  if (fills.length === 0) throw new Error("weighted average requires at least one fill");

  let totalQuantity = 0;
  let totalNotional = 0;
  for (const fill of fills) {
    const price = positive(fill.price, "fill price");
    const quantity = positive(fill.quantity, "fill quantity");
    totalQuantity += quantity;
    totalNotional += price * quantity;
  }
  return totalNotional / totalQuantity;
}
