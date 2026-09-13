import type {
  ArchivedFill,
  AttributionConfidence,
  FillRole,
  ReviewSide,
} from "./review-contracts.ts";

export type ReviewMetricsInput = {
  confidence: AttributionConfidence;
  side?: ReviewSide;
  fills?: ArchivedFill[];
  quoteAsset?: string | null;
  commission?: number | string | null;
  commissionAsset?: string | null;
  commissionInQuote?: number | string | null;
  commissionAmountInQuote?: number | string | null;
  fundingIncome?: number | string | null;
  /** Signed funding income: income is positive and cost is negative. */
  funding?: number | string | null;
  /** Kept as an input alias, with the same signed-income semantics as funding. */
  fundingFee?: number | string | null;
  fundingAsset?: string | null;
  fundingIncomeInQuote?: number | string | null;
  fundingInQuote?: number | string | null;
  fundingAmountInQuote?: number | string | null;
};

export type ReviewMetrics = {
  sampleStatus: "COMPLETE" | "样本不足";
  isComplete: boolean;
  confidence: AttributionConfidence | null;
  entryVwap: number | null;
  exitVwap: number | null;
  grossPnl: number | null;
  commission: number | null;
  /** Signed funding income: income is positive and cost is negative. */
  fundingIncome: number | null;
  /** Backward-compatible alias for fundingIncome. */
  funding: number | null;
  netPnl: number | null;
  holdingDurationMs: number | null;
  durationMs: number | null;
  outcome: "WIN" | "LOSS" | "BREAKEVEN" | null;
  sampleSize: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
};

type FillLike = Partial<ArchivedFill> & Record<string, unknown>;
type PresentNumber = { present: boolean; value: number | null };

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function readPresent(record: Record<string, unknown>, names: string[]): PresentNumber {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(record, name)) {
      return { present: true, value: finiteNumber(record[name]) };
    }
  }
  return { present: false, value: null };
}

function fillValue(fill: Record<string, unknown>, names: string[]): number | null {
  return readPresent(fill, names).value;
}

function fillsForRole(fills: FillLike[], role: FillRole): FillLike[] {
  return fills.filter((fill) => fill.role === role);
}

function fillQuantity(fill: Record<string, unknown>): number | null {
  return fillValue(fill, ["quantity", "qty", "executedQty"]);
}

function fillPrice(fill: Record<string, unknown>): number | null {
  return fillValue(fill, ["price", "fillPrice"]);
}

function fillTimestamp(fill: Record<string, unknown>): number | null {
  const raw = fill.time ?? fill.timestamp ?? fill.transactTime ?? fill.executedAt;
  if (raw instanceof Date) {
    const value = raw.getTime();
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? raw : null;
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
      const value = Number(trimmed);
      return Number.isFinite(value) && value >= 0 ? value : null;
    }
    const value = Date.parse(trimmed);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  return null;
}

export type ReviewResultStatistics = {
  sampleSize: number;
  wins: number;
  losses: number;
  breakeven: number;
  winRate: number | null;
  averageWin: number | null;
  averageLoss: number | null;
  profitFactor: number | null;
  expectancy: number | null;
};

function resultStatistics(results: number[]): ReviewResultStatistics {
  const wins = results.filter((value) => value > 0);
  const losses = results.filter((value) => value < 0);
  const breakeven = results.length - wins.length - losses.length;
  const grossWins = wins.reduce((total, value) => total + value, 0);
  const grossLosses = losses.reduce((total, value) => total + Math.abs(value), 0);
  return {
    sampleSize: results.length,
    wins: wins.length,
    losses: losses.length,
    breakeven,
    winRate: wins.length + losses.length > 0 ? wins.length / (wins.length + losses.length) * 100 : null,
    averageWin: wins.length > 0 ? grossWins / wins.length : null,
    averageLoss: losses.length > 0 ? -grossLosses / losses.length : null,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : null,
    expectancy: results.length > 0 ? results.reduce((total, value) => total + value, 0) / results.length : null,
  };
}

