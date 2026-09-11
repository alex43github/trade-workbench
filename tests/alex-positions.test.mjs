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

test("discovers every executed native order with a raw client id and excludes project orders", async () => {
  const { getAlexManualPositions } = await positions();
  let aliasCalls = 0;
  const result = await getAlexManualPositions({
    readPositionRisk: async () => fakePositionRisk().map((item) => item.symbol === "BTCUSDT" ? { ...item, positionAmt: "2.5" } : item),
    resolveManualOrderAlias: async () => { aliasCalls += 1; return "alex-should-not-be-created"; },
    readAllOrders: async (symbol) => symbol === "BTCUSDT" ? [
      { orderId: 1, clientOrderId: "alex0001", side: "BUY", type: "LIMIT", executedQty: "1", reduceOnly: false },
      { orderId: 2, clientOrderId: "x-manual-btc", side: "BUY", type: "LIMIT", executedQty: "1", reduceOnly: false },
      { orderId: 12, clientOrderId: "ios_coin_pump", side: "BUY", type: "MARKET", executedQty: "0.25", reduceOnly: false },
      { orderId: 14, clientOrderId: "ios_st_btc", side: "BUY", type: "STOP_MARKET", executedQty: "0.25", reduceOnly: false },
      { orderId: 3, clientOrderId: "tele0001", side: "BUY", type: "LIMIT", executedQty: "0.5", reduceOnly: false },
      { orderId: 4, clientOrderId: "web0004", side: "BUY", type: "LIMIT", executedQty: "0.25", reduceOnly: false },
      { orderId: 5, clientOrderId: "tw0005", side: "BUY", type: "LIMIT", executedQty: "0.25", reduceOnly: false },
      { orderId: 6, side: "BUY", type: "MARKET", executedQty: "0.25", reduceOnly: false },
      { orderId: 13, clientOrderId: "tele0002", side: "BUY", type: "LIMIT", executedQty: "1", reduceOnly: false },
      { orderId: 7, clientOrderId: "alexTP0007", side: "SELL", type: "TAKE_PROFIT_MARKET", executedQty: "0.25", reduceOnly: true },
      { orderId: 8, clientOrderId: "manual-unfilled", side: "BUY", type: "LIMIT", executedQty: "0", reduceOnly: false },
    ] : [
      { orderId: 9, clientOrderId: "manual-eth-1", side: "SELL", type: "MARKET", executedQty: "2", reduceOnly: false },
      { orderId: 10, clientOrderId: "alex0005", side: "SELL", type: "MARKET", executedQty: "2", reduceOnly: false },
      { orderId: 11, clientOrderId: "web0006", side: "SELL", type: "LIMIT", executedQty: "2", reduceOnly: false },
    ],
  });
  assert.equal(result.connected, true);
  assert.deepEqual(result.positions.map((item) => ({
    symbol: item.symbol,
    side: item.side,
    sourceOrderIds: item.sourceOrderIds,
    manualAliasIds: item.manualAliasIds,
    quantity: item.quantity,
    otherQuantity: item.otherQuantity,
    manualNotional: item.manualNotional,
    otherNotional: item.otherNotional,
  })), [
    {
      symbol: "BTCUSDT",
      side: "LONG",
      sourceOrderIds: ["x-manual-btc", "ios_coin_pump", "ios_st_btc"],
      manualAliasIds: undefined,
      quantity: 1.5,
      otherQuantity: 1,
      manualNotional: 157.5,
      otherNotional: 105,
    },
    {
      symbol: "ETHUSDT",
      side: "SHORT",
      sourceOrderIds: ["manual-eth-1"],
      manualAliasIds: undefined,
      quantity: 2,
      otherQuantity: 0,
      manualNotional: 380,
      otherNotional: 0,
    },
  ]);
  assert.match(result.positions[0].candidateId, /^[a-z0-9_-]{8,64}$/);
  assert.equal(result.positions[0].totalQuantity, 2.5);
  assert.equal(result.positions[0].totalNotional, 262.5);
  assert.equal(result.positions[0].manualMargin, 15.75);
  assert.equal(result.positions[0].otherMargin, 10.5);
  assert.equal(aliasCalls, 0);
});

test("does not expose a candidate when account lookup fails", async () => {
  const { getAlexManualPositions } = await positions();
  const result = await getAlexManualPositions({ readPositionRisk: async () => { throw new Error("gateway down"); } });
  assert.deepEqual(result, { connected: false, reason: "币安持仓来源查询暂时不可用", positions: [] });
});

test("keeps Binance native web client ids while excluding only known project id formats", async () => {
  const { getAlexManualPositions } = await positions();
  const result = await getAlexManualPositions({
    readPositionRisk: async () => [{ symbol: "DEXEUSDT", positionAmt: "2", entryPrice: "10", markPrice: "10", leverage: "10" }],
    readAllOrders: async () => [
      { clientOrderId: "web_binance_aa1abc1234def567ghi890", side: "BUY", executedQty: "1", reduceOnly: false },
      { clientOrderId: "webIN1abc123", side: "BUY", executedQty: "1", reduceOnly: false },
    ],
  });
  assert.equal(result.connected, true);
  assert.deepEqual(result.positions.map((item) => item.sourceOrderIds), [["web_binance_aa1abc1234def567ghi890"]]);
});

test("uses an ASCII-safe source fill id for a Unicode Binance symbol", async () => {
  const { getAlexManualPositions } = await positions();
  const result = await getAlexManualPositions({
    readPositionRisk: async () => [{ symbol: "龙虾USDT", positionAmt: "-2", entryPrice: "10", markPrice: "10", leverage: "10" }],
    readAllOrders: async () => [{ clientOrderId: "web_binance_manual_01", side: "SELL", executedQty: "2", reduceOnly: false }],
  });
  assert.equal(result.connected, true);
  assert.match(result.positions[0].sourceFillId, /^[A-Za-z0-9:_-]{1,160}$/);
});
