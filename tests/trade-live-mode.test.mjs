import assert from "node:assert/strict";
import test from "node:test";
import { resolveRealTradingStatus } from "../lib/trade/live-mode.ts";

test("read-only connected account stays explicitly unable to place real orders", () => {
  assert.deepEqual(resolveRealTradingStatus({ routeEnabled: false, accountConnected: true, switchOn: false }), {
    canPlaceOrders: false,
    switchOn: false,
    tone: "off",
    label: "实盘：关闭 · 仅只读（不能下单）",
    detail: "真实交易接口或服务端交易开关未同时开启，当前仅可只读查看。",
  });
});

test("real trading is green only when the route, account and switch are all enabled", () => {
  assert.deepEqual(resolveRealTradingStatus({ routeEnabled: true, accountConnected: true, switchOn: true }), {
    canPlaceOrders: true,
    switchOn: true,
    tone: "live",
    label: "实盘：开启 · 可下单",
    detail: "真实订单接口已启用，请先确认风控条件。",
  });
});

test("an unconnected account cannot be made live by the switch alone", () => {
  assert.deepEqual(resolveRealTradingStatus({ routeEnabled: true, accountConnected: false, switchOn: true }), {
    canPlaceOrders: false,
    switchOn: false,
    tone: "off",
    label: "实盘：关闭 · 未连接（不能下单）",
    detail: "尚未连接可交易账户，不能下单。",
  });
});
