import { executeMa30VpsOutcomeBackfill } from "../lib/radar/ma30-vps-outcomes.ts";

const result = await executeMa30VpsOutcomeBackfill();

console.log("========== MA30 OUTCOME BACKFILL ==========");
console.log(`PENDING=${result.pending}`);
console.log(`DUE=${result.due}`);
console.log(`NOT_DUE=${result.notDue}`);
console.log(`SYMBOLS_FETCHED=${result.symbolsFetched}`);
console.log(`INSERTED=${result.inserted}`);
console.log(`MISSING_BARS=${result.missingBars}`);
console.log(`FETCH_FAILURES=${result.fetchFailures.length}`);
for (const failure of result.fetchFailures) {
  console.log(`FETCH_FAILURE=${failure.symbol}:${failure.error}`);
}
console.log(`APPEND_FAILURES=${result.appendFailures.length}`);
for (const failure of result.appendFailures) {
  console.log(`APPEND_FAILURE=${failure.runId}:${failure.symbol}:${failure.horizonHours}h:${failure.error}`);
}
console.log("NO_TRADING_ACTIONS=1");
