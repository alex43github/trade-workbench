import { listProtectionStrategies, markProtectionStrategyReconciliationRequired, type PersistedProtectionStrategy } from "./protection-strategies.ts";
import { runProtectionStrategyTick, type ProtectionTickResult } from "./protection-executor.ts";
import { syncLiveEntryProtections, type LiveEntryProtectionSyncResult } from "./live-entry-protection.ts";
import { listRefreshableLiveStrategies, markLiveStrategyStatus } from "./live-strategies.ts";
import { runLiveEntryReanchorTick, type LiveEntryReanchorResult } from "./live-entry-reanchor.ts";

export type ProtectionSchedulerResult = {
  scanned: number;
  reanchored: number;
  entryFrozen: number;
  executed: number;
  closed: number;
  reconciliationRequired: number;
  failed: number;
  realOrderRouteEnabled: boolean;
};

export type ProtectionSchedulerDependencies = {
  listStrategies?: (limit?: number) => Promise<PersistedProtectionStrategy[]>;
  executeTick?: (strategyId: string) => Promise<ProtectionTickResult>;
  syncLiveEntries?: () => Promise<LiveEntryProtectionSyncResult>;
  markReconciliationRequired?: (strategyId: string, error: unknown) => Promise<unknown>;
  listRefreshableStrategies?: (limit?: number) => ReturnType<typeof listRefreshableLiveStrategies>;
  runReanchorTick?: (strategyId: string) => Promise<LiveEntryReanchorResult>;
  markLiveStrategyReconciliationRequired?: (strategyId: string) => Promise<unknown>;
};

export async function runProtectionStrategyScheduler(dependencies: ProtectionSchedulerDependencies = {}): Promise<ProtectionSchedulerResult> {
  const list = dependencies.listStrategies ?? listProtectionStrategies;
  const executeTick = dependencies.executeTick ?? runProtectionStrategyTick;
  const syncLiveEntries = dependencies.syncLiveEntries ?? syncLiveEntryProtections;
  const markReconciliationRequired = dependencies.markReconciliationRequired ?? markProtectionStrategyReconciliationRequired;
  const listRefreshableStrategies = dependencies.listRefreshableStrategies ?? listRefreshableLiveStrategies;
  const runReanchorTick = dependencies.runReanchorTick ?? runLiveEntryReanchorTick;
  const markLiveStrategyReconciliationRequired = dependencies.markLiveStrategyReconciliationRequired
    ?? ((strategyId) => markLiveStrategyStatus(strategyId, "RECONCILIATION_REQUIRED"));
  const result: ProtectionSchedulerResult = {
    scanned: 0, reanchored: 0, entryFrozen: 0, executed: 0, closed: 0, reconciliationRequired: 0, failed: 0, realOrderRouteEnabled: true,
  };
  const refreshable = await listRefreshableStrategies(100);
  for (const strategy of refreshable) {
    try {
      const tick = await runReanchorTick(strategy.id);
      if (tick.action === "REANCHORED") result.reanchored += 1;
      if (tick.action === "RECONCILIATION_REQUIRED") result.reconciliationRequired += 1;
    } catch (error) {
      await markLiveStrategyReconciliationRequired(strategy.id).catch(() => undefined);
      result.reconciliationRequired += 1;
      result.failed += 1;
    }
  }
  try {
    const sync = await syncLiveEntries();
    result.reconciliationRequired += sync.reconciliationRequired;
    result.failed += sync.failed;
  } catch {
    result.failed += 1;
  }
  const strategies = (await list(100)).filter((strategy) => ["MA_SL", "LEVEL_SL"].includes(strategy.strategyType)
    && ["ACTIVE", "PARTIALLY_PROTECTED", "TRIGGERING"].includes(strategy.status));
  result.scanned = strategies.length;
  for (const strategy of strategies) {
    try {
      const tick = await executeTick(strategy.id);
      if (tick.action === "PARTIAL_EXIT" || tick.action === "FULL_EXIT") result.executed += 1;
      if (tick.action === "CLOSED") result.closed += 1;
      if (tick.action === "RECONCILIATION_REQUIRED") result.reconciliationRequired += 1;
      if (tick.entryFrozen) result.entryFrozen += 1;
      if (tick.entryReconciliationRequired) result.reconciliationRequired += 1;
    } catch (error) {
      await markReconciliationRequired(strategy.id, error).catch(() => undefined);
      result.failed += 1;
    }
  }
  return result;
}
