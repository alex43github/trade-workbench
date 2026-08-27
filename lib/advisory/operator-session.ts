const COOKIE_NAME = "streetlight_operator";

export function requestUsesHttps(request: Request) {
  if (new URL(request.url).protocol === "https:") return true;
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function operatorSessionToken(secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("streetlight-operator-session:v1"));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function operatorSessionCookie(secret: string, secure = true) {
  return `${COOKIE_NAME}=${await operatorSessionToken(secret)}; Path=/; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}; Max-Age=86400`;
}

export async function hasOperatorSession(request: Request, secret?: string) {
  if (!secret) return false;
  const expected = await operatorSessionToken(secret);
  const value = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  if (!value || value.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < value.length; i += 1) mismatch |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

export function matchesOperatorSecret(value: unknown, secret?: string) {
  if (typeof value !== "string" || !secret || value.length !== secret.length) return false;
  let mismatch = 0;
  for (let i = 0; i < value.length; i += 1) mismatch |= value.charCodeAt(i) ^ secret.charCodeAt(i);
  return mismatch === 0;
}
