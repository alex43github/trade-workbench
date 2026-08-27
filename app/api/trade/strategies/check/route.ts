import { runPaperStrategyScheduler, type PaperStrategySchedulerResult } from "../../../../../lib/trade/paper-strategy-scheduler.ts";
import { writePaperStrategySchedulerState } from "../../../../../lib/trade/paper-strategy-status.ts";
import { requireOperatorMutation } from "../../../../../lib/security/operator-guard.ts";

type RuntimeEnv = Record<string, string | undefined>;

type CheckDependencies = {
  env?: RuntimeEnv;
  runScheduler?: () => Promise<PaperStrategySchedulerResult>;
  writeState?: (result: PaperStrategySchedulerResult, options: { env?: RuntimeEnv; startedAt: string; finishedAt: string; error?: unknown }) => Promise<void>;
};

function unavailableResult(): PaperStrategySchedulerResult {
  return { scanned: 0, executed: 0, failed: 0, realOrderRouteEnabled: false };
}

export function createPaperStrategyCheckPost(dependencies: CheckDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const runScheduler = dependencies.runScheduler ?? runPaperStrategyScheduler;
  const writeState = dependencies.writeState ?? writePaperStrategySchedulerState;
  return async function POST(request: Request) {
    const denied = await requireOperatorMutation(request, env);
    if (denied) return denied;
    const startedAt = new Date().toISOString();
    try {
      const result = await runScheduler();
      const finishedAt = new Date().toISOString();
      await writeState(result, { env, startedAt, finishedAt });
      return Response.json(result, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      const finishedAt = new Date().toISOString();
      try { await writeState(unavailableResult(), { env, startedAt, finishedAt, error }); } catch { /* status persistence must not hide the original failure */ }
      return Response.json({ ...unavailableResult(), failed: 1, error: "纸面策略检查失败" }, { status: 503, headers: { "cache-control": "no-store" } });
    }
  };
}

export const POST = createPaperStrategyCheckPost();
