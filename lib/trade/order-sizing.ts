export type OrderSizeMode = "fixed_margin" | "available_pct" | "fixed" | "percent";

export function calculateOrderSizing(input: {
  sizeMode: OrderSizeMode;
  sizeValue: number;
  availableMargin: number;
  leverage: number;
}) {
  const marginUsdt = input.sizeMode === "available_pct" || input.sizeMode === "percent"
    ? input.availableMargin * input.sizeValue / 100
    : input.sizeValue;
  return { marginUsdt, notional: marginUsdt * input.leverage };
}
