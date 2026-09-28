import { loadRadarConfig } from "../services/structure-radar/config.ts";
import { SecondIgnitionTracker } from "../services/structure-radar/second-ignition-tracker.ts";
import { backfillSecondIgnitionOutcomes } from "../services/structure-radar/second-ignition-outcomes.ts";

const config = loadRadarConfig();
const tracker = new SecondIgnitionTracker({ dataDirectory: config.dataDirectory });
const result = await backfillSecondIgnitionOutcomes({ tracker });

console.log("========== SECOND IGNITION OUTCOME BACKFILL ==========");
console.log(`ALERTS=${result.alerts}`);
console.log(`EXISTING_OUTCOMES=${result.existingOutcomes}`);
console.log(`DUE=${result.due}`);
console.log(`INSERTED=${result.inserted}`);
console.log(`MISSING_BARS=${result.missingBars}`);
console.log(`FAILURES=${result.failures.length}`);
for (const failure of result.failures) {
  console.log(`FAILURE=${failure.alertId}:${failure.horizonHours}h:${failure.error}`);
}
console.log(`ALERT_LEDGER=${tracker.alertsPath}`);
console.log(`OUTCOME_LEDGER=${tracker.outcomesPath}`);
console.log("NO_TRADING_ACTIONS=1");
