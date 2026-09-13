const SYMBOL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const ORDER_LINK_ID_PATTERN = /^(?:web|tele)BY[A-Za-z0-9_-]{1,31}$/;
const ORDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const CREATE_KEYS = new Set([
  "category",
  "symbol",
  "side",
  "orderType",
  "qty",
  "price",
  "timeInForce",
  "positionIdx",
  "orderLinkId",
  "triggerDirection",
  "triggerPrice",
  "reduceOnly",
  "closeOnTrigger",
]);
const CANCEL_KEYS = new Set(["category", "symbol", "orderId", "orderLinkId"]);

function parseBody(body) {
  if (body && typeof body === "object" && !Array.isArray(body)) return body;
  if (typeof body !== "string" || !body.trim()) throw new Error("订单请求体必须是 JSON 对象");
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error("订单请求体必须是合法 JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("订单请求体必须是 JSON 对象");
  }
  return parsed;
}

function rejectUnknownKeys(input, allowed) {
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) throw new Error("订单参数包含未允许字段");
  }
}

function requireSymbol(input) {
  if (typeof input.symbol !== "string" || !SYMBOL_PATTERN.test(input.symbol)) {
    throw new Error("订单必须包含合法 symbol");
  }
  return input.symbol.toUpperCase();
}

function requirePositiveDecimal(value, field) {
  if (typeof value !== "string" || !DECIMAL_PATTERN.test(value) || Number(value) <= 0) {
    throw new Error(`${field} 必须是正数`);
  }
  return value;
}

function requireOrderLinkId(value) {
  if (typeof value !== "string" || !ORDER_LINK_ID_PATTERN.test(value)) {
    throw new Error("orderLinkId 必须使用 webBY 或 teleBY 前缀");
  }
  return value;
}

function requirePositionIdx(value) {
  if (value === undefined) return 0;
  if (value === 0 || value === "0") return 0;
  if (value === 1 || value === "1") return 1;
  if (value === 2 || value === "2") return 2;
  throw new Error("positionIdx 必须为 0、1 或 2");
}

function requireTriggerDirection(value) {
  if (value === 1 || value === "1") return 1;
  if (value === 2 || value === "2") return 2;
  throw new Error("triggerDirection 必须为 1（上涨）或 2（下跌）");
}

function normalizeCreate(input) {
  rejectUnknownKeys(input, CREATE_KEYS);
  const output = {
    category: "linear",
    symbol: requireSymbol(input),
  };
  if (input.side !== "Buy" && input.side !== "Sell") throw new Error("side 必须为 Buy 或 Sell");
  if (input.orderType !== "Limit" && input.orderType !== "Market") throw new Error("orderType 不在允许范围");
  output.side = input.side;
  output.orderType = input.orderType;
  output.qty = requirePositiveDecimal(input.qty, "qty");
  output.positionIdx = requirePositionIdx(input.positionIdx);
  output.orderLinkId = requireOrderLinkId(input.orderLinkId);

  if (input.orderType === "Limit") {
    if (input.triggerDirection !== undefined || input.triggerPrice !== undefined || input.closeOnTrigger !== undefined) {
      throw new Error("限价单不允许条件触发字段");
    }
    output.price = requirePositiveDecimal(input.price, "price");
    if (input.timeInForce !== "PostOnly") throw new Error("限价单必须使用 PostOnly");
    output.timeInForce = "PostOnly";
    if (input.reduceOnly !== undefined && typeof input.reduceOnly !== "boolean") {
      throw new Error("reduceOnly 必须是布尔值");
    }
    if (input.reduceOnly === true) {
      output.reduceOnly = true;
    }
    return output;
  }

  const conditional = input.triggerDirection !== undefined || input.triggerPrice !== undefined || input.closeOnTrigger !== undefined;
  if (conditional) {
    if (input.reduceOnly !== true) throw new Error("条件市价单必须是 reduceOnly 平仓单");
    output.triggerDirection = requireTriggerDirection(input.triggerDirection);
    output.triggerPrice = requirePositiveDecimal(input.triggerPrice, "triggerPrice");
    if (input.closeOnTrigger !== true) throw new Error("条件市价单必须是 closeOnTrigger 平仓单");
    output.reduceOnly = true;
    output.closeOnTrigger = true;
    if (input.price !== undefined || input.timeInForce !== undefined) {
      throw new Error("条件市价单不允许 price 或 timeInForce");
    }
    return output;
  }

  if (input.reduceOnly !== true) throw new Error("市价单必须是 reduceOnly 平仓单");
  if (input.price !== undefined || input.timeInForce !== undefined) {
    throw new Error("市价平仓单不允许 price 或 timeInForce");
  }
  if (input.closeOnTrigger !== undefined) throw new Error("普通市价平仓单不允许 closeOnTrigger");
  output.reduceOnly = true;
  return output;
}

function normalizeCancel(input) {
  rejectUnknownKeys(input, CANCEL_KEYS);
  const output = {
    category: "linear",
    symbol: requireSymbol(input),
  };
  const hasOrderId = input.orderId !== undefined;
  const hasOrderLinkId = input.orderLinkId !== undefined;
  if (hasOrderId === hasOrderLinkId) throw new Error("撤单必须且只能包含 orderId 或 orderLinkId");
  if (hasOrderId) {
    if (typeof input.orderId !== "string" || !ORDER_ID_PATTERN.test(input.orderId)) {
      throw new Error("orderId 不合法");
    }
    output.orderId = input.orderId;
  } else {
    output.orderLinkId = requireOrderLinkId(input.orderLinkId);
  }
  return output;
}

export function normalizeOrderPayload(method, pathname, body) {
  const input = parseBody(body);
  if (method === "POST" && pathname === "/v5/order/create") return normalizeCreate(input);
  if (method === "POST" && pathname === "/v5/order/cancel") return normalizeCancel(input);
  throw new Error("订单路径不在允许范围");
}

export function validateOrderPayload(method, pathname, body) {
  try {
    normalizeOrderPayload(method, pathname, body);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "订单参数不合法";
  }
}
