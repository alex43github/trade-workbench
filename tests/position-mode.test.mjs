import assert from "node:assert/strict";
import test from "node:test";

const { resolvePositionMode, positionSideForEntry, selectPositionRiskRow } = await import("../lib/trade/position-mode.ts");

test("recognizes Binance Hedge Mode from LONG/SHORT position-risk rows", () => {
  assert.equal(resolvePositionMode([
    { symbol: "BTCUSDT", positionSide: "LONG" },
    { symbol: "BTCUSDT", positionSide: "SHORT" },
  ]), "HEDGE");
  assert.equal(positionSideForEntry("LONG", "HEDGE"), "LONG");
  assert.equal(positionSideForEntry("SHORT", "HEDGE"), "SHORT");
});

test("recognizes one-way mode from BOTH position-risk rows", () => {
  assert.equal(resolvePositionMode([{ symbol: "BTCUSDT", positionSide: "BOTH" }]), "ONE_WAY");
  assert.equal(positionSideForEntry("LONG", "ONE_WAY"), "BOTH");
  assert.equal(positionSideForEntry("SHORT", "ONE_WAY"), "BOTH");
});

test("rejects an unusable or contradictory position-risk response", () => {
  assert.throws(() => resolvePositionMode([]), /持仓模式/);
  assert.throws(() => resolvePositionMode([{ positionSide: "LONG" }, { positionSide: "BOTH" }]), /持仓模式/);
});

test("selects the source side from hedge-mode rows instead of the first symbol row", () => {
  const rows = [
    { symbol: "BTCUSDT", positionSide: "SHORT", positionAmt: "-2", markPrice: "100" },
    { symbol: "BTCUSDT", positionSide: "LONG", positionAmt: "3", markPrice: "101" },
  ];
  assert.equal(selectPositionRiskRow(rows, "BTCUSDT", "LONG")?.positionSide, "LONG");
  assert.equal(selectPositionRiskRow(rows, "BTCUSDT", "SHORT")?.positionSide, "SHORT");
  assert.equal(selectPositionRiskRow(rows, "ETHUSDT", "LONG"), null);
});
