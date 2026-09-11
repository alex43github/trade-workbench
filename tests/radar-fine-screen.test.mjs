import assert from "node:assert/strict";
import test from "node:test";

const {
  FINE_SCREEN_CONDITIONS,
  evaluateMa30Conditions,
  calculateHistoricalEvidence,
  countTrailingMa30Closes,
  matchesFineConditions,
  scoreFineCandidate,
  rankFineCandidates,
} = await import("../lib/radar/fine-screen.ts");

const bullish = {
  "15m": { close: 12, ma30: 10 },
  "1h": { close: 11, ma30: 10 },
  "4h": { close: 9, ma30: 10 },
};

test("evaluates six strict MA30 conditions and rejects missing indicators", () => {
  const matches = evaluateMa30Conditions(bullish);
  assert.deepEqual(matches, {
    LONG_15M_MA30: true,
    LONG_1H_MA30: true,
    LONG_4H_MA30: false,
    SHORT_15M_MA30: false,
    SHORT_1H_MA30: false,
    SHORT_4H_MA30: true,
  });
  assert.equal(evaluateMa30Conditions({ "15m": { close: 10, ma30: 10 } }).LONG_15M_MA30, false);
  assert.equal(evaluateMa30Conditions({ "15m": { close: Number.NaN, ma30: 10 } }).LONG_15M_MA30, false);
});

test("one condition, AND intersection, and OR union have explicit semantics", () => {
  const matches = {
    LONG_15M_MA30: true,
    LONG_1H_MA30: true,
    LONG_4H_MA30: false,
    SHORT_15M_MA30: false,
    SHORT_1H_MA30: false,
    SHORT_4H_MA30: true,
  };
  assert.deepEqual(FINE_SCREEN_CONDITIONS.length, 6);
  assert.equal(matchesFineConditions(matches, { conditions: ["LONG_15M_MA30"], mode: "AND" }).passes, true);
  assert.equal(matchesFineConditions(matches, { conditions: ["LONG_15M_MA30", "LONG_1H_MA30"], mode: "AND" }).passes, true);
  assert.equal(matchesFineConditions(matches, { conditions: ["LONG_15M_MA30", "LONG_4H_MA30"], mode: "AND" }).passes, false);
  assert.equal(matchesFineConditions(matches, { conditions: ["LONG_4H_MA30", "SHORT_4H_MA30"], mode: "OR" }).passes, true);
  assert.deepEqual(matchesFineConditions(matches, { conditions: ["LONG_15M_MA30", "SHORT_4H_MA30"], mode: "AND" }).matchedConditions, ["LONG_15M_MA30", "SHORT_4H_MA30"]);
});

test("strong multi-factor evidence receives a higher score and stable ranking", () => {
  const strong = scoreFineCandidate({
    symbol: "BTCUSDT",
    matchedConditions: ["LONG_15M_MA30", "LONG_1H_MA30", "LONG_4H_MA30"],
    trendPersistence: 18,
    vegas: { alignment: "BULLISH", mode: "FULL", spreadRatio: 1.8 },
    volumeRatio7d: 2.1,
    volumeRatio30d: 1.7,
    oiRatio7d: 1.9,
    oiRatio30d: 1.6,
    volatilityRatio7d: 1.7,
    volatilityRatio30d: 1.4,
    liquidityScore: 5,
  });
  const weak = scoreFineCandidate({ symbol: "ETHUSDT", matchedConditions: ["LONG_15M_MA30"], trendPersistence: 1, vegas: { alignment: null, mode: "NONE" } });
  assert.ok(strong.score > weak.score);
  assert.deepEqual(rankFineCandidates([weak, strong]).map((item) => item.symbol), ["BTCUSDT", "ETHUSDT"]);
  assert.equal(strong.componentScores.vegas, 25);
  assert.equal(strong.componentScores.volume, 15);
});

test("short-only Vegas fallback is usable but scores below a complete channel", () => {
  const complete = scoreFineCandidate({ symbol: "A", matchedConditions: ["SHORT_4H_MA30"], vegas: { alignment: "BEARISH", mode: "FULL", spreadRatio: 1.2 } });
  const shortOnly = scoreFineCandidate({ symbol: "B", matchedConditions: ["SHORT_4H_MA30"], vegas: { alignment: "BEARISH", mode: "SHORT", spreadRatio: 1.2 } });
  assert.ok(complete.componentScores.vegas > shortOnly.componentScores.vegas);
  assert.ok(shortOnly.score > 0);
});

test("missing historical evidence never becomes positive score", () => {
  const result = scoreFineCandidate({ symbol: "NEWUSDT", matchedConditions: ["LONG_15M_MA30"], vegas: { alignment: null, mode: "NONE" }, volumeRatio7d: null, volumeRatio30d: null, oiRatio7d: null, oiRatio30d: null, volatilityRatio7d: null, volatilityRatio30d: null });
  assert.equal(result.componentScores.volume, 0);
  assert.equal(result.componentScores.oi, 0);
  assert.equal(result.componentScores.volatility, 0);
  assert.ok(result.dataCompleteness < 100);
});

test("historical evidence compares recent activity with weekly and monthly baselines", () => {
  const bars = Array.from({ length: 720 }, (_, index) => ({
    close: 100 + index * 0.01,
    high: 101 + index * 0.01,
    low: 99 + index * 0.01,
    volume: index >= 717 ? 250 : 100,
  }));
  const oiHistory = bars.map((_, index) => ({ timestamp: index, openInterest: index >= 717 ? 220 : 100 }));
  const evidence = calculateHistoricalEvidence(bars, oiHistory);
  assert.ok((evidence.volumeRatio7d ?? 0) > 2);
  assert.ok((evidence.volumeRatio30d ?? 0) > 2);
  assert.ok((evidence.oiRatio7d ?? 0) > 2);
  assert.ok((evidence.oiRatio30d ?? 0) > 2);
  assert.ok((evidence.volatilityRatio7d ?? 0) > 0);
  assert.ok(countTrailingMa30Closes(bars) > 0);
});
