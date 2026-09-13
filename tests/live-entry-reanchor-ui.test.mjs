import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const liveStatusSource = fs.readFileSync(new URL("../app/trade/LiveStrategyStatusList.tsx", import.meta.url), "utf8");
const routeSource = fs.readFileSync(new URL("../app/api/trade/live-strategies/route.ts", import.meta.url), "utf8");
const telegramSource = fs.readFileSync(new URL("../lib/telegram/handler.ts", import.meta.url), "utf8");

test("live strategy status exposes reanchor generation, target progress, freeze, reconciliation, and read-only history", () => {
  for (const label of ["第 ", "轮", "已成交 / 待补齐", "锚定已收盘K线", "下一次刷新", "止损冻结并撤余单", "需要对账", "目标已全部成交", "已完整退出", "历史订单尝试（只读）"]) {
    assert.match(liveStatusSource, new RegExp(label));
  }
  assert.match(liveStatusSource, /strategy\.currentGeneration/);
  assert.match(liveStatusSource, /data-error-detail/);
  assert.match(liveStatusSource, /strategy\.lifecycle/);
  assert.match(liveStatusSource, /strategy\.attempts/);
  for (const transition of ["创建", "成交", "撤销", "替换"]) assert.match(liveStatusSource, new RegExp(transition));
});

test("live strategy API returns hydrated reanchor fields without calling an order gateway", () => {
  assert.match(routeSource, /listLiveStrategies/);
  assert.match(routeSource, /currentGeneration/);
  assert.match(routeSource, /lifecycle/);
  assert.match(routeSource, /attempts/);
  assert.doesNotMatch(routeSource, /cancelOrder|placeOrder|binanceGateway/);
});

test("live strategy status shows a retryable reanchor error without labelling it as an order reconciliation failure", () => {
  assert.match(liveStatusSource, /lastError/);
  assert.match(liveStatusSource, /刷新暂未完成，将自动重试/);
});

test("Telegram notification contract limits strategy lifecycle notices to the specified safe transition types", () => {
  for (const label of ["替换成功", "目标已全部成交", "止损冻结并撤余单", "需要对账", "策略生命周期已关闭"]) {
    assert.match(telegramSource, new RegExp(label));
  }
  assert.match(telegramSource, /formatLiveStrategyNotification/);
  assert.match(telegramSource, /strategy\.id/);
  assert.match(telegramSource, /clientOrderId/);
  assert.doesNotMatch(telegramSource, /TELEGRAM_BOT_TOKEN|apiSecret|apiKey|gatewayResponse/);
});
