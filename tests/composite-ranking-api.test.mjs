import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("08:00 maintenance refreshes Vegas before generating the composite snapshot", async () => {
  const maintenance = await source("app/api/advisory/maintenance/route.ts");
  assert.match(maintenance, /runMultiTimeframeScan/);
  assert.match(maintenance, /runCompositeRanking/);
  assert.ok(maintenance.indexOf("runMultiTimeframeScan") < maintenance.indexOf("runCompositeRanking"));
});

test("composite GET is read-only and cannot accept browser-defined conditions", async () => {
  const route = await source("app/api/radar/composite/route.ts");
  assert.match(route, /export\s+async\s+function\s+GET/);
  assert.doesNotMatch(route, /export\s+(?:async\s+)?function\s+(?:POST|PUT|PATCH|DELETE)/);
  assert.doesNotMatch(route, /request\.json/);
  assert.match(route, /no-store/);
});

test("scheduler keeps composite orchestration research-only", async () => {
  const maintenance = await source("app/api/advisory/maintenance/route.ts");
  assert.doesNotMatch(maintenance, /gateway|submitOrder|createOrder|position|stop-loss/i);
});

test("scheduler Vegas helper shares the route mutex with manual scans", async () => {
  const route = await source("app/api/radar/multitimeframe/route.ts");
  const helper = route.slice(route.indexOf("export async function runMultiTimeframeScan"), route.indexOf("export async function POST"));
  assert.match(helper, /running/);
  assert.match(helper, /pending|degraded/);
});

test("scheduler Vegas failures persist a degraded snapshot instead of leaving pending", async () => {
  const route = await source("app/api/radar/multitimeframe/route.ts");
  const helper = route.slice(route.indexOf("export async function runMultiTimeframeScan"), route.indexOf("export async function POST"));
  assert.match(helper, /saveMultiTimeframeSnapshot\(db, failed\)/);
});

test("scheduler Vegas helper deduplicates and caps the source union at 250 symbols", async () => {
  const route = await source("app/api/radar/multitimeframe/route.ts");
  const helper = route.slice(route.indexOf("export async function runMultiTimeframeScan"), route.indexOf("export async function POST"));
  assert.match(route, /MAX_MULTI_TIMEFRAME_SYMBOLS\s*=\s*250/);
  assert.match(helper, /slice\(0,\s*MAX_MULTI_TIMEFRAME_SYMBOLS\)/);
  assert.match(helper, /截断|超过 250/);
});

test("same-level condition changes do not send another composite Bark notification", async () => {
  const { shouldNotifyCompositeCandidate } = await import("../lib/radar/composite-ranking.ts");
  const candidate = (conditions) => ({ symbol: "BTCUSDT", direction: "LONG", conditions, conditionCount: conditions.length, qualityScore: 50, totalWeight: 100, priority: "HIGH", sourceTimes: [] });
  assert.equal(shouldNotifyCompositeCandidate(candidate(["MA30×OI 增仓", "Vegas 强势"]), [candidate(["MA30×OI 增仓", "破底翻"])]), false);
});
