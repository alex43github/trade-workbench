export function validateOrderPayload(method, pathname, body, query = "") {
  if (pathname !== "/fapi/v1/order") return null;
  if (method === "GET") return null;
  if (method === "DELETE") {
    const params = new URLSearchParams(query);
    if (!params.get("symbol") || (!params.get("orderId") && !params.get("origClientOrderId"))) return "撤单必须包含 symbol 与订单编号";
    return null;
  }
  const params = new URLSearchParams(body || "");
  if (method !== "POST") return null;
  const type = params.get("type");
  const common = params.get("symbol") && params.get("side") && params.get("quantity") && params.get("newClientOrderId");
  const positionSide = params.get("positionSide");
  const clientOrderId = params.get("newClientOrderId") || "";
  const oneWayReduceOnly = params.get("reduceOnly") === "true" && (!positionSide || positionSide === "BOTH");
  const hedgeModeClose = (positionSide === "LONG" || positionSide === "SHORT") && !params.has("reduceOnly");
  const knownHedgeMarketClose = hedgeModeClose && (
    /^alexMC[A-Za-z0-9]{16,32}$/i.test(clientOrderId)
    || /^(?:alex|tele|web)(?:TP|SL)\d+$/i.test(clientOrderId)
  );
  const marketEntry = common && type === "MARKET" && (positionSide === "LONG" || positionSide === "SHORT") && !params.has("reduceOnly")
    && /^(tele|web)MK[A-Za-z0-9_-]{8,64}$/i.test(clientOrderId);
  if (marketEntry) return null;
  if (common && type === "MARKET" && (oneWayReduceOnly || knownHedgeMarketClose)) return null;
  if (common && (oneWayReduceOnly || hedgeModeClose) && (type === "STOP_MARKET" || type === "TAKE_PROFIT_MARKET") && params.get("stopPrice")) return null;
  const entryPositionSide = params.get("positionSide");
  if (type === "LIMIT" && params.get("timeInForce") === "GTX" && params.get("symbol") && params.get("side") && params.get("price") && params.get("quantity") && params.get("newClientOrderId")
    && (entryPositionSide === "BOTH" || entryPositionSide === "LONG" || entryPositionSide === "SHORT")) return null;
  return "订单参数不符合已批准的限价挂单、保护性条件单或市价只减仓平仓规则";
}