/** Calculate aggregate result statistics without asserting that a review group is complete. */
export function reviewResultStatistics(results: Array<number | string | null | undefined>): ReviewResultStatistics {
  const normalized = results
    .map((value) => finiteNumber(value))
    .filter((value): value is number => value !== null);
  return resultStatistics(normalized);
}

function emptyMetrics(confidence: AttributionConfidence | null): ReviewMetrics {
  return {
    sampleStatus: "样本不足",
    isComplete: false,
    confidence,
    entryVwap: null,
    exitVwap: null,
    grossPnl: null,
    commission: null,
    fundingIncome: null,
    funding: null,
    netPnl: null,
    holdingDurationMs: null,
    durationMs: null,
    outcome: null,
    ...resultStatistics([]),
  };
}

function normalizedAsset(value: unknown, fallback: string): string {
  const asset = String(value ?? "").trim().toUpperCase();
  return asset || fallback;
}

function quoteAsset(input: ReviewMetricsInput): string {
  return normalizedAsset(input.quoteAsset, "USDT");
}

function resolveCommission(input: ReviewMetricsInput, fills: FillLike[], quote: string): number | null {
  const inputRecord = input as unknown as Record<string, unknown>;
  const converted = readPresent(inputRecord, ["commissionInQuote", "commissionAmountInQuote"]);
  if (converted.present) return converted.value;

  const aggregate = readPresent(inputRecord, ["commission"]);
  if (aggregate.present) {
    if (aggregate.value === null) return null;
    return normalizedAsset(inputRecord.commissionAsset, quote) === quote ? aggregate.value : null;
  }

  let total = 0;
  for (const fill of fills) {
    const convertedFill = readPresent(fill, ["commissionInQuote", "commissionAmountInQuote"]);
    if (convertedFill.present) {
      if (convertedFill.value === null) return null;
      total += convertedFill.value;
      continue;
    }

    const commission = readPresent(fill, ["commission", "fee"]);
    if (!commission.present || commission.value === null) return null;
    const asset = normalizedAsset(fill.commissionAsset, normalizedAsset(inputRecord.commissionAsset, quote));
    if (asset !== quote) return null;
    total += commission.value;
  }
  return total;
}

/** Resolve a signed funding amount; positive is income and negative is cost. */
function resolveFundingIncome(input: ReviewMetricsInput, fills: FillLike[], quote: string): number | null {
  const inputRecord = input as unknown as Record<string, unknown>;
  const converted = readPresent(inputRecord, [
    "fundingIncomeInQuote",
    "fundingInQuote",
    "fundingAmountInQuote",
  ]);
  if (converted.present) return converted.value;

  const aggregate = readPresent(inputRecord, ["fundingIncome", "funding", "fundingFee"]);
  if (aggregate.present) {
    if (aggregate.value === null) return null;
    return normalizedAsset(inputRecord.fundingAsset, quote) === quote ? aggregate.value : null;
  }

  let total = 0;
  for (const fill of fills) {
    const convertedFill = readPresent(fill, [
      "fundingIncomeInQuote",
      "fundingInQuote",
      "fundingAmountInQuote",
    ]);
    if (convertedFill.present) {
      if (convertedFill.value === null) return null;
      total += convertedFill.value;
      continue;
    }

    const funding = readPresent(fill, ["fundingIncome", "funding", "fundingFee"]);
    if (!funding.present || funding.value === null) return null;
    const asset = normalizedAsset(fill.fundingAsset, normalizedAsset(inputRecord.fundingAsset, quote));
    if (asset !== quote) return null;
    total += funding.value;
  }
  return total;
}

/** Calculate a quantity-weighted price. Any malformed fill invalidates the whole VWAP. */
export function weightedAveragePrice(fills: Array<Pick<ArchivedFill, "quantity" | "price"> | FillLike>): number | null {
  if (fills.length === 0) return null;
  let quantityTotal = 0;
  let notionalTotal = 0;
  for (const fill of fills) {
    if (!isRecord(fill)) return null;
    const quantity = fillQuantity(fill);
    const price = fillPrice(fill);
    if (quantity === null || price === null || quantity <= 0 || price <= 0) return null;
    quantityTotal += quantity;
    notionalTotal += quantity * price;
  }
  return quantityTotal > 0 ? notionalTotal / quantityTotal : null;
}

