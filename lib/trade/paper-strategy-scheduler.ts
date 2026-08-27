import { fetchPaperStrategyMarketSnapshot, type PaperStrategyMarketSnapshot } from "./paper-strategy-market.ts";
import { runPaperStrategyTick, type PaperStrategyTick } from "./paper-strategy-executor.ts";
import {
  listRunnablePaperStrategies,
  recordPaperSchedulerExecutionFailure,
  type PaperSchedulerExecutionFailure,
  type PersistedStrategy,
} from "./strategies.ts";

export type PaperStrategySchedulerResult = {
  scanned: number;
  executed: number;
  failed: number;
  realOrderRouteEnabled: false;
};

export const paperSchedulerFailureEvent: PaperSchedulerExecutionFailure = {
  reason: "PAPER_SCHEDULER_EXECUTION_FAILED",
  payload: { source: "PAPER_SCHEDULER", retry: "NEXT_TICK" },
};

export type PaperStrategySchedulerDependencies = {
  listRunnableStrategies: () => Promise<Array<PersistedStrategy | null>>;
  fetchSnapshot: (strategy: PersistedStrategy) => Promise<PaperStrategyMarketSnapshot>;
  executeTick: (input: PaperStrategyTick) => Promise<unknown>;
  auditFailure: (strategyId: string, event: PaperSchedulerExecutionFailure) => Promise<unknown>;
};

const defaultDependencies: PaperStrategySchedulerDependencies = {
  listRunnableStrategies: () => listRunnablePaperStrategies(),
  fetchSnapshot: fetchPaperStrategyMarketSnapshot,
  executeTick: runPaperStrategyTick,
  auditFailure: recordPaperSchedulerExecutionFailure,
};

function isRunnablePaperStrategy(strategy: PersistedStrategy | null): strategy is PersistedStrategy {
  return Boolean(strategy
    && strategy.config.mode === "PAPER"
    && (strategy.status === "WAITING" || strategy.status === "ACTIVE"));
}

export async function runPaperStrategyScheduler(
  injected: Partial<PaperStrategySchedulerDependencies> = {},
): Promise<PaperStrategySchedulerResult> {
  const dependencies = { ...defaultDependencies, ...injected };
  const strategies = (await dependencies.listRunnableStrategies()).filter(isRunnablePaperStrategy);
  const result: PaperStrategySchedulerResult = {
    scanned: strategies.length,
    executed: 0,
    failed: 0,
    realOrderRouteEnabled: false,
  };

  for (const strategy of strategies) {
    try {
      const snapshot = await dependencies.fetchSnapshot(strategy);
      await dependencies.executeTick({
        strategyId: strategy.id,
        symbol: snapshot.symbol,
        markPrice: snapshot.markPrice,
        closedCandle: snapshot.closedCandle,
      });
      result.executed += 1;
    } catch {
      result.failed += 1;
      try {
        await dependencies.auditFailure(strategy.id, paperSchedulerFailureEvent);
      } catch {
        // A ledger outage must not prevent later strategies from receiving a tick.
      }
    }
  }
  return result;
}
