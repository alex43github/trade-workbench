import assert from "node:assert/strict";
import test from "node:test";
import { PositionMonitor } from "../services/structure-radar/position-monitor.ts";

test("position monitor exposes a safe immutable snapshot for focus-pool membership", async () => {
  const monitor = new PositionMonitor({ now: () => 1000, getPositions: async () => [
    { symbol: "ENAUSDT", positionAmt: "12", entryPrice: "0.5", markPrice: "0.6" },
    { symbol: "LSKUSDT", positionAmt: "-4", entryPrice: "1.1", markPrice: "1.0" },
  ] });
  await monitor.poll();
  const snapshot = monitor.snapshot();
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.observedAt, 1000);
  assert.deepEqual(snapshot.positions.map((item) => [item.symbol, item.side, item.quantity]), [
    ["ENAUSDT", "LONG", 12], ["LSKUSDT", "SHORT", 4],
  ]);
  snapshot.positions[0].quantity = 999;
  assert.equal(monitor.snapshot().positions[0].quantity, 12);
});
