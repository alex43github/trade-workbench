const PROJECT_CLIENT_ORDER_ID_PREFIX = /^(?:alex|tele|web|tw)/i;

type BinanceOrderLike = {
  clientOrderId?: unknown;
  orderId?: unknown;
};

export function isProjectClientOrderId(value: unknown) {
  const clientOrderId = String(value ?? "").trim();
  return clientOrderId.length > 0 && PROJECT_CLIENT_ORDER_ID_PREFIX.test(clientOrderId);
}

export function manualSourceOrderId(order: BinanceOrderLike): string | null {
  const clientOrderId = String(order.clientOrderId ?? "").trim();
  if (clientOrderId) return isProjectClientOrderId(clientOrderId) ? null : clientOrderId;

  const orderId = String(order.orderId ?? "").trim();
  return orderId ? `binance-${orderId}` : null;
}
