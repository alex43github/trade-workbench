import { matchesOperatorSecret, operatorSessionCookie } from "@/lib/advisory/operator-session";
import { isSameOriginMutation } from "@/lib/advisory/same-origin";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "same-origin operator action required" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { token?: unknown };
  const secret = process.env.ADVISORY_JOB_TOKEN;
  if (!matchesOperatorSecret(body.token, secret)) return Response.json({ error: "invalid operator token" }, { status: 401 });
  return Response.json({ unlocked: true, realOrderRouteEnabled: false }, { headers: { "set-cookie": await operatorSessionCookie(secret!, new URL(request.url).protocol === "https:") } });
}
