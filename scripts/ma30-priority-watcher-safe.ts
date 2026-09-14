import { executeMa30PriorityVpsCycle } from "../lib/radar/ma30-priority-vps-runtime.ts";

const result = await executeMa30PriorityVpsCycle({ args: process.argv.slice(2) });

console.log("========== MA30 PRIORITY WATCHER ==========");
console.log(`RESULT_STATUS=${result.status}`);
console.log(`RUN_ID=${result.runId}`);
console.log(`NOTIFICATION_MODE=${result.notifications}`);

if (result.status === "SKIPPED_DUPLICATE") {
  console.log("DUPLICATE=1");
  console.log("NO_TRADING_ACTIONS=1");
  process.exit(0);
}

if (result.status === "NO_FULL_SOURCE") {
  console.log("FULL_HOURLY_SOURCE=0");
  console.log("NO_TRADING_ACTIONS=1");
  process.exit(0);
}

console.log(`SOURCE_RUN_ID=${result.sourceRunId}`);
console.log(`SOURCE_CHANGED=${result.sourceChanged ? 1 : 0}`);
console.log(`PRIORITY_POOL=${result.watchlist.length}`);
console.log(`WATCHED=${result.coverage.watched}`);
console.log(`FETCHED=${result.coverage.fetched}`);
console.log(`FAILED=${result.coverage.failed}`);
console.log(`MA30_CROSS_EVENTS=${result.crossEvents.length}`);
console.log(`REIGNITION_EVENTS=${result.reignitionEvents.length}`);
console.log(`LOGICAL_BARK_GROUPS=${result.notificationGroups.length}`);
console.log("PERSISTED=1");
console.log("NO_TRADING_ACTIONS=1");