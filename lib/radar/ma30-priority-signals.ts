export type Ma30PrioritySignalDirection = "LONG" | "SHORT";
export type Ma30PrioritySignalInterval = "15m" | "1h";

export type Ma30PriorityBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  closeTime: number;
};

export const MA30_PRIORITY_MA_PERIOD = 30;
export const MA30_PRIORITY_ATR_PERIOD = 14;
export const MA30_PRIORITY_PULLBACK_BARS = 8;
export const MA30_PRIORITY_PULLBACK_ATR = 0.75;
export const MA30_PRIORITY_BREAKOUT_BARS = 3;
export const MA30_PRIORITY_MAX_EXTENSION_ATR = 2;

function validNumber(value: number) {
  return Number.isFinite(value) && value > 0;
}

function smaAtIndex(bars: readonly Ma30PriorityBar[], index: number, period = MA30_PRIORITY_MA_PERIOD): number | null {
  if (index < period - 1 || index >= bars.length) return null;
  let sum = 0;
  for (let i = index - period + 1; i <= index; i++) {
    const close = Number(bars[i]?.close);
    if (!validNumber(close)) return null;
    sum += close;
  }
  return sum / period;
}

export function smaAtLastBar(bars: readonly Ma30PriorityBar[], period = MA30_PRIORITY_MA_PERIOD): number | null {
  return smaAtIndex(bars, bars.length - 1, period);
}

function atrAtLastBar(bars: readonly Ma30PriorityBar[], period = MA30_PRIORITY_ATR_PERIOD): number | null {
  if (bars.length < period + 1) return null;
  let sum = 0;
  const start = bars.length - period;
  for (let i = start; i < bars.length; i++) {
    const current = bars[i];
    const previous = bars[i - 1];
    if (!current || !previous) return null;
    const high = Number(current.high);
    const low = Number(current.low);
    const previousClose = Number(previous.close);
    if (![high, low, previousClose].every(Number.isFinite)) return null;
    const tr = Math.max(high - low, Math.abs(high - previousClose), Math.abs(low - previousClose));
    if (!(tr >= 0)) return null;
    sum += tr;
  }
  return sum / period;
}

function ma30Slope20(bars: readonly Ma30PriorityBar[]): number | null {
  if (bars.length < MA30_PRIORITY_MA_PERIOD + 20) return null;
  const current = smaAtLastBar(bars);
  const previous = smaAtLastBar(bars.slice(0, -20));
  if (!current || !previous || current <= 0 || previous <= 0) return null;
  return ((Math.log(current) - Math.log(previous)) / 20) * 100;
}

export type Ma30BodyCrossSignal = {
  eventKey: string;
  interval: Ma30PrioritySignalInterval;
  direction: Ma30PrioritySignalDirection;
  closeTime: number;
  open: number;
  close: number;
  ma30: number;
  closeVsMa30Pct: number;
};

export function ma30CrossEventKey(symbol: string, interval: Ma30PrioritySignalInterval, closeTime: number, direction: Ma30PrioritySignalDirection) {
  return `ma30-cross:${symbol}:${interval}:${closeTime}:${direction}`;
}

export function detectMa30BodyCross(
  bars: readonly Ma30PriorityBar[],
  direction: Ma30PrioritySignalDirection,
  interval: Ma30PrioritySignalInterval,
  symbol = "",
): Ma30BodyCrossSignal | null {
  const current = bars.at(-1);
  const ma30 = smaAtLastBar(bars);
  if (!current || ma30 === null) return null;
  const open = Number(current.open);
  const close = Number(current.close);
  if (![open, close, ma30, current.closeTime].every(Number.isFinite)) return null;

  const crossed = direction === "LONG"
    ? open < ma30 && close > ma30
    : open > ma30 && close < ma30;
  if (!crossed) return null;

  return {
    eventKey: ma30CrossEventKey(symbol, interval, current.closeTime, direction),
    interval,
    direction,
    closeTime: current.closeTime,
    open,
    close,
    ma30,
    closeVsMa30Pct: ((close / ma30) - 1) * 100,
  };
}

