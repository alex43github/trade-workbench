function normalizedDecimal(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [integer, fraction = ""] = text.split(".");
  const whole = integer.replace(/^0+(?=\d)/, "");
  const decimal = fraction.replace(/0+$/, "");
  return decimal ? `${whole}.${decimal}` : whole;
}

function absoluteDecimal(value) {
  const text = String(value ?? "").trim();
  const unsigned = text.startsWith("-") || text.startsWith("+") ? text.slice(1) : text;
  return normalizedDecimal(unsigned);
}

function compareDecimals(left, right) {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(leftInteger + leftFraction.padEnd(scale, "0"));
  const rightValue = BigInt(rightInteger + rightFraction.padEnd(scale, "0"));
  return leftValue === rightValue ? 0 : leftValue > rightValue ? 1 : -1;
}

function subtractDecimals(left, right) {
  const [leftInteger, leftFraction = ""] = left.split(".");
  const [rightInteger, rightFraction = ""] = right.split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftValue = BigInt(leftInteger + leftFraction.padEnd(scale, "0"));
  const rightValue = BigInt(rightInteger + rightFraction.padEnd(scale, "0"));
  if (rightValue >= leftValue) return "0";
  const value = (leftValue - rightValue).toString().padStart(scale + 1, "0");
  const integer = scale ? value.slice(0, -scale) : value;
  const fraction = scale ? value.slice(-scale).replace(/0+$/, "") : "";
  return fraction ? `${integer}.${fraction}` : integer;
}

function activeOpenOrder(status) {
  return ["NEW", "PARTIALLY_FILLED", "PENDING_NEW", "PENDING_CANCEL"].includes(String(status ?? "").toUpperCase());
}

function finishedOrder(status) {
  return ["FILLED", "CANCELED", "EXPIRED", "REJECTED"].includes(String(status ?? "").toUpperCase());
}

function trueValue(value) {
  return value === true || value === "true";
}

/** Same client id is a replay only when every exposure-affecting field agrees. */
export function matchesExitOnlySemantics(params, order) {
  const expected = {
    symbol: String(params.get("symbol") ?? "").toUpperCase(),
    side: String(params.get("side") ?? "").toUpperCase(),
    positionSide: String(params.get("positionSide") ?? "BOTH").toUpperCase(),
    type: String(params.get("type") ?? "").toUpperCase(),
    quantity: normalizedDecimal(params.get("quantity")),
    price: params.has("price") ? normalizedDecimal(params.get("price")) : null,
    stopPrice: params.has("stopPrice") ? normalizedDecimal(params.get("stopPrice")) : null,
  };
  const actual = {
    symbol: String(order?.symbol ?? "").toUpperCase(), side: String(order?.side ?? "").toUpperCase(),
    positionSide: String(order?.positionSide ?? "BOTH").toUpperCase(), type: String(order?.type ?? "").toUpperCase(),
    quantity: normalizedDecimal(order?.origQty), price: order?.price == null || String(order.price) === "0" ? null : normalizedDecimal(order.price),
    stopPrice: order?.stopPrice == null || String(order.stopPrice) === "0" ? null : normalizedDecimal(order.stopPrice),
  };
  return Object.entries(expected).every(([key, value]) => value === actual[key]);
}

