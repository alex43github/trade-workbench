import type { PriceFormatCustom } from "lightweight-charts";

export type PriceFormatMode = "full" | "axis";

const FALLBACK_PRICE_STEP = 0.01;
const MAX_DECIMAL_PLACES = 12;

type ExchangeInfoPayload = {
  symbols?: Array<{
    symbol?: unknown;
    filters?: Array<{ filterType?: unknown; tickSize?: unknown }>;
  }>;
};

function decimalPlacesForNumber(value: number) {
  const text = Math.abs(value).toString().toLowerCase();
  const [coefficient, exponentText] = text.split("e");
  const fractionLength = coefficient.split(".")[1]?.length ?? 0;
  const exponent = exponentText ? Number(exponentText) : 0;
  return Math.max(0, Math.min(MAX_DECIMAL_PLACES, fractionLength - exponent));
}

export function decimalPlacesForStep(step: number) {
  if (!Number.isFinite(step) || step <= 0) return decimalPlacesForNumber(FALLBACK_PRICE_STEP);
  return decimalPlacesForNumber(step);
}

export function inferPriceStep(values: readonly number[], explicitStep?: number) {
  if (Number.isFinite(explicitStep) && explicitStep !== undefined && explicitStep > 0) return explicitStep;
  let decimalPlaces = 0;
  let hasPrice = false;
  for (const value of values) {
    if (!Number.isFinite(value) || value <= 0) continue;
    hasPrice = true;
    decimalPlaces = Math.max(decimalPlaces, decimalPlacesForNumber(value));
  }
  return hasPrice ? 10 ** -decimalPlaces : FALLBACK_PRICE_STEP;
}

export function resolvePriceTickSize(payload: unknown, symbol: string) {
  if (!payload || typeof payload !== "object") return null;
  const symbols = (payload as ExchangeInfoPayload).symbols;
  if (!Array.isArray(symbols)) return null;
  const exchangeSymbol = symbols.find((item) => item && typeof item === "object" && item.symbol === symbol);
  const filters = exchangeSymbol?.filters;
  if (!Array.isArray(filters)) return null;
  const priceFilter = filters.find((filter) => filter && typeof filter === "object" && filter.filterType === "PRICE_FILTER");
  const tickSize = Number.parseFloat(String(priceFilter?.tickSize ?? ""));
  return Number.isFinite(tickSize) && tickSize > 0 ? tickSize : null;
}

function fixedPrice(value: number, step: number) {
  const precision = decimalPlacesForStep(step);
  return value.toLocaleString("en-US", {
    useGrouping: true,
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

function compactAxisPrice(value: number) {
  return value.toExponential(5)
    .replace(/\.?0+e/, "e")
    .replace("e+", "e");
}

function shouldCompactAxisPrice(value: number, fixed: string) {
  if (value <= 0 || value >= 1) return false;
  const plain = fixed.replaceAll(",", "");
  const fractional = plain.split(".")[1] ?? "";
  const leadingZeros = fractional.match(/^0+/)?.[0].length ?? 0;
  return leadingZeros >= 4 || plain.length > 12;
}

export function formatPrice(value: number, step: number, mode: PriceFormatMode = "full") {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const fixed = fixedPrice(value, step);
  return mode === "axis" && shouldCompactAxisPrice(value, fixed) ? compactAxisPrice(value) : fixed;
}

export function createPriceFormat(step: number): PriceFormatCustom {
  const safeStep = Number.isFinite(step) && step > 0 ? step : FALLBACK_PRICE_STEP;
  return {
    type: "custom",
    minMove: safeStep,
    formatter: (value) => formatPrice(value, safeStep, "axis"),
    tickmarksFormatter: (values) => values.map((value) => formatPrice(value, safeStep, "axis")),
  };
}
