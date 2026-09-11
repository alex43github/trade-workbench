import assert from "node:assert/strict";
import test from "node:test";

const strategy = (overrides = {}) => ({
  config: {
    symbol: "AKEUSDT",
    timeframe: "1h",
    ma: { kind: "SMA", length: 3 },
    atr: { length: 2 },
    ...overrides,
  },
});

function kline(openTime, open, high, low, close, closeTime) {
  return [openTime, String(open), String(high), String(low), String(close), "1", closeTime];
}

function marketFetch({ symbol = "AKEUSDT", klines, markPrice = "107.5", filters } = {}) {
  const exchangeInfo = {
    symbols: [{
      symbol,
      filters: filters ?? [
        { filterType: "PRICE_FILTER", tickSize: "0.01" },
        { filterType: "LOT_SIZE", stepSize: "0.001" },
      ],
    }],
  };
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/klines")) return Response.json(klines ?? []);
    if (url.pathname.endsWith("/premiumIndex")) return Response.json({ markPrice });
    if (url.pathname.endsWith("/exchangeInfo")) return Response.json(exchangeInfo);
    throw new Error(`unexpected public endpoint ${url.pathname}`);
  };
}

test("reads market data for a USDC-quoted strategy symbol", async () => {
  const { fetchPaperStrategyMarketSnapshot } = await import("../lib/trade/paper-strategy-market.ts");
  const snapshot = await fetchPaperStrategyMarketSnapshot(strategy({ symbol: "TSLAUSDC" }), {
    now: new Date(5_000),
    fetcher: marketFetch({
      symbol: "TSLAUSDC",
      klines: [
        kline(0, 100, 105, 99, 102, 1_000),
        kline(1_000, 102, 106, 101, 105, 2_000),
        kline(2_000, 105, 108, 104, 107, 3_000),
      ],
    }),
  });
  assert.equal(snapshot.symbol, "TSLAUSDC");
});

test("returns the latest closed SMA/ATR candle with its strategy identity", async () => {
  const { fetchPaperStrategyMarketSnapshot } = await import("../lib/trade/paper-strategy-market.ts");
  const snapshot = await fetchPaperStrategyMarketSnapshot(strategy(), {
    now: new Date(5_000),
    fetcher: marketFetch({
      klines: [
        kline(0, 100, 105, 99, 102, 1_000),
        kline(1_000, 102, 106, 101, 105, 2_000),
        kline(2_000, 105, 108, 104, 107, 3_000),
        kline(3_000, 107, 210, 106, 200, 6_000),
      ],
    }),
  });

  assert.equal(snapshot.symbol, "AKEUSDT");
  assert.equal(snapshot.markPrice, 107.5);
  assert.deepEqual(snapshot.closedCandle, {
    id: "AKEUSDT:1h:2000",
    isNewClosedCandle: true,
    close: 107,
    high: 108,
    low: 104,
    timeframe: "1h",
    maKind: "SMA",
    maLength: 3,
    atrLength: 2,
    ma: 104.66666666666667,
    atr: 4.5,
    tickSize: 0.01,
    stepSize: 0.001,
  });
});

test("calculates EMA from only closed public candles", async () => {
  const { fetchPaperStrategyMarketSnapshot } = await import("../lib/trade/paper-strategy-market.ts");
  const snapshot = await fetchPaperStrategyMarketSnapshot(strategy({ ma: { kind: "EMA", length: 3 } }), {
    now: new Date(5_000),
    fetcher: marketFetch({
      klines: [
        kline(0, 99, 101, 99, 100, 1_000),
        kline(1_000, 109, 111, 109, 110, 2_000),
        kline(2_000, 119, 121, 119, 120, 3_000),
        kline(3_000, 199, 201, 199, 200, 6_000),
      ],
    }),
  });

  assert.equal(snapshot.closedCandle.maKind, "EMA");
  assert.equal(snapshot.closedCandle.ma, 112.5);
  assert.equal(snapshot.closedCandle.close, 120);
});

test("uses public mark price and exchange tick and step filters", async () => {
  const { fetchPaperStrategyMarketSnapshot } = await import("../lib/trade/paper-strategy-market.ts");
  const snapshot = await fetchPaperStrategyMarketSnapshot(strategy(), {
    now: new Date(5_000),
    fetcher: marketFetch({
      markPrice: "0.1234",
      filters: [
        { filterType: "PRICE_FILTER", tickSize: "0.0001" },
        { filterType: "LOT_SIZE", stepSize: "10" },
      ],
      klines: [
        kline(0, 1, 3, 1, 2, 1_000),
        kline(1_000, 2, 5, 2, 4, 2_000),
        kline(2_000, 4, 7, 4, 6, 3_000),
      ],
    }),
  });

  assert.equal(snapshot.markPrice, 0.1234);
  assert.equal(snapshot.closedCandle.tickSize, 0.0001);
  assert.equal(snapshot.closedCandle.stepSize, 10);
});

test("rejects invalid public market data before it can reach a strategy", async () => {
  const { fetchPaperStrategyMarketSnapshot } = await import("../lib/trade/paper-strategy-market.ts");
  const now = new Date(5_000);
  await assert.rejects(() => fetchPaperStrategyMarketSnapshot(strategy(), {
    now,
    fetcher: marketFetch({ markPrice: "0", klines: [kline(0, 1, 3, 1, 2, 1_000), kline(1_000, 2, 4, 2, 3, 2_000), kline(2_000, 3, 5, 3, 4, 3_000)] }),
  }), /标记价格/);
  await assert.rejects(() => fetchPaperStrategyMarketSnapshot(strategy(), {
    now,
    fetcher: marketFetch({ klines: [kline(0, 1, 3, 1, 2, 6_000)] }),
  }), /已收盘 K 线/);
  await assert.rejects(() => fetchPaperStrategyMarketSnapshot(strategy(), {
    now,
    fetcher: marketFetch({
      klines: [kline(0, 1, 3, 1, 2, 1_000), kline(1_000, 2, 4, 2, 3, 2_000), kline(2_000, 3, 5, 3, 4, 3_000)],
      filters: [{ filterType: "PRICE_FILTER", tickSize: "0" }, { filterType: "LOT_SIZE", stepSize: "0.001" }],
    }),
  }), /交易精度/);
});
