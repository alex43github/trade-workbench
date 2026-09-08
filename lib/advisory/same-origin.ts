export function requestOrigin(request: Request) {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = (request.headers.get("x-forwarded-host") || request.headers.get("host"))?.split(",")[0]?.trim();
  if (forwardedProto && forwardedHost) {
    try { return new URL(`${forwardedProto}://${forwardedHost}`).origin; } catch { /* use the request URL below */ }
  }
  return new URL(request.url).origin;
}

export function isSameOriginMutation(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (site !== "same-origin" || !origin) return false;
  try { return new URL(origin).origin === requestOrigin(request); } catch { return false; }
}
