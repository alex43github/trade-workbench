import type { MarketBar } from "./TradeChart";

export function calculateMa(bars: MarketBar[], length: number) {
  const result: Array<{ time: number; value: number }> = [];
  let rolling = 0;
  for (let index = 0; index < bars.length; index += 1) {
    rolling += bars[index].close;
    if (index >= length) rolling -= bars[index - length].close;
    if (index >= length - 1) result.push({ time: bars[index].time, value: rolling / length });
  }
  return result;
}
