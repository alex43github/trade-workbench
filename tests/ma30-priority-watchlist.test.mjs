import assert from "node:assert/strict";
import test from "node:test";
import { buildMa30PriorityCandidates, refreshMa30PriorityWatchlist, MA30_PRIORITY_TTL_MS } from "../lib/radar/ma30-priority-watchlist.ts";

const NOW = Date.parse("2026-09-14T12:00:00Z");

function scan(overrides = {}) {
  return { a: [], b: [], c: [], shorts: [], ai: [], ...overrides };
}

test("admits C, AI, eligible A/B and SHORT while excluding late/not-candidate A/B", () => {
  const rows = buildMa30PriorityCandidates(scan({
    a: [
      { symbol: "A1USDT", rank: 1, stage: "STEADY_UPTREND" },
      { symbol: "LATEUSDT", rank: 2, stage: "LATE_EXTENSION" },
    ],
    b: [
      { symbol: "B1USDT", bRank: 1, stage: "EARLY_ACCELERATION" },
      { symbol: "NOUSDT", bRank: 2, stage: "NOT_CANDIDATE" },
    ],
    c: [{ symbol: "C1USDT", rank: 1, stage: "PERSISTENT_ACCELERATION" }],
    shorts: [{ symbol: "S1USDT", stage: "EARLY_DOWN_ACCELERATION" }],
    ai: [
      { symbol: "AI1USDT", direction: "LONG", aiRank: 1, longStage: "EARLY_ACCELERATION" },
      { symbol: "AI2USDT", direction: "SHORT", aiRank: 2, shortStage: "EARLY_DOWN_ACCELERATION" },
    ],
  }), NOW);

  assert.deepEqual(rows.map((row) => [row.symbol, row.direction]), [
    ["AI1USDT", "LONG"],
    ["AI2USDT", "SHORT"],
    ["C1USDT", "LONG"],
    ["S1USDT", "SHORT"],
    ["A1USDT", "LONG"],
    ["B1USDT", "LONG"],
  ]);
  assert.equal(rows.some((row) => row.symbol === "LATEUSDT"), false);
  assert.equal(rows.some((row) => row.symbol === "NOUSDT"), false);
});

test("merges sources for the same symbol and direction", () => {
  const [row] = buildMa30PriorityCandidates(scan({
    a: [{ symbol: "KOMAUSDT", rank: 2, stage: "EARLY_ACCELERATION" }],
    b: [{ symbol: "KOMAUSDT", bRank: 1, stage: "EARLY_ACCELERATION" }],
    c: [{ symbol: "KOMAUSDT", rank: 4, stage: "EARLY_ACCELERATION" }],
    ai: [{ symbol: "KOMAUSDT", direction: "LONG", aiRank: 1, longStage: "EARLY_ACCELERATION" }],
  }), NOW);

  assert.deepEqual(row.sources, ["AI", "C", "A", "B"]);
  assert.deepEqual(row.ranks, { a: 2, b: 1, c: 4, ai: 1 });
});

test("AI direction wins an opposite-direction conflict", () => {
  const rows = buildMa30PriorityCandidates(scan({
    c: [{ symbol: "XUSDT", rank: 1, stage: "EARLY_ACCELERATION" }],
    shorts: [{ symbol: "XUSDT", stage: "EARLY_DOWN_ACCELERATION" }],
    ai: [{ symbol: "XUSDT", direction: "SHORT", aiRank: 1, shortStage: "EARLY_DOWN_ACCELERATION" }],
  }), NOW);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].direction, "SHORT");
  assert.deepEqual(rows[0].sources, ["AI", "SHORT"]);
});

test("refresh keeps an unqualified symbol sticky for 8h, then expires it", () => {
  const [candidate] = buildMa30PriorityCandidates(scan({ c: [{ symbol: "KOMAUSDT", rank: 1, stage: "EARLY_ACCELERATION" }] }), NOW);
  const first = refreshMa30PriorityWatchlist([], [candidate], NOW);
  assert.equal(first[0].firstSeenAt, NOW);
  assert.equal(first[0].lastQualifiedAt, NOW);
  assert.equal(first[0].expiresAt, NOW + MA30_PRIORITY_TTL_MS);

  const stillWatching = refreshMa30PriorityWatchlist(first, [], NOW + MA30_PRIORITY_TTL_MS - 1);
  assert.equal(stillWatching.length, 1);

  const expired = refreshMa30PriorityWatchlist(first, [], NOW + MA30_PRIORITY_TTL_MS);
  assert.equal(expired.length, 0);
});

test("new opposite direction replaces stale opposite-direction watch item", () => {
  const [longCandidate] = buildMa30PriorityCandidates(scan({ c: [{ symbol: "XUSDT", rank: 1, stage: "EARLY_ACCELERATION" }] }), NOW);
  const first = refreshMa30PriorityWatchlist([], [longCandidate], NOW);
  const [shortCandidate] = buildMa30PriorityCandidates(scan({ shorts: [{ symbol: "XUSDT", stage: "EARLY_DOWN_ACCELERATION" }] }), NOW + 3_600_000);
  const second = refreshMa30PriorityWatchlist(first, [shortCandidate], NOW + 3_600_000);
  assert.equal(second.length, 1);
  assert.equal(second[0].direction, "SHORT");
});

test("priority watcher rejects stablecoin symbols from every source", () => {
  const rows = buildMa30PriorityCandidates(scan({
    a: [{ symbol: "USDCUSDT", rank: 1, stage: "STEADY_UPTREND" }],
    b: [{ symbol: "FDUSDUSDT", bRank: 1, stage: "EARLY_ACCELERATION" }],
    c: [{ symbol: "USDPUSDT", rank: 1, stage: "PERSISTENT_ACCELERATION" }],
    ai: [{ symbol: "DAIUSDT", direction: "LONG", aiRank: 1, longStage: "EARLY_ACCELERATION" }],
  }), NOW);
  assert.deepEqual(rows, []);
});
