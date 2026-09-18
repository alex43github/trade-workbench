type RuntimeEnv = Record<string, string | undefined>;

function requestHostname(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (forwardedHost) {
    try { return new URL(`http://${forwardedHost}`).hostname; } catch { return ""; }
  }
  try { return new URL(request.url).hostname; } catch { return ""; }
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function isTaskCenterEnabled(request: Request, env: RuntimeEnv = process.env) {
  const configured = env.TASK_CENTER_ENABLED?.trim().toLowerCase();
  if (configured === "false") return false;
  if (env.NODE_ENV === "production" && configured !== "true") return false;
  return isLoopbackHostname(requestHostname(request));
}

export async function requireTaskCenterAccess(request: Request, env: RuntimeEnv = process.env): Promise<Response | null> {
  if (isTaskCenterEnabled(request, env)) return null;
  return Response.json({ error: "task center is available on localhost only" }, { status: 404, headers: { "cache-control": "no-store" } });
}
