export type PositionMode = "HEDGE" | "ONE_WAY";
export type EntryDirection = "LONG" | "SHORT";
export type BinancePositionSide = "BOTH" | "LONG" | "SHORT";

type PositionRiskRow = { positionSide?: unknown };

export type PositionRiskRowLike = {
  symbol?: unknown;
  positionSide?: unknown;
  positionAmt?: unknown;
  [key: string]: unknown;
};

/** Infer the account-wide Futures position mode from Binance position-risk rows. */
export function resolvePositionMode(rows: readonly PositionRiskRow[]): PositionMode {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("无法读取 Binance 持仓模式");
  const sides = new Set(
    rows
      .map((row) => String(row?.positionSide ?? "").trim().toUpperCase())
      .filter((side): side is BinancePositionSide => side === "BOTH" || side === "LONG" || side === "SHORT"),
  );
  const hasHedgeSide = sides.has("LONG") || sides.has("SHORT");
  const hasOneWaySide = sides.has("BOTH");
  if (hasHedgeSide === hasOneWaySide) throw new Error("Binance 返回的持仓模式不一致");
  return hasHedgeSide ? "HEDGE" : "ONE_WAY";
}

export function positionSideForEntry(direction: EntryDirection, mode: PositionMode): BinancePositionSide {
  if (direction !== "LONG" && direction !== "SHORT") throw new Error("实盘策略方向无效");
  if (mode === "ONE_WAY") return "BOTH";
  if (mode === "HEDGE") return direction;
  throw new Error("Binance 持仓模式无效");
}

/**
 * Pick the position-risk bucket that belongs to a strategy source.
 *
 * Binance returns one row per side in Hedge Mode, while ONE_WAY returns a
 * BOTH row.  A plain "first row for symbol" lookup can therefore bind a
 * protection strategy to the opposite Hedge position and make its exit
 * mutate an unrelated holding.
 */
export function selectPositionRiskRow<T extends PositionRiskRowLike>(
  rows: readonly T[],
  symbol: string,
  direction?: EntryDirection,
): T | null {
  if (!Array.isArray(rows)) return null;
  const normalizedSymbol = String(symbol ?? "").trim().toUpperCase();
  const candidates = rows.filter((row) => String(row?.symbol ?? "").trim().toUpperCase() === normalizedSymbol);
  if (!direction) return candidates[0] ?? null;
  const exact = candidates.find((row) => String(row.positionSide ?? "").trim().toUpperCase() === direction);
  if (exact) return exact;
  const both = candidates.find((row) => String(row.positionSide ?? "").trim().toUpperCase() === "BOTH");
  if (both) return both;
  // Some testnets/legacy responses omit positionSide.  Only use an
  // unlabelled row when its signed amount agrees with the requested side.
  return candidates.find((row) => {
    if (row.positionSide !== undefined && String(row.positionSide).trim() !== "") return false;
    const amount = Number(row.positionAmt);
    return Number.isFinite(amount) && amount !== 0 && (direction === "LONG" ? amount > 0 : amount < 0);
  }) ?? null;
}
