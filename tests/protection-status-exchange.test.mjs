import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

process.env.NODE_ENV = "test";

const { createProtectionStatusGet } = await import("../app/api/trade/protection-status/route.ts");
const terminalSource = await readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");

function request(path) {
  return new Request(`http://localhost${path}`);
}

const rows = [
  { exchange: "BINANCE", symbol: "BTCUSDT", side: "LONG", status: "ACTIVE", remainingQuantity: 2 },
  { exchange: "BYBIT", symbol: "BTCUSDT", side: "LONG", status: "ACTIVE", remainingQuantity: 3 },
  { exchange: "BYBIT", symbol: "ETHUSDT", side: "SHORT", status: "PARTIALLY_PROTECTED", remainingQuantity: 1.5 },
];

test("protection status only aggregates strategies from the requested exchange", async () => {
  const get = createProtectionStatusGet({ listStrategies: async () => rows });

  const bybit = await get(request("/api/trade/protection-status?exchange=BYBIT"));
  assert.equal(bybit.status, 200);
  assert.deepEqual(await bybit.json(), {
    exchange: "BYBIT",
    protections: [
      { exchange: "BYBIT", symbol: "BTCUSDT", side: "LONG", protectedQuantity: 3 },
      { exchange: "BYBIT", symbol: "ETHUSDT", side: "SHORT", protectedQuantity: 1.5 },
    ],
  });

  const binance = await get(request("/api/trade/protection-status?exchange=BINANCE"));
  assert.equal(binance.status, 200);
  assert.deepEqual(await binance.json(), {
    exchange: "BINANCE",
    protections: [{ exchange: "BINANCE", symbol: "BTCUSDT", side: "LONG", protectedQuantity: 2 }],
  });
});

test("protection status rejects an unsupported exchange", async () => {
  const get = createProtectionStatusGet({ listStrategies: async () => rows });
  const response = await get(request("/api/trade/protection-status?exchange=OKX"));
  assert.equal(response.status, 400);
});

test("TradingTerminal requests and matches protection status for the selected exchange", () => {
  assert.match(terminalSource, /\/api\/trade\/protection-status\?exchange=\$\{selectedExchange\}/);
  assert.match(terminalSource, /<PositionTable exchange=\{selectedExchange\} positions=\{account\.positions\} protections=\{protectionStatuses\}/);
  assert.match(terminalSource, /protection\.exchange === exchange/);
});
