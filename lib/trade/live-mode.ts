export type RealTradingStatus = {
  canPlaceOrders: boolean;
  switchOn: boolean;
  tone: "live" | "off";
  label: string;
  detail: string;
};

export function resolveRealTradingStatus({
  routeEnabled,
  accountConnected,
  switchOn,
}: {
  routeEnabled: boolean;
  accountConnected: boolean;
  switchOn: boolean;
}): RealTradingStatus {
  if (routeEnabled && accountConnected && switchOn) {
    return {
      canPlaceOrders: true,
      switchOn: true,
      tone: "live",
      label: "实盘：开启 · 可下单",
      detail: "真实订单接口已启用，请先确认风控条件。",
    };
  }
  if (!accountConnected) {
    return {
      canPlaceOrders: false,
      switchOn: false,
      tone: "off",
      label: "实盘：关闭 · 未连接（不能下单）",
      detail: "尚未连接可交易账户，不能下单。",
    };
  }
  return {
    canPlaceOrders: false,
    switchOn: false,
    tone: "off",
    label: "实盘：关闭 · 仅只读（不能下单）",
      detail: "真实交易接口或服务端交易开关未同时开启，当前仅可只读查看。",
  };
}