export function reviewMetrics(input: ReviewMetricsInput): ReviewMetrics {
  const confidence = input?.confidence ?? null;
  if (confidence !== "EXACT") return emptyMetrics(confidence);

  const rawFills = input?.fills;
  if (!Array.isArray(rawFills) || rawFills.length === 0 || !rawFills.every(isRecord)) {
    return emptyMetrics(confidence);
  }
  const fills = rawFills as FillLike[];
  if (fills.some((fill) => fill.role !== "ENTRY" && fill.role !== "EXIT")) return emptyMetrics(confidence);
  if (fills.some((fill) => {
    const quantity = fillQuantity(fill);
    const price = fillPrice(fill);
    return quantity === null || quantity <= 0 || price === null || price <= 0;
  })) return emptyMetrics(confidence);

  const entries = fillsForRole(fills, "ENTRY");
  const exits = fillsForRole(fills, "EXIT");
  if (entries.length === 0 || exits.length === 0) return emptyMetrics(confidence);

  const entryQuantity = entries.reduce((total, fill) => total + (fillQuantity(fill) as number), 0);
  const exitQuantity = exits.reduce((total, fill) => total + (fillQuantity(fill) as number), 0);
  if (Math.abs(entryQuantity - exitQuantity) > 1e-9) return emptyMetrics(confidence);

  const entryVwap = weightedAveragePrice(entries);
  const exitVwap = weightedAveragePrice(exits);
  if (entryVwap === null || exitVwap === null) return emptyMetrics(confidence);

  const entryTimes = entries.map(fillTimestamp);
  const exitTimes = exits.map(fillTimestamp);
  if (entryTimes.some((value) => value === null) || exitTimes.some((value) => value === null)) {
    return emptyMetrics(confidence);
  }
  const firstEntryAt = Math.min(...(entryTimes as number[]));
  if ((exitTimes as number[]).some((value) => value < firstEntryAt)) return emptyMetrics(confidence);
  const lastExitAt = Math.max(...(exitTimes as number[]));
  if (lastExitAt < firstEntryAt) return emptyMetrics(confidence);

  const quote = quoteAsset(input);
  const commission = resolveCommission(input, fills, quote);
  const fundingIncome = resolveFundingIncome(input, fills, quote);
  if (commission === null || fundingIncome === null) return emptyMetrics(confidence);

  const realizedValues = exits.map((fill) => readPresent(fill, ["realizedPnl", "realisedPnl"]));
  const hasAnyRealizedPnl = realizedValues.some((item) => item.value !== null);
  const hasCompleteRealizedPnl = realizedValues.every((item) => item.present && item.value !== null);
  if (hasAnyRealizedPnl && !hasCompleteRealizedPnl) return emptyMetrics(confidence);
  const grossPnl = hasCompleteRealizedPnl
    ? realizedValues.reduce((total, item) => total + (item.value as number), 0)
    : (input.side ?? (entries[0].side === "SELL" ? "SHORT" : "LONG")) === "SHORT"
      ? (entryVwap - exitVwap) * exitQuantity
      : (exitVwap - entryVwap) * exitQuantity;
  const netPnl = grossPnl - commission + fundingIncome;
  const holdingDurationMs = lastExitAt - firstEntryAt;
  const outcome = netPnl > 0 ? "WIN" : netPnl < 0 ? "LOSS" : "BREAKEVEN";
  const stats = resultStatistics([netPnl]);

  return {
    sampleStatus: "COMPLETE",
    isComplete: true,
    confidence,
    entryVwap,
    exitVwap,
    grossPnl,
    commission,
    fundingIncome,
    funding: fundingIncome,
    netPnl,
    holdingDurationMs,
    durationMs: holdingDurationMs,
    outcome,
    ...stats,
  };
}
