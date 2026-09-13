// Binance's native web client ids commonly start with `web_`.  Only reserve the
// concrete id formats that this application has generated, never a broad prefix.
const PROJECT_CLIENT_ORDER_ID_PATTERNS = [
  /^(?:alex|tele|web|tw)\d+$/i,
  /^(?:web|tele)IN\d+[A-Za-z0-9_-]+$/i,
  /^(?:alex|tele|web)(?:TP|SL)\d{8}$/i,
  /^alexMC[A-Za-z0-9]{16,32}$/i,
];

type BinanceOrderLike = {
  clientOrderId?: unknown;
  orderId?: unknown;
};

export function isProjectClientOrderId(value: unknown) {
  const clientOrderId = String(value ?? "").trim();
  return clientOrderId.length > 0 && PROJECT_CLIENT_ORDER_ID_PATTERNS.some((pattern) => pattern.test(clientOrderId));
}

export function manualSourceOrderId(order: BinanceOrderLike): string | null {
  const clientOrderId = String(order.clientOrderId ?? "").trim();
  if (clientOrderId) return isProjectClientOrderId(clientOrderId) ? null : clientOrderId;
  return null;
}
