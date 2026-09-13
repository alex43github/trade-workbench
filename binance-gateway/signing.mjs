import crypto from "node:crypto";

function appendWithoutAuthFields(target, source) {
  for (const [key, value] of source) {
    if (key === "timestamp" || key === "recvWindow" || key === "signature") continue;
    target.append(key, value);
  }
}

function hmacHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/** Build Binance's signed query/body pair in the same order Binance verifies. */
export function signedRequestParts({ query = "", body = null, timestamp, recvWindow = 5000, secret }) {
  if (!secret) throw new Error("缺少签名密钥");
  if (!Number.isFinite(Number(timestamp))) throw new Error("签名时间戳无效");
  const unsigned = new URLSearchParams();
  appendWithoutAuthFields(unsigned, new URLSearchParams(query));
  appendWithoutAuthFields(unsigned, new URLSearchParams(body || ""));
  unsigned.set("timestamp", String(timestamp));
  unsigned.set("recvWindow", String(recvWindow));
  const signaturePayload = unsigned.toString();
  const signature = hmacHex(secret, signaturePayload);
  if (body) {
    const signedBody = new URLSearchParams(body);
    signedBody.delete("timestamp");
    signedBody.delete("recvWindow");
    signedBody.delete("signature");
    signedBody.set("timestamp", String(timestamp));
    signedBody.set("recvWindow", String(recvWindow));
    signedBody.set("signature", signature);
    return { query: new URLSearchParams(query).toString(), body: signedBody.toString(), signaturePayload };
  }
  const signedQuery = new URLSearchParams(query);
  signedQuery.delete("timestamp");
  signedQuery.delete("recvWindow");
  signedQuery.delete("signature");
  signedQuery.set("timestamp", String(timestamp));
  signedQuery.set("recvWindow", String(recvWindow));
  signedQuery.set("signature", signature);
  return { query: signedQuery.toString(), body, signaturePayload };
}
