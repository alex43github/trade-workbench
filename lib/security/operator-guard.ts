import { hasOperatorSession } from "../advisory/operator-session.ts";
import { requestOrigin } from "../advisory/same-origin.ts";

type RuntimeEnv = Record<string, string | undefined>;

function isProduction(env: RuntimeEnv) {
  return env.NODE_ENV === "production";
}

/**
 * Local development is deliberately frictionless. Only loopback URLs receive
 * this temporary bypass; public VPS hostnames still require an operator session.
 * Set STREETLIGHT_LOCAL_TEST_MODE=false to test the production login flow here.
 */
export function hasLocalTestAccess(request: Request, env: RuntimeEnv = process.env) {
  if (env.STREETLIGHT_LOCAL_TEST_MODE === "false") return false;
  const hostname = new URL(request.url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

export function operatorSessionSecret(env: RuntimeEnv = process.env) {
  const configured = env.OPERATOR_SESSION_SECRET?.trim();
  if (configured) return configured;
  return isProduction(env) ? undefined : env.ADVISORY_JOB_TOKEN?.trim();
}

export function operatorAccessToken(env: RuntimeEnv = process.env) {
  const configured = env.OPERATOR_ACCESS_TOKEN?.trim();
  if (configured) return configured;
  return isProduction(env) ? undefined : env.ADVISORY_JOB_TOKEN?.trim();
}

export function schedulerToken(env: RuntimeEnv = process.env) {
  const configured = env.MAINTENANCE_JOB_TOKEN?.trim();
  if (configured) return configured;
  return isProduction(env) ? undefined : env.ADVISORY_JOB_TOKEN?.trim();
}

export function requireScheduler(request: Request, env: RuntimeEnv = process.env) {
  const token = schedulerToken(env);
  return Boolean(token && request.headers.get("authorization") === `Bearer ${token}`);
}

export async function requireOperator(request: Request, env: RuntimeEnv = process.env): Promise<Response | null> {
  if (hasLocalTestAccess(request, env)) return null;
  const secret = operatorSessionSecret(env);
  if (secret && await hasOperatorSession(request, secret)) return null;
  return Response.json({ error: "operator authentication required", realOrderRouteEnabled: false }, { status: 401, headers: { "cache-control": "no-store" } });
}

export async function requireOperatorMutation(request: Request, env: RuntimeEnv = process.env): Promise<Response | null> {
  const origin = request.headers.get("origin");
  if (origin && origin !== requestOrigin(request)) {
    return Response.json({ error: "invalid origin", realOrderRouteEnabled: false }, { status: 403, headers: { "cache-control": "no-store" } });
  }
  return requireOperator(request, env);
}

export async function requireOperatorOrSchedulerMutation(request: Request, env: RuntimeEnv = process.env): Promise<Response | null> {
  if (requireScheduler(request, env)) return null;
  return requireOperatorMutation(request, env);
}
