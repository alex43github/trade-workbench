export function isSameOriginMutation(request: Request) {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  if (site !== "same-origin" || !origin) return false;
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}
