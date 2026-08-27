import assert from "node:assert/strict";
import test from "node:test";

const positions = () => import("../lib/trade/alex-positions.ts");

function fakePositionRisk() {
  return [
    { symbol: "BTCUSDT", positionAmt: "1.5", entryPrice: "100", markPrice: "105", unRealizedProfit: "7.5", leverage: "10" },
    { symbol: "ETHUSDT", positionAmt: "-2", entryPrice: "200", markPrice: "190", unRealizedProfit: "20", leverage: "5" },
    { symbol: "SOLUSDT", positionAmt: "0", entryPrice: "100", markPrice: "100", unRealizedProfit: "0", leverage: "3" },
  ];
}

test("discovers only executed non-reduce-only alex manual entry orders", async () => {
  const { getAlexManualPositions } = await positions();
  const result = await getAlexManualPositions({
    readPositionRisk: async () => fakePositionRisk(),
    readAllOrders: async (symbol) => symbol === "BTCUSDT" ? [
      { orderId: 1, clientOrderId: "alex0001", side: "BUY", type: "LIMIT", executedQty: "1", reduceOnly: false },
      { orderId: 2, clientOrderId: "tele0001", side: "BUY", type: "LIMIT", executedQty: "0.5", reduceOnly: false },
      { orderId: 3, clientOrderId: "alexTP0002", side: "SELL", type: "TAKE_PROFIT_MARKET", executedQty: "0", reduceOnly: true },
      { orderId: 4, clientOrderId: "alex0004", side: "BUY", type: "LIMIT", executedQty: "0", reduceOnly: false },
    ] : [
      { orderId: 5, clientOrderId: "alex0005", side: "SELL", type: "MARKET", executedQty: "2", reduceOnly: false },
      { orderId: 6, clientOrderId: "web0006", side: "SELL", type: "LIMIT", executedQty: "2", reduceOnly: false },
    ],
  });
  assert.equal(result.connected, true);
  assert.deepEqual(result.positions.map((item) => ({ symbol: item.symbol, side: item.side, sourceOrderIds: item.sourceOrderIds, quantity: item.quantity })), [
    { symbol: "BTCUSDT", side: "LONG", sourceOrderIds: ["alex0001"], quantity: 1 },
    { symbol: "ETHUSDT", side: "SHORT", sourceOrderIds: ["alex0005"], quantity: 2 },
  ]);
  assert.match(result.positions[0].candidateId, /^[a-z0-9_-]{8,64}$/);
});

test("does not expose a candidate when account lookup fails", async () => {
  const { getAlexManualPositions } = await positions();
  const result = await getAlexManualPositions({ readPositionRisk: async () => { throw new Error("gateway down"); } });
  assert.deepEqual(result, { connected: false, reason: "币安持仓来源查询暂时不可用", positions: [] });
});
