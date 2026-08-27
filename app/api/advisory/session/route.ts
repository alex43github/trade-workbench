import { matchesOperatorSecret, operatorSessionCookie, requestUsesHttps } from "@/lib/advisory/operator-session";
import { isSameOriginMutation } from "@/lib/advisory/same-origin";
import { operatorAccessToken, operatorSessionSecret } from "@/lib/security/operator-guard";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "same-origin operator action required" }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { token?: unknown };
  const accessToken = operatorAccessToken();
  const sessionSecret = operatorSessionSecret();
  if (!matchesOperatorSecret(body.token, accessToken) || !sessionSecret) return Response.json({ error: "invalid operator token" }, { status: 401 });
  return Response.json({ unlocked: true, realOrderRouteEnabled: false }, { headers: { "set-cookie": await operatorSessionCookie(sessionSecret, requestUsesHttps(request)) } });
}
