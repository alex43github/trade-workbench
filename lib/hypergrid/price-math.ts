import { normalizeAddress } from "./encoding.ts";
import type { PriceQuote } from "./types.ts";

const Q192 = BigInt(2) ** BigInt(192);
const DEFAULT_FRACTION_DIGITS = 80;

export type PriceMathInput = {
  sqrt_price_x96: bigint | string;
  decimals0: number;
  decimals1: number;
  token0: string;
  token1: string;
  source_block: number;
  source_block_hash: string | null;
  observed_at: string | null;
  max_fraction_digits?: number;
};

export type PriceQuotePair = {
  token1_per_token0: PriceQuote;
  token0_per_token1: PriceQuote;
};

export function formatRational(numerator: bigint, denominator: bigint, maxFractionDigits = DEFAULT_FRACTION_DIGITS): string {
  if (numerator < BigInt(0) || denominator <= BigInt(0)) throw new Error("rational values must be non-negative with positive denominator");
  if (!Number.isInteger(maxFractionDigits) || maxFractionDigits < 0 || maxFractionDigits > 200) {
    throw new Error("invalid fraction digit limit");
  }
  const integer = numerator / denominator;
  if (maxFractionDigits === 0) return integer.toString();
  const remainder = numerator % denominator;
  const scale = BigInt(10) ** BigInt(maxFractionDigits);
  let fraction = (remainder * scale * BigInt(2) + denominator) / (denominator * BigInt(2));
  let whole = integer;
  if (fraction >= scale) {
    whole += BigInt(1);
    fraction -= scale;
  }
  if (fraction === BigInt(0)) return whole.toString();
  const fractionText = fraction.toString().padStart(maxFractionDigits, "0").replace(/0+$/, "");
  return whole.toString() + "." + fractionText;
}

export function quoteFromSqrtPriceX96(input: PriceMathInput): PriceQuotePair {
  const sqrt = typeof input.sqrt_price_x96 === "bigint" ? input.sqrt_price_x96 : BigInt(input.sqrt_price_x96);
  if (sqrt <= BigInt(0)) throw new Error("sqrt price must be positive");
  validateDecimals(input.decimals0);
  validateDecimals(input.decimals1);
  const token0 = normalizeAddress(input.token0);
  const token1 = normalizeAddress(input.token1);
  const maxFractionDigits = input.max_fraction_digits ?? DEFAULT_FRACTION_DIGITS;
  const rawNumerator = sqrt * sqrt;
  const token1PerToken0Numerator = rawNumerator * (BigInt(10) ** BigInt(input.decimals0));
  const token1PerToken0Denominator = Q192 * (BigInt(10) ** BigInt(input.decimals1));
  const token0PerToken1Numerator = token1PerToken0Denominator;
  const token0PerToken1Denominator = token1PerToken0Numerator;
  const common = {
    source_block: input.source_block,
    source_block_hash: input.source_block_hash,
    observed_at: input.observed_at,
    verification_status: "OBSERVED" as const,
  };
  return {
    token1_per_token0: {
      ...common,
      base_token: token0,
      quote_token: token1,
      price: formatRational(token1PerToken0Numerator, token1PerToken0Denominator, maxFractionDigits),
      orientation: "TOKEN1_PER_TOKEN0",
    },
    token0_per_token1: {
      ...common,
      base_token: token1,
      quote_token: token0,
      price: formatRational(token0PerToken1Numerator, token0PerToken1Denominator, maxFractionDigits),
      orientation: "TOKEN0_PER_TOKEN1",
    },
  };
}

function validateDecimals(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error("decimals out of range");
}
