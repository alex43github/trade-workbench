export type MarginProfitTarget = {
  price: number;
  quantity: number;
  expectedProfit: number;
};

type MarginProfitTargetInput = {
  side: "LONG" | "SHORT";
  entryPrice: number;
  quantity: number;
  leverage: number;
  stepSize: number;
  tickSize: number;
};

const OFFSETS = [0.09, 0.1, 0.11] as const;

function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label}必须大于0`);
  return value;
}

function floorStep(value: number, step: number) {
  return Number((Math.floor(value / step + Number.EPSILON) * step).toPrecision(15));
}

function priceAt(entryPrice: number, side: MarginProfitTargetInput["side"], offset: number, tickSize: number) {
  const raw = side === "LONG" ? entryPrice * (1 + offset) : entryPrice * (1 - offset);
  const units = Number((raw / tickSize).toPrecision(12));
  const rounded = side === "LONG" ? Math.ceil(units) * tickSize : Math.floor(units) * tickSize;
  return Number(rounded.toPrecision(15));
}

/**
 * Lock one initial-margin worth of realized PnL across three maker-limit exits.
 * Each target contributes one third of the margin profit, subject to lot-size
 * rounding. The caller must use the actual fill quantity and average price.
 */
export function marginProfitLimitTargets(input: MarginProfitTargetInput): MarginProfitTarget[] {
  const entryPrice = positive(input.entryPrice, "入场价格");
  const quantity = positive(input.quantity, "成交数量");
  const leverage = positive(input.leverage, "杠杆");
  const stepSize = positive(input.stepSize, "数量精度");
  const tickSize = positive(input.tickSize, "价格精度");
  const margin = quantity * entryPrice / leverage;

  const rawTargets = OFFSETS.map((offset) => {
    const price = priceAt(entryPrice, input.side, offset, tickSize);
    const move = Math.abs(price - entryPrice);
    const requestedQuantity = (margin / OFFSETS.length) / move;
    const targetQuantity = floorStep(requestedQuantity, stepSize);
    if (targetQuantity <= 0) throw new Error("首段止盈数量低于交易所精度");
    return { price, quantity: targetQuantity, expectedProfit: targetQuantity * move };
  });
  const totalQuantity = rawTargets.reduce((sum, target) => sum + target.quantity, 0);
  if (totalQuantity <= quantity + Number.EPSILON) return rawTargets;
  const scale = quantity / totalQuantity;
  return rawTargets.map((target) => {
    const scaledQuantity = floorStep(target.quantity * scale, stepSize);
    if (scaledQuantity <= 0) throw new Error("首段止盈数量低于交易所精度");
    return { ...target, quantity: scaledQuantity, expectedProfit: scaledQuantity * Math.abs(target.price - entryPrice) };
  });
}
