import crypto from "node:crypto";

export const DEFAULT_RECV_WINDOW = 5_000;

export function buildV5SigningPayload({ timestamp, apiKey, recvWindow = DEFAULT_RECV_WINDOW, queryString = "", body = "" }) {
  return `${String(timestamp)}${String(apiKey)}${String(recvWindow)}${queryString || body}`;
}

export function hmacSha256Hex(secret, payload) {
  return crypto.createHmac("sha256", String(secret)).update(String(payload)).digest("hex");
}

export function signV5Request({
  apiKey,
  apiSecret,
  timestamp = Date.now(),
  recvWindow = DEFAULT_RECV_WINDOW,
  queryString = "",
  body = "",
}) {
  if (!apiKey) throw new Error("Bybit API key is not configured");
  if (!apiSecret) throw new Error("Bybit API secret is not configured");

  const ts = String(timestamp);
  const window = String(recvWindow);
  const payload = buildV5SigningPayload({
    timestamp: ts,
    apiKey,
    recvWindow: window,
    queryString,
    body,
  });

  return {
    "X-BAPI-API-KEY": String(apiKey),
    "X-BAPI-TIMESTAMP": ts,
    "X-BAPI-RECV-WINDOW": window,
    "X-BAPI-SIGN-TYPE": "2",
    "X-BAPI-SIGN": hmacSha256Hex(apiSecret, payload),
  };
}

export const signV5 = signV5Request;
