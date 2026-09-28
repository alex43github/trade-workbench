export interface ExecutionForwardCycleResult {
  mode: "RESEARCH_ONLY";
  dryRun: boolean;
  noTradingActions: 1;
  marker: "NO_TRADING_ACTIONS=1";
  observedAt: number;
}

export async function runExecutionForwardCycle(input: { dryRun?: boolean; now?: number } = {}): Promise<ExecutionForwardCycleResult> {
  const observedAt = input.now ?? Date.now();
  if (!Number.isFinite(observedAt)) throw new Error("cycle timestamp must be finite");

  return Object.freeze({
    mode: "RESEARCH_ONLY",
    dryRun: input.dryRun !== false,
    noTradingActions: 1,
    marker: "NO_TRADING_ACTIONS=1",
    observedAt,
  });
}
