export function validateOrderPayload(method, pathname, body) {
  if (pathname !== "/fapi/v1/order") return null;
  const params = new URLSearchParams(body || "");
  if (method === "GET") return null;
  if (method === "DELETE") {
    if (!params.get("symbol") || (!params.get("orderId") && !params.get("origClientOrderId"))) return "撤单必须包含 symbol 与订单编号";
    return null;
  }
  if (method !== "POST") return null;
  const type = params.get("type");
  const common = params.get("symbol") && params.get("side") && params.get("quantity") && params.get("newClientOrderId");
  const positionSide = params.get("positionSide");
  const oneWayReduceOnly = params.get("reduceOnly") === "true" && (!positionSide || positionSide === "BOTH");
  const hedgeModeClose = (positionSide === "LONG" || positionSide === "SHORT") && !params.has("reduceOnly");
  const marketClose = common && (oneWayReduceOnly || hedgeModeClose);
  if (marketClose && type === "MARKET") return null;
  if (common && oneWayReduceOnly && (type === "STOP_MARKET" || type === "TAKE_PROFIT_MARKET") && params.get("stopPrice")) return null;
  if (type === "LIMIT" && params.get("timeInForce") === "GTX" && params.get("symbol") && params.get("side") && params.get("price") && params.get("quantity") && params.get("newClientOrderId")) return null;
  return "订单参数不符合已批准的限价挂单、保护性条件单或市价只减仓平仓规则";
}
