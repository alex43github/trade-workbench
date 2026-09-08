import { readProtectionStrategySchedulerStatus, type ProtectionStrategySchedulerStatus } from "../../../../../lib/trade/protection-strategy-status.ts";
import { requireOperator } from "../../../../../lib/security/operator-guard.ts";

type RuntimeEnv = Record<string, string | undefined>;
type Dependencies = { env?: RuntimeEnv; readStatus?: () => Promise<ProtectionStrategySchedulerStatus> };

export function createProtectionStrategyStatusGet(dependencies: Dependencies = {}) {
  const env = dependencies.env ?? process.env;
  const readStatus = dependencies.readStatus ?? (() => readProtectionStrategySchedulerStatus({ env }));
  return async function GET(request: Request) {
    const denied = await requireOperator(request, env);
    if (denied) return denied;
    try { return Response.json({ scheduler: await readStatus() }, { headers: { "cache-control": "no-store" } }); }
    catch { return Response.json({ scheduler: { state: "FAILED", configured: false, lastRunAt: null, scanned: null, reanchored: null, entryFrozen: null, executed: null, closed: null, reconciliationRequired: null, failed: null, error: "调度器状态读取失败" } }, { status: 503, headers: { "cache-control": "no-store" } }); }
  };
}
export const GET = createProtectionStrategyStatusGet();
