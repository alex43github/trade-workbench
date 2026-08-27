import { listProtectionStrategies, type PersistedProtectionStrategy } from "./protection-strategies.ts";
import { runProtectionStrategyTick, type ProtectionTickResult } from "./protection-executor.ts";

export type ProtectionSchedulerResult = {
  scanned: number;
  executed: number;
  closed: number;
  reconciliationRequired: number;
  failed: number;
  realOrderRouteEnabled: boolean;
};

export type ProtectionSchedulerDependencies = {
  listStrategies?: (limit?: number) => Promise<PersistedProtectionStrategy[]>;
  executeTick?: (strategyId: string) => Promise<ProtectionTickResult>;
};

export async function runProtectionStrategyScheduler(dependencies: ProtectionSchedulerDependencies = {}): Promise<ProtectionSchedulerResult> {
  const list = dependencies.listStrategies ?? listProtectionStrategies;
  const executeTick = dependencies.executeTick ?? runProtectionStrategyTick;
  const strategies = (await list(100)).filter((strategy) => strategy.strategyType === "MA_SL"
    && ["ACTIVE", "PARTIALLY_PROTECTED", "TRIGGERING"].includes(strategy.status));
  const result: ProtectionSchedulerResult = {
    scanned: strategies.length, executed: 0, closed: 0, reconciliationRequired: 0, failed: 0, realOrderRouteEnabled: true,
  };
  await Promise.all(strategies.map(async (strategy) => {
    try {
      const tick = await executeTick(strategy.id);
      if (tick.action === "PARTIAL_EXIT" || tick.action === "FULL_EXIT") result.executed += 1;
      if (tick.action === "CLOSED") result.closed += 1;
      if (tick.action === "RECONCILIATION_REQUIRED") result.reconciliationRequired += 1;
    } catch {
      result.failed += 1;
    }
  }));
  return result;
}
