export function formatTradeNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return Math.abs(number) >= 1
    ? number.toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: false })
    : number.toLocaleString("en-US", { maximumSignificantDigits: 6, useGrouping: false });
}