function pullbackEvidence(
  bars: readonly Ma30PriorityBar[],
  direction: Ma30PrioritySignalDirection,
  watchStartedAt: number,
  atr: number,
) {
  const beforeCurrent = bars.slice(0, -1);
  const eligible = beforeCurrent
    .map((bar, index) => ({ bar, index }))
    .filter(({ bar }) => bar.closeTime >= watchStartedAt)
    .slice(-MA30_PRIORITY_PULLBACK_BARS);
  if (!eligible.length) return { seen: false, at: null as number | null, mode: null as string | null };

  let maTouchAt: number | null = null;
  for (const { bar, index } of eligible) {
    const ma = smaAtIndex(bars, index);
    if (ma === null) continue;
    const touched = direction === "LONG" ? bar.close <= ma : bar.close >= ma;
    if (touched) maTouchAt = bar.closeTime;
  }

  let retraceAt: number | null = null;
  let maxRetrace = 0;
  if (direction === "LONG") {
    let peakClose = eligible[0].bar.close;
    for (let i = 1; i < eligible.length; i++) {
      const { bar } = eligible[i];
      const distance = peakClose - bar.close;
      if (distance > maxRetrace) {
        maxRetrace = distance;
        retraceAt = bar.closeTime;
      }
      peakClose = Math.max(peakClose, bar.close);
    }
  } else {
    let troughClose = eligible[0].bar.close;
    for (let i = 1; i < eligible.length; i++) {
      const { bar } = eligible[i];
      const distance = bar.close - troughClose;
      if (distance > maxRetrace) {
        maxRetrace = distance;
        retraceAt = bar.closeTime;
      }
      troughClose = Math.min(troughClose, bar.close);
    }
  }

  const atrRetrace = maxRetrace >= atr * MA30_PRIORITY_PULLBACK_ATR;
  const seen = maTouchAt !== null || atrRetrace;
  const at = Math.max(maTouchAt ?? -Infinity, atrRetrace ? (retraceAt ?? -Infinity) : -Infinity);
  const mode = maTouchAt !== null && atrRetrace ? "BOTH" : maTouchAt !== null ? "MA_TOUCH" : atrRetrace ? "ATR_RETRACE" : null;
  return { seen, at: Number.isFinite(at) ? at : null, mode };
}

export type Ma30ReignitionSignal = {
  eventKey: string;
  direction: Ma30PrioritySignalDirection;
  interval: "15m";
  closeTime: number;
  close: number;
  ma30: number;
  closeVsMa30Pct: number;
  atr14: number;
  breakoutLevel: number;
  extensionAtr: number;
  pullbackMode: string;
  pullbackAt: number;
  oneHourSlope20: number;
};

export function ma30ReignitionEventKey(symbol: string, closeTime: number, direction: Ma30PrioritySignalDirection) {
  return `ma30-reignite:${symbol}:15m:${closeTime}:${direction}`;
}

export function evaluateMa30Reignition(input: {
  bars15m: readonly Ma30PriorityBar[];
  bars1h: readonly Ma30PriorityBar[];
  direction: Ma30PrioritySignalDirection;
  watchStartedAt: number;
  symbol?: string;
}): { pullbackSeen: boolean; pullbackAt: number | null; signal: Ma30ReignitionSignal | null } {
  const { bars15m, bars1h, direction, watchStartedAt, symbol = "" } = input;
  const current = bars15m.at(-1);
  if (!current || bars15m.length < MA30_PRIORITY_MA_PERIOD || bars1h.length < MA30_PRIORITY_MA_PERIOD + 20) {
    return { pullbackSeen: false, pullbackAt: null, signal: null };
  }

  const priorForAtr = bars15m.slice(0, -1);
  const atr14 = atrAtLastBar(priorForAtr);
  const ma30 = smaAtLastBar(bars15m);
  const oneHourSlope20 = ma30Slope20(bars1h);
  if (atr14 === null || atr14 <= 0 || ma30 === null || oneHourSlope20 === null) {
    return { pullbackSeen: false, pullbackAt: null, signal: null };
  }

  const pullback = pullbackEvidence(bars15m, direction, watchStartedAt, atr14);
  if (!pullback.seen || pullback.at === null) return { pullbackSeen: false, pullbackAt: null, signal: null };

  const directionValid = direction === "LONG" ? oneHourSlope20 > 0 : oneHourSlope20 < 0;
  if (!directionValid) return { pullbackSeen: true, pullbackAt: pullback.at, signal: null };

  const priorBreakoutBars = bars15m.slice(-(MA30_PRIORITY_BREAKOUT_BARS + 1), -1);
  if (priorBreakoutBars.length < MA30_PRIORITY_BREAKOUT_BARS) {
    return { pullbackSeen: true, pullbackAt: pullback.at, signal: null };
  }
  const breakoutLevel = direction === "LONG"
    ? Math.max(...priorBreakoutBars.map((bar) => bar.high))
    : Math.min(...priorBreakoutBars.map((bar) => bar.low));
  const bodyDirectionOk = direction === "LONG" ? current.close > current.open : current.close < current.open;
  const maSideOk = direction === "LONG" ? current.close > ma30 : current.close < ma30;
  const breakoutOk = direction === "LONG" ? current.close > breakoutLevel : current.close < breakoutLevel;
  const extension = Math.abs(current.close - ma30);
  const extensionAtr = extension / atr14;
  const extensionOk = extensionAtr <= MA30_PRIORITY_MAX_EXTENSION_ATR;

  if (!(bodyDirectionOk && maSideOk && breakoutOk && extensionOk)) {
    return { pullbackSeen: true, pullbackAt: pullback.at, signal: null };
  }

  return {
    pullbackSeen: true,
    pullbackAt: pullback.at,
    signal: {
      eventKey: ma30ReignitionEventKey(symbol, current.closeTime, direction),
      direction,
      interval: "15m",
      closeTime: current.closeTime,
      close: current.close,
      ma30,
      closeVsMa30Pct: ((current.close / ma30) - 1) * 100,
      atr14,
      breakoutLevel,
      extensionAtr,
      pullbackMode: pullback.mode ?? "UNKNOWN",
      pullbackAt: pullback.at,
      oneHourSlope20,
    },
  };
}