function reservedExitQuantity(openOrders, symbol, mode, targetPositionSide, expectedSide) {
  if (!Array.isArray(openOrders)) return { error: "EXIT_ONLY 缺少权威 openOrders 核验" };
  let reserved = "0";
  for (const order of openOrders) {
    if (String(order?.symbol ?? "").toUpperCase() !== symbol) continue;
    if (finishedOrder(order?.status)) continue;
    if (!activeOpenOrder(order?.status)) return { error: "EXIT_ONLY openOrders 包含无法判定终态的订单" };
    if (trueValue(order?.closePosition)) return { error: "EXIT_ONLY openOrders 存在无法量化的 closePosition 订单" };
    const positionSide = String(order?.positionSide ?? "").toUpperCase();
    const side = String(order?.side ?? "").toUpperCase();
    const reduceOnly = trueValue(order?.reduceOnly);
    if (mode === "ONE_WAY") {
      if (positionSide !== "BOTH" || !reduceOnly) return { error: "EXIT_ONLY openOrders 存在无法安全归类的单向订单" };
      if (side !== expectedSide) return { error: "EXIT_ONLY openOrders 存在方向冲突的单向退出订单" };
    } else {
      if (!["LONG", "SHORT"].includes(positionSide)) return { error: "EXIT_ONLY openOrders 存在模式不一致订单" };
      if (reduceOnly) return { error: "EXIT_ONLY openOrders 的双向订单不得携带 reduceOnly" };
      if (positionSide !== targetPositionSide || side !== expectedSide) continue;
    }
    const original = normalizedDecimal(order?.origQty);
    const executed = normalizedDecimal(order?.executedQty);
    if (!original || !executed || compareDecimals(executed, original) > 0) return { error: "EXIT_ONLY openOrders 包含非法剩余数量" };
    const remaining = subtractDecimals(original, executed);
    if (remaining === "0") continue;
    const [sumInteger, sumFraction = ""] = reserved.split(".");
    const [remainingInteger, remainingFraction = ""] = remaining.split(".");
    const scale = Math.max(sumFraction.length, remainingFraction.length);
    const total = BigInt(sumInteger + sumFraction.padEnd(scale, "0")) + BigInt(remainingInteger + remainingFraction.padEnd(scale, "0"));
    const value = total.toString().padStart(scale + 1, "0");
    reserved = normalizedDecimal(scale ? `${value.slice(0, -scale)}.${value.slice(-scale)}` : value);
  }
  return { reserved };
}

function authorizeExitOnly(params, authority) {
  if (!Array.isArray(authority?.positionRows)) return "EXIT_ONLY 缺少网关权威仓位核验";
  const symbol = String(params.get("symbol") ?? "").toUpperCase();
  const side = String(params.get("side") ?? "").toUpperCase();
  const requestedPositionSide = String(params.get("positionSide") ?? "").toUpperCase();
  const quantity = normalizedDecimal(params.get("quantity"));
  const type = String(params.get("type") ?? "").toUpperCase();
  if (!symbol || !quantity || quantity === "0" || !params.get("newClientOrderId")) return "EXIT_ONLY 缺少必要订单参数";
  if (trueValue(params.get("closePosition"))) return "EXIT_ONLY 不允许 closePosition";
  if (!(["MARKET", "LIMIT", "STOP_MARKET", "TAKE_PROFIT_MARKET"].includes(type))) return "EXIT_ONLY 订单类型不被允许";
  if (type === "LIMIT" && (params.get("timeInForce") !== "GTC" || !params.get("price"))) return "EXIT_ONLY 限价保护单必须使用 GTC 并提供价格";
  if ((type === "STOP_MARKET" || type === "TAKE_PROFIT_MARKET") && !params.get("stopPrice")) return "EXIT_ONLY 条件保护单必须提供 stopPrice";

  const rows = authority.positionRows.filter((row) => String(row?.symbol ?? "").toUpperCase() === symbol);
  const hasBoth = rows.some((row) => String(row?.positionSide ?? "").toUpperCase() === "BOTH");
  const hasHedge = rows.some((row) => ["LONG", "SHORT"].includes(String(row?.positionSide ?? "").toUpperCase()));
  const bothRows = rows.filter((row) => String(row?.positionSide ?? "").toUpperCase() === "BOTH");
  const longRows = rows.filter((row) => String(row?.positionSide ?? "").toUpperCase() === "LONG");
  const shortRows = rows.filter((row) => String(row?.positionSide ?? "").toUpperCase() === "SHORT");
  if (hasBoth && hasHedge || bothRows.length > 1 || longRows.length > 1 || shortRows.length > 1) return "权威仓位返回了冲突或重复的持仓模式";

  let currentAmount;
  let mode;
  let expectedSide;
  let targetPositionSide;
  if (hasBoth) {
    if (requestedPositionSide && requestedPositionSide !== "BOTH") return "EXIT_ONLY 单向模式 positionSide 必须为 BOTH";
    if (params.get("reduceOnly") !== "true") return "EXIT_ONLY 单向模式必须 reduceOnly=true";
    const row = rows.find((item) => String(item?.positionSide ?? "").toUpperCase() === "BOTH");
    currentAmount = String(row?.positionAmt ?? "0").trim();
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(currentAmount) || absoluteDecimal(currentAmount) === "0") return "EXIT_ONLY 没有可退出仓位";
    expectedSide = currentAmount.startsWith("-") ? "BUY" : "SELL";
    if (side !== expectedSide) return "EXIT_ONLY 方向与权威单向仓位不一致";
    params.set("positionSide", "BOTH");
    params.set("reduceOnly", "true");
    mode = "ONE_WAY";
    targetPositionSide = "BOTH";
  } else if (hasHedge) {
    if (!["LONG", "SHORT"].includes(requestedPositionSide)) return "EXIT_ONLY 双向模式 positionSide 必须为 LONG 或 SHORT";
    if (params.has("reduceOnly")) return "EXIT_ONLY 双向模式不得发送 reduceOnly";
    const row = rows.find((item) => String(item?.positionSide ?? "").toUpperCase() === requestedPositionSide);
    currentAmount = String(row?.positionAmt ?? "0").trim();
    expectedSide = requestedPositionSide === "LONG" ? "SELL" : "BUY";
    const validAmount = requestedPositionSide === "LONG" ? /^\+?\d+(?:\.\d+)?$/.test(currentAmount) && absoluteDecimal(currentAmount) !== "0"
      : /^-\d+(?:\.\d+)?$/.test(currentAmount) && absoluteDecimal(currentAmount) !== "0";
    if (!validAmount) return "EXIT_ONLY 没有可退出仓位";
    if (side !== expectedSide) return "EXIT_ONLY 方向与权威双向仓位不一致";
    mode = "HEDGE";
    targetPositionSide = requestedPositionSide;
  } else return "EXIT_ONLY 无法从权威仓位确认持仓模式";

  const reservation = reservedExitQuantity(authority.openOrders, symbol, mode, targetPositionSide, expectedSide);
  if (reservation.error) return reservation.error;
  const liveQuantity = absoluteDecimal(currentAmount);
  const available = subtractDecimals(liveQuantity, reservation.reserved);
  if (available === "0") return "EXIT_ONLY 没有可用退出仓位";
  params.set("quantity", compareDecimals(quantity, available) > 0 ? available : quantity);
  params.delete("workbenchOrderIntent");
  authority.normalizedBody = params.toString();
  return null;
}

