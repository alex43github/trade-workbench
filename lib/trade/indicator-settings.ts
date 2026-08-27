import { isBinanceFuturesSymbol } from "./symbols.ts";

export type LineWidth = 1 | 2 | 3 | 4;

export type VegasIndicatorSettings = {
  enabled: boolean;
  fastLength: number;
  slowLength: number;
  outerFastLength: number;
  outerSlowLength: number;
  firstColor: string;
  secondColor: string;
  lineWidth: LineWidth;
};

export type PersistedIndicatorSettings = {
  symbol: string;
  basis: "ma" | "ema";
  maLength: number;
  entryAtrUpper: number;
  entryAtrLower: number;
  atr: {
    upperColor: string;
    lowerColor: string;
    upperLineWidth: LineWidth;
    lowerLineWidth: LineWidth;
  };
  vegas: VegasIndicatorSettings;
};

export const defaultPersistedIndicatorSettings = {
  basis: "ma" as const,
  maLength: 30,
  entryAtrUpper: 1,
  entryAtrLower: 1,
  atr: {
    upperColor: "#111827",
    lowerColor: "#111827",
    upperLineWidth: 1 as LineWidth,
    lowerLineWidth: 1 as LineWidth,
  },
  vegas: {
    enabled: true,
    fastLength: 144,
    slowLength: 169,
    outerFastLength: 576,
    outerSlowLength: 676,
    firstColor: "#f59e0b",
    secondColor: "#ec4899",
    lineWidth: 2 as LineWidth,
  },
};

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function lineWidth(value: unknown, fallback: LineWidth): LineWidth {
  const parsed = Math.round(numberInRange(value, fallback, 1, 4));
  return parsed as LineWidth;
}

function color(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

export function normalizeIndicatorSettings(symbolInput: unknown, input: unknown): PersistedIndicatorSettings | null {
  const symbol = String(symbolInput || "").trim().toUpperCase();
  if (!isBinanceFuturesSymbol(symbol)) return null;
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const atr = source.atr && typeof source.atr === "object" && !Array.isArray(source.atr) ? source.atr as Record<string, unknown> : {};
  const vegas = source.vegas && typeof source.vegas === "object" && !Array.isArray(source.vegas) ? source.vegas as Record<string, unknown> : {};
  return {
    symbol,
    basis: source.basis === "ema" ? "ema" : "ma",
    maLength: Math.round(numberInRange(source.maLength, defaultPersistedIndicatorSettings.maLength, 2, 500)),
    entryAtrUpper: numberInRange(source.entryAtrUpper, defaultPersistedIndicatorSettings.entryAtrUpper, 0, 20),
    entryAtrLower: numberInRange(source.entryAtrLower, defaultPersistedIndicatorSettings.entryAtrLower, 0, 20),
    atr: {
      upperColor: color(atr.upperColor, defaultPersistedIndicatorSettings.atr.upperColor),
      lowerColor: color(atr.lowerColor, defaultPersistedIndicatorSettings.atr.lowerColor),
      upperLineWidth: lineWidth(atr.upperLineWidth, defaultPersistedIndicatorSettings.atr.upperLineWidth),
      lowerLineWidth: lineWidth(atr.lowerLineWidth, defaultPersistedIndicatorSettings.atr.lowerLineWidth),
    },
    vegas: {
      enabled: vegas.enabled !== false,
      fastLength: Math.round(numberInRange(vegas.fastLength, defaultPersistedIndicatorSettings.vegas.fastLength, 2, 2_000)),
      slowLength: Math.round(numberInRange(vegas.slowLength, defaultPersistedIndicatorSettings.vegas.slowLength, 2, 2_000)),
      outerFastLength: Math.round(numberInRange(vegas.outerFastLength, defaultPersistedIndicatorSettings.vegas.outerFastLength, 2, 2_000)),
      outerSlowLength: Math.round(numberInRange(vegas.outerSlowLength, defaultPersistedIndicatorSettings.vegas.outerSlowLength, 2, 2_000)),
      firstColor: color(vegas.firstColor, defaultPersistedIndicatorSettings.vegas.firstColor),
      secondColor: color(vegas.secondColor, defaultPersistedIndicatorSettings.vegas.secondColor),
      lineWidth: lineWidth(vegas.lineWidth, defaultPersistedIndicatorSettings.vegas.lineWidth),
    },
  };
}
