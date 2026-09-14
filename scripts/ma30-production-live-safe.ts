import { executeMa30SafeVpsProductionCycle } from "../lib/radar/ma30-vps-safe-runtime.ts";

const result = await executeMa30SafeVpsProductionCycle({ args: process.argv.slice(2) });

console.log("========== MA30 SAFE PRODUCTION CYCLE ==========");
console.log(`RESULT_STATUS=${result.status}`);
console.log(`RUN_ID=${result.runId}`);
console.log(`RUN_TIME_BJT=${result.runTimeBjt}`);

if (result.status === "SKIPPED_DUPLICATE") {
  console.log("DUPLICATE=1");
  process.exit(0);
}

console.log(`NOTIFICATION_MODE=${result.notifications}`);
console.log(`SCAN_STATUS=${result.scan.status}`);
console.log(`UNIVERSE=${result.scan.coverage.universe}`);
console.log(`FETCH_OK=${result.scan.coverage.fetchedSuccessfully}`);
console.log(`SLOPE_OK=${result.scan.coverage.slopeQualified}`);
console.log(`FAILED=${result.scan.coverage.failed}`);
console.log(`STALE=${result.scan.coverage.staleLastCandle}`);
console.log(`A=${result.scan.a.length}`);
console.log(`B=${result.scan.b.length}`);
console.log(`C=${result.scan.c.length}`);
console.log(`SHORT=${result.scan.shorts.length}`);
console.log(`AI=${result.scan.ai.length}`);
console.log(`LIFECYCLE_EVENTS=${result.lifecycleEvents.length}`);
console.log(`LOGICAL_BARK_GROUPS=${result.notificationGroups.length}`);
console.log("PERSISTED=1");
console.log("NO_TRADING_ACTIONS=1");
