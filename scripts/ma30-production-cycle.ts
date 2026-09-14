import { executeMa30VpsProductionCycle } from "../lib/radar/ma30-vps-runtime.ts";

const result = await executeMa30VpsProductionCycle({ args: process.argv.slice(2) });

console.log("========== MA30 PRODUCTION CYCLE ==========");
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
console.log(`INSUFFICIENT=${result.scan.coverage.insufficientHistory}`);
console.log(`RETRIED=${result.scan.retriedSymbols.length}`);
console.log(`A=${result.scan.a.map((row) => row.symbol).join(",") || "NONE"}`);
console.log(`B=${result.scan.b.map((row) => row.symbol).join(",") || "NONE"}`);
console.log(`C=${result.scan.c.map((row) => `${row.symbol}:${row.stage}`).join(",") || "NONE"}`);
console.log(`SHORT=${result.scan.shorts.map((row) => row.symbol).join(",") || "NONE"}`);
console.log(`AI=${result.scan.ai.map((row) => `${row.aiRank}.${row.symbol}:${row.direction}:${row.confidence}`).join(",") || "NONE"}`);
console.log(`LIFECYCLE_EVENTS=${result.lifecycleEvents.length}`);
console.log(`BARK_GROUPS=${result.notificationGroups.length}`);
for (const group of result.notificationGroups) {
  console.log(`BARK_DRY_PREVIEW=${group.title} || ${group.body}`);
}
console.log("PERSISTED=1");
console.log("NO_TRADING_ACTIONS=1");