export function isExitOnlyOrder(body) {
  return new URLSearchParams(body || "").get("workbenchOrderIntent") === "EXIT_ONLY";
}

export function validateOrderPayload(method, pathname, body, query = "", authority) {
  if (pathname !== "/fapi/v1/order") return null;
  if (method === "GET") return null;
  if (method === "DELETE") {
    const params = new URLSearchParams(query);
    if (!params.get("symbol") || (!params.get("orderId") && !params.get("origClientOrderId"))) return "撤单必须包含 symbol 与订单编号";
    return null;
  }
  if (method !== "POST") return null;
  const params = new URLSearchParams(body || "");
  const intent = params.get("workbenchOrderIntent");
  if (intent === "EXIT_ONLY") return authorizeExitOnly(params, authority);
  if (intent !== "ENTRY") return "ENTRY 订单必须由受控提交链路明确标记";
  params.delete("workbenchOrderIntent");
  const type = params.get("type");
  const common = params.get("symbol") && params.get("side") && params.get("quantity") && params.get("newClientOrderId");
  const positionSide = params.get("positionSide");
  const clientOrderId = params.get("newClientOrderId") || "";
  if (params.has("reduceOnly")) return "ENTRY 订单不得携带 reduceOnly";
  const marketEntry = common && type === "MARKET" && (positionSide === "LONG" || positionSide === "SHORT")
    && /^(tele|web)MK[A-Za-z0-9_-]{8,64}$/i.test(clientOrderId);
  if (marketEntry) return null;
  if (type === "LIMIT" && params.get("timeInForce") === "GTX" && params.get("symbol") && params.get("side") && params.get("price") && params.get("quantity") && params.get("newClientOrderId")
    && (positionSide === "BOTH" || positionSide === "LONG" || positionSide === "SHORT")) return null;
  return "订单参数不符合已批准的 ENTRY 限价挂单或市价入场规则";
}
