type Bar = { time: number; open: number; high: number; low: number; close: number; volume: number; closed?: boolean };
type RecordLike = { bias: string; classifications: readonly string[]; squeezeStage: string | null; trendStage: string | null };
type Derivatives = { oiChangePct?: number; fundingRate?: number; takerBuySellRatio?: number };

function average(values: readonly number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function sma(bars: readonly Bar[], length: number) { const values = bars.slice(-length).map((bar) => bar.close); return values.length === length ? average(values) : Number.NaN; }
function atr(bars: readonly Bar[], period = 14) {
  const values = bars.slice(-(period + 1));
  if (values.length < 2) return Number.NaN;
  return average(values.slice(1).map((bar, index) => Math.max(bar.high - bar.low, Math.abs(bar.high - values[index].close), Math.abs(bar.low - values[index].close))));
}
function change(bars: readonly Bar[]) {
  const first = bars.at(-7)?.close ?? bars[0]?.close;
  const last = bars.at(-1)?.close;
  return first && last ? (last / first - 1) * 100 : Number.NaN;
}
function higherLow(bars: readonly Bar[]) {
  const recent = bars.slice(-4);
  if (recent.length < 3) return false;
  const lows = recent.map((bar) => bar.low);
  return lows.at(-1)! > Math.min(...lows.slice(0, -1)) && recent.at(-1)!.close >= recent.at(-2)!.close;
}

export function buildFocusEvidence(input: {
  record: RecordLike;
  bars5m: readonly Bar[];
  bars15m: readonly Bar[];
  bars1h: readonly Bar[];
  btc1h: readonly Bar[];
  eth1h: readonly Bar[];
  derivatives?: Derivatives;
  hasLongPosition: boolean;
}) {
  const thesisValid = input.record.bias === "LONG" && input.record.classifications.length > 0
    && input.record.squeezeStage !== "TERMINAL_INVALIDATED" && input.record.trendStage !== "INVALIDATED";
  const localHigherLow = higherLow(input.bars5m) || higherLow(input.bars15m);
  const current15m = input.bars15m.at(-1)?.close ?? Number.NaN;
  const ma30 = sma(input.bars15m, 30);
  const atr15m = atr(input.bars15m);
  const extensionByPrice = Number.isFinite(current15m) && Number.isFinite(ma30) && Number.isFinite(atr15m) && atr15m > 0
    ? Math.abs(current15m - ma30) / atr15m >= 2.5 : false;
  const extended = ["EXTENDED_NO_CHASE", "BLOW_OFF"].includes(input.record.squeezeStage ?? "") || extensionByPrice;

  const derivatives = input.derivatives;
  const oiSupport = derivatives?.oiChangePct !== undefined && Number.isFinite(derivatives.oiChangePct) && derivatives.oiChangePct > 0;
  const fundingNotOverheated = derivatives?.fundingRate !== undefined && Number.isFinite(derivatives.fundingRate) && derivatives.fundingRate <= 0.0015;
  const takerSupport = derivatives?.takerBuySellRatio !== undefined && Number.isFinite(derivatives.takerBuySellRatio) && derivatives.takerBuySellRatio >= 1.02;
  const favorableFunding = derivatives?.fundingRate !== undefined && Number.isFinite(derivatives.fundingRate) && derivatives.fundingRate <= 0.0003;
  const derivativesSupportive = Boolean(derivatives && oiSupport && fundingNotOverheated && (takerSupport || favorableFunding));

  const symbolChange = change(input.bars1h);
  const benchmarkChanges = [change(input.btc1h), change(input.eth1h)].filter(Number.isFinite);
  const relativeStrengthSupportive = Number.isFinite(symbolChange) && benchmarkChanges.length > 0 && benchmarkChanges.every((value) => symbolChange >= value + 0.5);

  let rewardRisk = Number.NaN;
  if (Number.isFinite(current15m) && Number.isFinite(ma30) && Number.isFinite(atr15m) && atr15m > 0) {
    const recent15m = input.bars15m.slice(-8);
    const recent1h = input.bars1h.slice(-8);
    const structuralLow = recent15m.length ? Math.min(...recent15m.map((bar) => bar.low)) : ma30 - atr15m;
    const stop = Math.min(ma30 - atr15m * 0.55, structuralLow);
    const structuralHigh = recent1h.length ? Math.max(...recent1h.map((bar) => bar.high)) : current15m;
    const target = Math.max(structuralHigh, current15m + atr15m * 2.5);
    const risk = current15m - stop;
    rewardRisk = risk > 0 ? (target - current15m) / risk : Number.NaN;
  }

  return { thesisValid, localHigherLow, extended, derivativesSupportive, relativeStrengthSupportive, rewardRisk, hasLongPosition: input.hasLongPosition };
}
