import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-trade-review-api-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const archive = () => import("../lib/trade/order-archive.ts");
const database = () => import("../db/index.ts");
const reviewRoute = () => import("../app/api/trade/review/route.ts");
const summaryRoute = () => import("../app/api/trade/review/summary/route.ts");
const groupsRoute = () => import("../app/api/trade/review/groups/route.ts");
const groupDetailRoute = () => import("../app/api/trade/review/groups/[id]/route.ts");
const syncRoute = () => import("../app/api/trade/review/sync/route.ts");

async function createGroups() {
  const { linkArchivedFillToStrategy, upsertArchivedFill } = await archive();
  const completeEntry = await upsertArchivedFill({ accountId: "primary", symbol: "BTCUSDT", exchangeOrderId: "100", tradeId: "101", clientOrderId: "webIN-1", side: "BUY", positionSide: "LONG", role: "ENTRY", quantity: "1", price: "100", commission: "0", commissionAsset: "USDT", realizedPnl: "0", time: 1_725_000_000_000 });
  const completeExit = await upsertArchivedFill({ accountId: "primary", symbol: "BTCUSDT", exchangeOrderId: "102", tradeId: "103", clientOrderId: "webOUT-1", side: "SELL", positionSide: "LONG", role: "EXIT", quantity: "1", price: "120", commission: "0", commissionAsset: "USDT", realizedPnl: "20", time: 1_725_000_060_000 });
  await linkArchivedFillToStrategy({ fillId: completeEntry.id, strategyId: "TW-L-S-API-1" });
  await linkArchivedFillToStrategy({ fillId: completeExit.id, strategyId: "TW-L-S-API-1" });
  const { getD1 } = await database();
  const db = await getD1();
  await db.prepare("INSERT INTO trade_review_metrics (id, review_group_id, metric_version, snapshot_json, calculated_at) VALUES (?, ?, ?, ?, ?)")
    .bind("metric:api:1", "TW-L-S-API-1", "v1", JSON.stringify({ sampleStatus: "COMPLETE", isComplete: true, netPnl: 20, grossPnl: 20, commission: 0, funding: 0, holdingDurationMs: 60_000, outcome: "WIN" }), "2026-08-29T00:00:00.000Z").run();
  const lossEntry = await upsertArchivedFill({ accountId: "primary", symbol: "ETHUSDT", exchangeOrderId: "106", tradeId: "107", clientOrderId: "webIN-2", side: "BUY", positionSide: "LONG", role: "ENTRY", quantity: "1", price: "100", commission: "2", commissionAsset: "USDT", realizedPnl: "0", time: 1_725_000_000_000 });
  const lossExit = await upsertArchivedFill({ accountId: "primary", symbol: "ETHUSDT", exchangeOrderId: "108", tradeId: "109", clientOrderId: "webOUT-2", side: "SELL", positionSide: "LONG", role: "EXIT", quantity: "1", price: "90", commission: "2", commissionAsset: "USDT", realizedPnl: "-10", time: 1_725_000_120_000, rawPayload: { Authorization: "not-visible", gatewayHeaders: { token: "not-visible" } } });
  await linkArchivedFillToStrategy({ fillId: lossEntry.id, strategyId: "TW-L-S-API-2" });
  await linkArchivedFillToStrategy({ fillId: lossExit.id, strategyId: "TW-L-S-API-2" });
  await db.prepare("INSERT INTO trade_review_metrics (id, review_group_id, metric_version, snapshot_json, calculated_at) VALUES (?, ?, ?, ?, ?)")
    .bind("metric:api:2", "TW-L-S-API-2", "v1", JSON.stringify({ sampleStatus: "COMPLETE", isComplete: true, netPnl: -14, grossPnl: -10, commission: 4, funding: 0, holdingDurationMs: 120_000, outcome: "LOSS" }), "2026-08-30T00:00:00.000Z").run();
  await db.batch([
    db.prepare("UPDATE trade_review_groups SET created_at = ?, updated_at = ? WHERE id = ?").bind("2026-08-29T10:00:00.000Z", "2026-08-29T10:00:00.000Z", "TW-L-S-API-1"),
    db.prepare("UPDATE trade_review_groups SET created_at = ?, updated_at = ?, timeframe = ? WHERE id = ?").bind("2026-08-30T10:00:00.000Z", "2026-08-30T10:00:00.000Z", "15m", "TW-L-S-API-2"),
    db.prepare("INSERT INTO trade_review_tags (id, review_group_id, tag_key, tag_value, source) VALUES (?, ?, ?, ?, ?)").bind("tag:api:1:entry", "TW-L-S-API-1", "entryMethod", "LIMIT", "SYSTEM"),
    db.prepare("INSERT INTO trade_review_tags (id, review_group_id, tag_key, tag_value, source) VALUES (?, ?, ?, ?, ?)").bind("tag:api:1:exit", "TW-L-S-API-1", "exitMethod", "TAKE_PROFIT", "SYSTEM"),
    db.prepare("INSERT INTO trade_review_tags (id, review_group_id, tag_key, tag_value, source) VALUES (?, ?, ?, ?, ?)").bind("tag:api:2:entry", "TW-L-S-API-2", "entryMethod", "MARKET", "SYSTEM"),
    db.prepare("INSERT INTO trade_review_tags (id, review_group_id, tag_key, tag_value, source) VALUES (?, ?, ?, ?, ?)").bind("tag:api:2:exit", "TW-L-S-API-2", "exitMethod", "STOP_LOSS", "SYSTEM"),
    db.prepare("INSERT INTO trade_review_groups (id, account_id, symbol, side, group_kind, source_classification, confidence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind("uncertain-api-1", "primary", "SOLUSDT", "LONG", "MANUAL", "BINANCE_NATIVE", "UNCERTAIN", "2026-08-30T12:00:00.000Z", "2026-08-30T12:00:00.000Z"),
    db.prepare("INSERT INTO trade_review_metrics (id, review_group_id, metric_version, snapshot_json, calculated_at) VALUES (?, ?, ?, ?, ?)").bind("metric:api:uncertain", "uncertain-api-1", "v1", JSON.stringify({ sampleStatus: "COMPLETE", isComplete: true, netPnl: 3, grossPnl: 3, commission: 0, funding: 0, holdingDurationMs: 30_000, outcome: "WIN" }), "2026-08-30T12:00:00.000Z"),
  ]);
  await upsertArchivedFill({ accountId: "primary", symbol: "ETHUSDT", exchangeOrderId: "104", tradeId: "105", clientOrderId: "binance-mobile-raw", side: "BUY", positionSide: "BOTH", role: "ENTRY", quantity: "1", price: "100", commission: "0", commissionAsset: "USDT", realizedPnl: "0", time: 1_725_000_000_000, nativeOrdersOverlap: true, rawPayload: { apiKey: "not-visible" } });
}

let seeded;
function seed() {
  seeded ??= createGroups();
  return seeded;
}

test("review API defaults KPI and rankings to exact complete groups while exposing archive health separately", async () => {
  await seed();
  const { GET } = await reviewRoute();
  const response = await GET(new Request("http://localhost/api/trade/review?accountId=primary&limit=10"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.summary.sampleSize, 2);
  assert.equal(body.rankings.winners[0].id, "TW-L-S-API-1");
  assert.equal(body.incomplete.length, 0);
  assert.equal(body.unpaired.length, 1);
  assert.equal(body.health.openGaps, 0);
  assert.doesNotMatch(JSON.stringify(body), /apiKey|secret|authorization|token/i);
});

test("review summary validates bounded dates, defaults to exact complete, and only includes uncertain groups by opt-in", async () => {
  await seed();
  const { GET } = await summaryRoute();
  const invalid = await GET(new Request("http://localhost/api/trade/review/summary?from=2026-08-01&to=2027-09-01"));
  const defaultScope = await GET(new Request("http://localhost/api/trade/review/summary?accountId=primary&from=2026-08-01&to=2026-08-31"));
  const uncertainScope = await GET(new Request("http://localhost/api/trade/review/summary?accountId=primary&from=2026-08-01&to=2026-08-31&includeUncertain=true"));

  assert.equal(invalid.status, 400);
  assert.equal(defaultScope.status, 200);
  assert.equal((await defaultScope.json()).summary.sampleSize, 2);
  assert.equal((await uncertainScope.json()).summary.sampleSize, 3);
});

test("review summary computes audited outcome metrics and exposes sample counts for factor breakdowns", async () => {
  await seed();
  const { GET } = await summaryRoute();
  const response = await GET(new Request("http://localhost/api/trade/review/summary?accountId=primary&from=2026-08-01&to=2026-08-31&entryMethod=LIMIT"));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.summary.sampleSize, 1);
  assert.equal(body.summary.wins, 1);
  assert.equal(body.summary.losses, 0);
  assert.equal(body.summary.averageWin, 20);
  assert.equal(body.summary.averageLoss, null);
  assert.equal(body.summary.profitFactor, null);
  assert.equal(body.summary.expectancy, 20);
  assert.equal(body.summary.commission, 0);
  assert.equal(body.summary.duration.averageMs, 60_000);
  assert.equal(body.factorBreakdowns.entryMethod[0].sampleSize, 1);
  assert.equal(body.factorBreakdowns.entryMethod[0].value, "LIMIT");
  assert.equal(body.filterCapabilities.entryMethod.available, true);
  assert.equal(body.sampleStatus, "INSUFFICIENT_SAMPLE");
});

test("review groups enforce verifiable filters and redact drill-down evidence", async () => {
  await seed();
  const { GET } = await groupsRoute();
  const invalid = await GET(new Request("http://localhost/api/trade/review/groups?entryMethod=DROP%20TABLE"));
  const filtered = await GET(new Request("http://localhost/api/trade/review/groups?accountId=primary&from=2026-08-01&to=2026-08-31&symbol=ETHUSDT&side=LONG&timeframe=15m&entryMethod=MARKET&exitMethod=STOP_LOSS&limit=1"));
  const detail = await groupDetailRoute().then(({ GET: detailGet }) => detailGet(new Request("http://localhost/api/trade/review/groups/TW-L-S-API-2?accountId=primary"), { params: Promise.resolve({ id: "TW-L-S-API-2" }) }));
  const detailBody = await detail.json();

  assert.equal(invalid.status, 400);
  assert.equal(filtered.status, 200);
  assert.equal((await filtered.json()).items[0].id, "TW-L-S-API-2");
  assert.equal(detail.status, 200);
  assert.equal(detailBody.group.id, "TW-L-S-API-2");
  assert.equal(detailBody.evidence.fills.length, 2);
  assert.doesNotMatch(JSON.stringify(detailBody), /apiKey|secret|authorization|gatewayHeaders|token/i);
});

test("review API rejects unsafe pagination and exposes no mutation handlers", async () => {
  const { GET, POST, PUT, PATCH, DELETE } = await reviewRoute();
  const response = await GET(new Request("http://localhost/api/trade/review?limit=101"));

  assert.equal(response.status, 400);
  assert.equal(POST, undefined);
  assert.equal(PUT, undefined);
  assert.equal(PATCH, undefined);
  assert.equal(DELETE, undefined);
});

test("sync API accepts only bounded symbols and remains GET-only", async () => {
  const { GET, POST, PUT, PATCH, DELETE } = await syncRoute();
  const invalid = await GET(new Request("http://localhost/api/trade/review/sync?symbols=not-a-symbol"));

  assert.equal(invalid.status, 400);
  assert.equal(POST, undefined);
  assert.equal(PUT, undefined);
  assert.equal(PATCH, undefined);
  assert.equal(DELETE, undefined);
});
