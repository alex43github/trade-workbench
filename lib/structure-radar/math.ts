import type { ClosedBar, IndexedPrice } from "./types.ts";

const BAR_NUMBERS = ["time", "open", "high", "low", "close", "volume"] as const;

export function validateClosedBars<T extends ClosedBar>(bars: readonly T[]): readonly T[] {
  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar.closed !== true) throw new Error(`bar ${index} must be closed`);
    for (const field of BAR_NUMBERS) {
      if (!Number.isFinite(bar[field])) throw new Error(`bar ${index} ${field} must be finite`);
    }
    if (bar.time <= 0 || bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) {
      throw new Error(`bar ${index} prices and time must be positive`);
    }
    if (bar.volume < 0) throw new Error(`bar ${index} volume must be nonnegative`);
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high) {
      throw new Error(`bar ${index} OHLC range is invalid`);
    }
    if (index > 0 && bar.time <= bars[index - 1].time) {
      throw new Error("bars must be strictly ascending by time");
    }
  }
  return bars;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median requires at least one value");
  if (values.some((value) => !Number.isFinite(value))) throw new Error("median values must be finite");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

export function atr(bars: readonly ClosedBar[], period = 14): number {
  validateClosedBars(bars);
  if (!Number.isInteger(period) || period < 1) throw new Error("ATR period must be a positive integer");
  if (bars.length === 0) throw new Error("ATR requires at least one bar");
  const start = Math.max(0, bars.length - period);
  const ranges = bars.slice(start).map((bar, offset) => {
    const index = start + offset;
    if (index === 0) return bar.high - bar.low;
    const previousClose = bars[index - 1].close;
    return Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose));
  });
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

export function confirmedPivotHighs(
  bars: readonly ClosedBar[],
  leftBars = 2,
  rightBars = 3,
): IndexedPrice[] {
  validateClosedBars(bars);
  if (!Number.isInteger(leftBars) || leftBars < 1 || !Number.isInteger(rightBars) || rightBars < 1) {
    throw new Error("pivot widths must be positive integers");
  }
  const pivots: IndexedPrice[] = [];
  for (let index = leftBars; index < bars.length - rightBars; index += 1) {
    const high = bars[index].high;
    const leftConfirmed = bars.slice(index - leftBars, index).every((bar) => high > bar.high);
    const rightConfirmed = bars.slice(index + 1, index + rightBars + 1).every((bar) => high >= bar.high);
    if (leftConfirmed && rightConfirmed) {
      pivots.push({ index, time: bars[index].time, price: high });
    }
  }
  return pivots;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("canonical values must be finite");
  if (["bigint", "function", "symbol"].includes(typeof value)) throw new Error("unsupported canonical value");
  return value;
}

export async function canonicalHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalize(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
