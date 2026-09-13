const BINANCE_FUTURES_REST = "https://fapi.binance.com";
const STEP_SECONDS = 5 * 60;

type Fetcher = (input: string | URL, init?: RequestInit) => Promise<Response>;
export type FocusFiveMinuteBar = { time: number; open: number; high: number; low: number; close: number; volume: number; closed: true };

function finiteNumber(value: unknown, label: string) {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
  return number;
}

function validateBar(bar: FocusFiveMinuteBar) {
  if (bar.time <= 0 || bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0 || bar.volume < 0) throw new Error("invalid five-minute bar");
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close) || bar.low > bar.high) throw new Error("invalid five-minute OHLC range");
}

export function buildFocusFiveMinuteBatches(symbols: readonly string[], maximumStreamsPerConnection = 200) {
  if (!Number.isInteger(maximumStreamsPerConnection) || maximumStreamsPerConnection < 1) throw new Error("maximum streams per connection must be positive");
  const streams = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter((symbol) => /^[A-Z0-9]{2,30}USDT$/.test(symbol)))]
    .sort()
    .map((symbol) => `${symbol.toLowerCase()}@kline_5m`);
  return Array.from({ length: Math.ceil(streams.length / maximumStreamsPerConnection) }, (_, index) =>
    streams.slice(index * maximumStreamsPerConnection, (index + 1) * maximumStreamsPerConnection));
}

export function parseClosedFiveMinuteKlineEvent(value: unknown): { symbol: string; bar: FocusFiveMinuteBar } | null {
  const envelope = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const data = envelope.data && typeof envelope.data === "object" ? envelope.data as Record<string, unknown> : envelope;
  const kline = data.k && typeof data.k === "object" ? data.k as Record<string, unknown> : null;
  if (data.e !== "kline" || !kline || kline.x !== true || kline.i !== "5m") return null;
  const bar: FocusFiveMinuteBar = {
    time: Math.floor(finiteNumber(kline.t, "open time") / 1_000),
    open: finiteNumber(kline.o, "open"), high: finiteNumber(kline.h, "high"), low: finiteNumber(kline.l, "low"),
    close: finiteNumber(kline.c, "close"), volume: finiteNumber(kline.v, "volume"), closed: true,
  };
  validateBar(bar);
  const symbol = String(data.s ?? "").toUpperCase();
  return /^[A-Z0-9]{2,30}USDT$/.test(symbol) ? { symbol, bar } : null;
}

export async function fetchClosedFiveMinuteKlines(symbol: string, limit = 240, fetcher: Fetcher = fetch, now = Date.now()): Promise<FocusFiveMinuteBar[]> {
  const endpoint = new URL(`${BINANCE_FUTURES_REST}/fapi/v1/klines`);
  endpoint.searchParams.set("symbol", symbol.toUpperCase());
  endpoint.searchParams.set("interval", "5m");
  endpoint.searchParams.set("limit", String(Math.min(1_500, Math.max(1, Math.floor(limit)))));
  const response = await fetcher(endpoint, { headers: { accept: "application/json", "user-agent": "streetlight-structure-radar/1.0" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Binance public API returned ${response.status}`);
  const payload: unknown = await response.json();
  if (!Array.isArray(payload)) throw new Error("Binance kline payload must be an array");
  return payload.filter(Array.isArray).filter((row) => finiteNumber(row[6], "close time") < now).map((row) => {
    const bar: FocusFiveMinuteBar = {
      time: Math.floor(finiteNumber(row[0], "open time") / 1_000), open: finiteNumber(row[1], "open"), high: finiteNumber(row[2], "high"),
      low: finiteNumber(row[3], "low"), close: finiteNumber(row[4], "close"), volume: finiteNumber(row[5], "volume"), closed: true,
    };
    validateBar(bar); return bar;
  }).sort((left, right) => left.time - right.time);
}

export class FocusFiveMinuteCache {
  readonly #maxBars: number;
  readonly #series = new Map<string, FocusFiveMinuteBar[]>();
  constructor({ maxBars = 240 }: { maxBars?: number } = {}) {
    if (!Number.isInteger(maxBars) || maxBars < 1) throw new Error("maxBars must be positive");
    this.#maxBars = maxBars;
  }
  #key(symbol: string) { return symbol.toUpperCase(); }
  replace(symbol: string, bars: readonly FocusFiveMinuteBar[]) {
    bars.forEach(validateBar);
    this.#series.set(this.#key(symbol), bars.slice(-this.#maxBars));
  }
  get(symbol: string) { return [...(this.#series.get(this.#key(symbol)) ?? [])]; }
  append(symbol: string, bar: FocusFiveMinuteBar) {
    validateBar(bar);
    const key = this.#key(symbol); const bars = this.#series.get(key) ?? []; const last = bars.at(-1);
    if (last && last.time === bar.time) return { status: "duplicate" as const, bar: last };
    if (last && bar.time !== last.time + STEP_SECONDS) return { status: "gap" as const, expectedTime: last.time + STEP_SECONDS, receivedTime: bar.time };
    this.#series.set(key, [...bars, bar].slice(-this.#maxBars));
    return { status: "appended" as const, bar };
  }
}
