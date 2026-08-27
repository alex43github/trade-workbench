import { runProtectionStrategyScheduler, type ProtectionSchedulerResult } from "../../../../../lib/trade/protection-scheduler.ts";
import { requireScheduler, schedulerToken } from "../../../../../lib/security/operator-guard.ts";

type RuntimeEnv = Record<string, string | undefined>;

type SchedulerRouteDependencies = {
  env?: RuntimeEnv;
  runScheduler?: () => Promise<ProtectionSchedulerResult>;
};

function unavailableResult(): ProtectionSchedulerResult {
  return { scanned: 0, executed: 0, closed: 0, reconciliationRequired: 0, failed: 0, realOrderRouteEnabled: false };
}

export function createProtectionSchedulerPost(dependencies: SchedulerRouteDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const runScheduler = dependencies.runScheduler ?? runProtectionStrategyScheduler;
  return async function POST(request: Request) {
    if (!schedulerToken(env)) return Response.json(unavailableResult(), { status: 503, headers: { "cache-control": "no-store" } });
    if (!requireScheduler(request, env)) return Response.json(unavailableResult(), { status: 401, headers: { "cache-control": "no-store" } });
    try {
      return Response.json(await runScheduler(), { headers: { "cache-control": "no-store" } });
    } catch {
      return Response.json({ ...unavailableResult(), failed: 1 }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  };
}

export const POST = createProtectionSchedulerPost();
