import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";

process.env.STREETLIGHT_LOCAL_D1 = path.join(os.tmpdir(), `streetlight-order-alias-${process.pid}-${Date.now()}.sqlite`);
delete process.env.STREETLIGHT_LOCAL_TEST_MODE;

test("manual Binance order aliases are stable and use alex numbering", async () => {
  const { getOrCreateManualOrderAlias } = await import("../lib/trade/order-alias.ts");
  const first = await getOrCreateManualOrderAlias({ externalOrderId: "9001", clientOrderId: "manual-client-1", symbol: "BTCUSDT" });
  const replay = await getOrCreateManualOrderAlias({ externalOrderId: "9001", clientOrderId: "manual-client-1", symbol: "BTCUSDT" });
  const second = await getOrCreateManualOrderAlias({ externalOrderId: "9002", clientOrderId: "manual-client-2", symbol: "ETHUSDT" });
  const unicode = await getOrCreateManualOrderAlias({ externalOrderId: "9003", clientOrderId: "manual-client-3", symbol: "龙虾USDT" });
  assert.equal(first, "alex0001");
  assert.equal(replay, first);
  assert.equal(second, "alex0002");
  assert.equal(unicode, "alex0003");
});
