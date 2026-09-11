import assert from "node:assert/strict";
import test from "node:test";
import {
  screenWithTvScreener,
  validateTvScreenerRequest,
} from "../lib/radar/tvscreener.ts";

const CLOCK_START = Date.parse("2026-08-27T00:00:00.000Z");

function request(overrides = {}) {
  return {
    assetType: "crypto",
    symbols: ["BINANCE:BTCUSDT"],
    intervals: ["15"],
    fields: ["PRICE", "CHANGE_PERCENT", "RSI_14"],
    sortBy: "VOLUME",
    limit: 25,
    ...overrides,
  };
}

function sidecarResponse(overrides = {}) {
  return {
    coverage: "live",
    rows: [
      {
        tvSymbol: "BINANCE:BTCUSDT",
        exchange: "BINANCE",
        rawSymbol: "BTCUSDT",
        binanceSymbol: "BTCUSDT",
        values: {
          PRICE: 100,
          CHANGE_PERCENT: 2.5,
          RSI_14: 61,
        },
        intervalValues: {
          "15": {
            PRICE: 100,
            CHANGE_PERCENT: 2.5,
            RSI_14: 61,
          },
        },
        warnings: [],
      },
    ],
    warnings: [],
    ...overrides,
  };
}

function jsonResponse(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
  };
}

async function withFetch(fetcher, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = fetcher;
  try {
    return await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withEnv(value, callback) {
  const originalValue = process.env.TVSCREENER_BASE_URL;
  if (value === undefined) delete process.env.TVSCREENER_BASE_URL;
  else process.env.TVSCREENER_BASE_URL = value;
  try {
    return await callback();
  } finally {
    if (originalValue === undefined) delete process.env.TVSCREENER_BASE_URL;
    else process.env.TVSCREENER_BASE_URL = originalValue;
  }
}

async function withNow(initialValue, callback) {
  const originalNow = Date.now;
  let now = initialValue;
  Date.now = () => now;
  try {
    return await callback((nextValue) => {
      now = nextValue;
    });
  } finally {
    Date.now = originalNow;
  }
}

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

test("rejects unknown request keys and unsupported intervals", () => {
  assert.throws(
    () => validateTvScreenerRequest({ ...request(), debug: true }),
    /unknown|field/i,
  );
  assert.throws(
    () => validateTvScreenerRequest(request({ intervals: ["1h"] })),
    /interval/i,
  );
});

test("rejects more than 50 symbols or 25 requested rows", () => {
  const symbols = Array.from({ length: 51 }, (_, index) => `BINANCE:S${index}USDT`);
  assert.throws(() => validateTvScreenerRequest(request({ symbols })), /50/);
  assert.throws(() => validateTvScreenerRequest(request({ limit: 26 })), /25/);
});

test("sends only the closed readonly payload through a verified loopback URL", async () => {
  const calls = [];
  await withEnv("http://127.0.0.1:8899/", () => withNow(CLOCK_START, () => withFetch(async (input, init) => {
    calls.push({ input: String(input), init });
    return jsonResponse(sidecarResponse());
  }, async () => {
    const result = await screenWithTvScreener(request({ symbols: ["BINANCE:PAYLOADUSDT"] }));

    assert.equal(result.source, "tradingview-screener");
    assert.equal(result.coverage, "live");
    assert.match(result.requestId, /^[0-9a-f-]{36}$/i);
    assert.equal(Date.parse(result.fetchedAt), CLOCK_START);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].input, "http://127.0.0.1:8899/v1/screen");
    assert.equal(calls[0].init.method, "POST");
    assert.deepEqual(Object.keys(calls[0].init.headers).sort(), ["accept", "content-type"]);
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      assetType: "crypto",
      symbols: ["BINANCE:PAYLOADUSDT"],
      intervals: ["15"],
      fields: ["PRICE", "CHANGE_PERCENT", "RSI_14"],
      sortBy: "VOLUME",
      limit: 25,
    });
  })));
});

test("uses an array-order-independent fingerprint for successful cache entries", async () => {
  let callCount = 0;
  await withEnv("http://127.0.0.1:8899", () => withNow(CLOCK_START, () => withFetch(async () => {
    callCount += 1;
    return jsonResponse(sidecarResponse());
  }, async () => {
    const first = await screenWithTvScreener(request({
      symbols: ["BINANCE:ETHUSDT", "BINANCE:BTCUSDT"],
      intervals: ["60", "15"],
      fields: ["RSI_14", "PRICE"],
    }));
    const second = await screenWithTvScreener(request({
      symbols: ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT"],
      intervals: ["15", "60"],
      fields: ["PRICE", "RSI_14"],
    }));

    assert.equal(callCount, 1);
    assert.deepEqual(second, first);
  })));
});

