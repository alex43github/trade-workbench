import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const liveStatusSource = fs.readFileSync(new URL("../app/trade/LiveStrategyStatusList.tsx", import.meta.url), "utf8");
const stylesSource = fs.readFileSync(new URL("../app/trade/trade.module.css", import.meta.url), "utf8");

test("已手动撤销且零成交的入场尝试不占用关键策略视图", async () => {
  const { activeEntryQuantity, shouldShowHistoricalAttempt } = await import("../lib/trade/live-strategy-display.ts");
  const canceledEmpty = { intent: "ENTRY", generation: 3, status: "CANCELED", quantity: "35", executedQuantity: "0" };
  const canceledPartial = { intent: "ENTRY", generation: 3, status: "CANCELED", quantity: "35", executedQuantity: "4" };
  const active = { intent: "ENTRY", generation: 3, status: "SUBMITTED", quantity: "35", executedQuantity: "4" };
  const previousGeneration = { intent: "ENTRY", generation: 2, status: "SUBMITTED", quantity: "80", executedQuantity: "0" };

  assert.equal(shouldShowHistoricalAttempt(canceledEmpty), false);
  assert.equal(shouldShowHistoricalAttempt(canceledPartial), true);
  assert.equal(activeEntryQuantity([canceledEmpty, canceledPartial, active, previousGeneration], 3), 31);
});

test("订单异常仅以可悬停的原因入口呈现，不把原始错误塞入订单正文", async () => {
  const { orderFailureReason } = await import("../lib/trade/live-strategy-display.ts");

  assert.equal(orderFailureReason({ status: "FILLED", error: null }), null);
  assert.equal(orderFailureReason({ status: "CANCELED", error: null }), null);
  assert.equal(orderFailureReason({ status: "REJECTED", error: "Post Only order would be rejected" }), "Post Only order would be rejected");
  assert.equal(orderFailureReason({ status: "UNKNOWN", error: null }), "订单状态未知，需要核对交易所结果");
  assert.equal(orderFailureReason({ status: "SUBMITTED", error: "撤单请求失败" }), "撤单请求失败");
});

test("策略风险标签展示总保证金和实际可用的杠杆快照", async () => {
  const { strategyRiskLabel } = await import("../lib/trade/live-strategy-display.ts");

  assert.equal(strategyRiskLabel(20, 75), "20U × 75");
  assert.equal(strategyRiskLabel("20.5", "12.5"), "20.5U × 12.5");
  assert.equal(strategyRiskLabel(20, null), "20U × 杠杆未记录");
});

test("实盘策略按真实 entry executedQuantity 分为未完成在上和完整入场在下", () => {
  assert.match(liveStatusSource, /entryFillState/);
  assert.match(liveStatusSource, /executedQuantity/);
  assert.match(liveStatusSource, /quantity/);
  assert.match(liveStatusSource, /activeStrategies/);
  assert.match(liveStatusSource, /filledStrategies/);
  assert.match(liveStatusSource, /liveStrategyGroupDivider/);
  assert.match(liveStatusSource, /data-status-group="active"/);
  assert.match(liveStatusSource, /data-status-group="filled"/);
  assert.match(stylesSource, /liveStrategyGroupDivider/);
  assert.match(stylesSource, /border[^;]*[3-9]px|border-top[^;]*[3-9]px/);
});
