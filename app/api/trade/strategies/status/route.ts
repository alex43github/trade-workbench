import { readPaperStrategySchedulerStatus, type PaperStrategySchedulerStatus } from "../../../../../lib/trade/paper-strategy-status.ts";
import { requireOperator } from "../../../../../lib/security/operator-guard.ts";

type RuntimeEnv = Record<string, string | undefined>;

type StatusDependencies = {
  env?: RuntimeEnv;
  readStatus?: () => Promise<PaperStrategySchedulerStatus>;
};

export function createPaperStrategyStatusGet(dependencies: StatusDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const readStatus = dependencies.readStatus ?? (() => readPaperStrategySchedulerStatus({ env }));
  return async function GET(request: Request) {
    const denied = await requireOperator(request, env);
    if (denied) return denied;
    try {
      return Response.json({ scheduler: await readStatus() }, { headers: { "cache-control": "no-store" } });
    } catch {
      return Response.json({ scheduler: { state: "FAILED", configured: false, lastRunAt: null, scanned: null, executed: null, failed: null, error: "调度器状态读取失败" } }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  };
}

export const GET = createPaperStrategyStatusGet();