test("reuses one in-flight request for concurrent identical screens", async () => {
  const pending = deferred();
  let callCount = 0;
  await withEnv("http://127.0.0.1:8899", () => withFetch(async () => {
    callCount += 1;
    return pending.promise;
  }, async () => {
    const firstPromise = screenWithTvScreener(request({ symbols: ["BINANCE:INFLIGHTUSDT"] }));
    const secondPromise = screenWithTvScreener(request({ symbols: ["BINANCE:INFLIGHTUSDT"] }));
    pending.resolve(jsonResponse(sidecarResponse()));
    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    assert.equal(callCount, 1);
    assert.deepEqual(second, first);
  }));
});

test("reuses a successful response for 30 seconds without another sidecar request", async () => {
  let callCount = 0;
  await withEnv("http://127.0.0.1:8899", () => withNow(CLOCK_START, (setNow) => withFetch(async () => {
    callCount += 1;
    return jsonResponse(sidecarResponse({ rows: [] }));
  }, async () => {
    const first = await screenWithTvScreener(request({ symbols: ["BINANCE:TTLUSDT"] }));
    setNow(CLOCK_START + 29_999);
    const second = await screenWithTvScreener(request({ symbols: ["BINANCE:TTLUSDT"] }));

    assert.equal(callCount, 1);
    assert.deepEqual(second, first);
  })));
});

test("converts an upstream 503 into unavailable without exposing its response body", async () => {
  const secretBody = JSON.stringify({ authorization: "secret-header", token: "secret-token" });
  let called = false;
  await withEnv("http://127.0.0.1:8899", () => withFetch(async () => {
    called = true;
    return {
      ok: false,
      status: 503,
      async json() {
        return JSON.parse(secretBody);
      },
    };
  }, async () => {
    const result = await screenWithTvScreener(request({ symbols: ["BINANCE:503USDT"] }));
    const serialized = JSON.stringify(result);

    assert.equal(called, true);
    assert.equal(result.coverage, "unavailable");
    assert.deepEqual(result.rows, []);
    assert.match(result.warnings.join(" "), /503|unavailable|sidecar/i);
    assert.equal(serialized.includes("secret-token"), false);
    assert.equal(serialized.includes("secret-header"), false);
  }));
});

test("retains the last successful response as stale only after the cache expires", async () => {
  let callCount = 0;
  await withEnv("http://127.0.0.1:8899", () => withNow(CLOCK_START, (setNow) => withFetch(async () => {
    callCount += 1;
    if (callCount === 1) return jsonResponse(sidecarResponse());
    return jsonResponse({ error: "sidecar unavailable" }, 503);
  }, async () => {
    const live = await screenWithTvScreener(request({ symbols: ["BINANCE:STALEUSDT"] }));
    setNow(CLOCK_START + 30_001);
    const stale = await screenWithTvScreener(request({ symbols: ["BINANCE:STALEUSDT"] }));

    assert.equal(live.coverage, "live");
    assert.equal(stale.coverage, "stale");
    assert.deepEqual(stale.rows, live.rows);
    assert.equal(stale.fetchedAt, live.fetchedAt);
    assert.equal(callCount, 2);
  })));
});

test("rejects a non-loopback base URL without making a sidecar request", async () => {
  let callCount = 0;
  await withEnv("https://example.com", () => withFetch(async () => {
    callCount += 1;
    return jsonResponse(sidecarResponse());
  }, async () => {
    const result = await screenWithTvScreener(request({ symbols: ["BINANCE:URLUSDT"] }));

    assert.equal(callCount, 0);
    assert.equal(result.coverage, "unavailable");
    assert.match(result.warnings.join(" "), /loopback|URL|sidecar/i);
  }));
});

test("does not treat named localhost as an allowed loopback URL", async () => {
  let callCount = 0;
  await withEnv("http://localhost:8899", () => withFetch(async () => {
    callCount += 1;
    return jsonResponse(sidecarResponse());
  }, async () => {
    const result = await screenWithTvScreener(request({ symbols: ["BINANCE:LOCALHOSTUSDT"] }));

    assert.equal(callCount, 0);
    assert.equal(result.coverage, "unavailable");
    assert.match(result.warnings.join(" "), /loopback|URL|sidecar/i);
  }));
});

test("materializes requested fields and intervals with null warnings and mapping warnings", async () => {
  const fields = ["PRICE", "CHANGE_PERCENT", "RSI_14", "MACD_12_26"];
  const intervals = ["15", "60"];
  await withEnv("http://127.0.0.1:8899", () => withFetch(async () => jsonResponse({
    coverage: "live",
    rows: [{
      tvSymbol: "BINANCE:SPARSEUSDT",
      exchange: "BINANCE",
      rawSymbol: "SPARSEUSDT",
      values: {
        PRICE: 101,
        CHANGE_PERCENT: null,
        RSI_14: Number.NaN,
      },
      intervalValues: {
        "15": {
          PRICE: 101,
          CHANGE_PERCENT: null,
          RSI_14: Number.POSITIVE_INFINITY,
        },
      },
      warnings: [],
    }],
    warnings: [],
  }), async () => {
    const result = await screenWithTvScreener(request({
      symbols: ["BINANCE:SPARSEUSDT"],
      fields,
      intervals,
    }));
    const row = result.rows[0];
    const warnings = row.warnings.join(" ");

    assert.equal(result.coverage, "partial");
    assert.deepEqual(row.values, {
      PRICE: 101,
      CHANGE_PERCENT: null,
      RSI_14: null,
      MACD_12_26: null,
    });
    assert.deepEqual(row.intervalValues, {
      "15": {
        PRICE: 101,
        CHANGE_PERCENT: null,
        RSI_14: null,
        MACD_12_26: null,
      },
      "60": {
        PRICE: null,
        CHANGE_PERCENT: null,
        RSI_14: null,
        MACD_12_26: null,
      },
    });
    for (const field of fields) assert.match(warnings, new RegExp(field));
    assert.match(warnings, /mapping|binance/i);
    assert.equal(row.binanceSymbol, null);
  }));
});

test("rejects a sidecar response with more than 25 rows as unavailable", async () => {
  const rows = Array.from({ length: 26 }, (_, index) => ({
    ...sidecarResponse().rows[0],
    tvSymbol: `BINANCE:OVERFLOW${index}USDT`,
  }));
  await withEnv("http://127.0.0.1:8899", () => withFetch(async () => jsonResponse({
    coverage: "live",
    rows,
    warnings: [],
  }), async () => {
    const result = await screenWithTvScreener(request({ symbols: ["BINANCE:OVERFLOWUSDT"] }));

    assert.equal(result.coverage, "unavailable");
    assert.deepEqual(result.rows, []);
  }));
});

test("uses a deterministic 10000ms abort deadline and converts timeout to unavailable", async () => {
  const originalTimeout = AbortSignal.timeout;
  const timeoutSignal = new AbortController().signal;
  let deadline;
  AbortSignal.timeout = (milliseconds) => {
    deadline = milliseconds;
    return timeoutSignal;
  };
  try {
    await withEnv("http://127.0.0.1:8899", () => withFetch(async (_input, init) => {
      assert.equal(init.signal, timeoutSignal);
      const error = new Error("deadline reached");
      error.name = "TimeoutError";
      throw error;
    }, async () => {
      const result = await screenWithTvScreener(request({ symbols: ["BINANCE:TIMEOUTUSDT"] }));

      assert.equal(deadline, 10_000);
      assert.equal(result.coverage, "unavailable");
      assert.match(result.warnings.join(" "), /timed out|unavailable/i);
    }));
  } finally {
    AbortSignal.timeout = originalTimeout;
  }
});

test("does not let a failed refresh replace the successful cache", async () => {
  let callCount = 0;
  await withEnv("http://127.0.0.1:8899", () => withNow(CLOCK_START, (setNow) => withFetch(async () => {
    callCount += 1;
    if (callCount === 1) return jsonResponse(sidecarResponse({ rows: [{
      ...sidecarResponse().rows[0],
      tvSymbol: "BINANCE:CACHEUSDT",
      values: { PRICE: 111, CHANGE_PERCENT: 1, RSI_14: 55 },
    }] }));
    if (callCount === 2) return jsonResponse({ error: "temporary outage" }, 503);
    return jsonResponse(sidecarResponse({ rows: [{
      ...sidecarResponse().rows[0],
      tvSymbol: "BINANCE:CACHEUSDT",
      values: { PRICE: 222, CHANGE_PERCENT: 2, RSI_14: 65 },
    }] }));
  }, async () => {
    const live = await screenWithTvScreener(request({ symbols: ["BINANCE:CACHEUSDT"] }));
    setNow(CLOCK_START + 30_001);
    const stale = await screenWithTvScreener(request({ symbols: ["BINANCE:CACHEUSDT"] }));
    const refreshed = await screenWithTvScreener(request({ symbols: ["BINANCE:CACHEUSDT"] }));

    assert.equal(live.coverage, "live");
    assert.equal(stale.coverage, "stale");
    assert.equal(stale.rows[0].values.PRICE, 111);
    assert.equal(refreshed.coverage, "live");
    assert.equal(refreshed.rows[0].values.PRICE, 222);
    assert.equal(callCount, 3);
  })));
});
