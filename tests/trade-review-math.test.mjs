import assert from "node:assert/strict";
import test from "node:test";

import {
  attributionConfidence,
  classifyOrderSource,
} from "../lib/trade/review-contracts.ts";
import {
  reviewMetrics,
  weightedAveragePrice,
} from "../lib/trade/review-math.ts";
import * as reviewMath from "../lib/trade/review-math.ts";

test("classifies verified client-order prefixes and keeps raw/empty ids separate", () => {
  assert.equal(classifyOrderSource("teleIN0001"), "TELEGRAM");
  assert.equal(classifyOrderSource("WEB-EXIT-0002"), "WEB");
  assert.equal(classifyOrderSource("alexMC0003"), "ALEX");
  assert.equal(classifyOrderSource("binance-native-order"), "BINANCE_NATIVE");
  assert.equal(classifyOrderSource("   "), "UNCLASSIFIED");
  assert.equal(classifyOrderSource(null), "UNCLASSIFIED");
});

test("treats malformed client-order ids as unclassified and does not trust a conflicting source label", () => {
  assert.equal(classifyOrderSource(12345), "UNCLASSIFIED");
  assert.equal(classifyOrderSource({ value: "webIN0001" }), "UNCLASSIFIED");
  assert.equal(attributionConfidence({
    source: "WEB",
    clientOrderId: "native-order-1",
    strategyId: "TW-L-S-1",
  }), "UNCERTAIN");
});

test("strategy ids give exact attribution while overlapping native entries remain unpaired", () => {
  assert.equal(attributionConfidence({
    clientOrderId: "teleIN0001",
    strategyId: "TW-L-S-20260829-001",
  }), "EXACT");

  assert.equal(attributionConfidence({
    clientOrderId: "manual-order-1",
    nativeOrdersOverlap: true,
  }), "UNPAIRED");

  assert.equal(attributionConfidence({
    clientOrderId: "manual-order-2",
  }), "UNCERTAIN");

  assert.equal(attributionConfidence({
    clientOrderId: "alexMC0003",
    directEvidenceId: "realized-pnl:7003",
  }), "EXACT");
});

test("native exact attribution requires an auditable evidence id or user review group", () => {
  assert.equal(attributionConfidence({
    clientOrderId: "native-order-1",
    directEvidence: true,
  }), "UNCERTAIN");

  assert.equal(attributionConfidence({
    clientOrderId: "native-order-2",
    hasDirectRealizedPnl: true,
    exchangeRealizedPnl: "12.5",
  }), "UNCERTAIN");

  assert.equal(attributionConfidence({
    clientOrderId: "native-order-3",
    directEvidenceId: "fill-link:7003",
  }), "EXACT");

  assert.equal(attributionConfidence({
    clientOrderId: "native-order-4",
    userCreatedReviewGroup: true,
    manualReviewGroupId: "TRG-123",
  }), "EXACT");

  assert.equal(attributionConfidence({
    clientOrderId: "native-order-5",
    manualReviewGroupId: "TRG-124",
  }), "EXACT");

  assert.equal(attributionConfidence({
    clientOrderId: "native-order-6",
    userCreatedReviewGroup: true,
  }), "UNCERTAIN");

  assert.equal(attributionConfidence({
    clientOrderId: "native-order-boolean-id",
    directEvidenceId: true,
    manualReviewGroupId: true,
  }), "UNCERTAIN");

  assert.equal(attributionConfidence({
    clientOrderId: "native-order-7",
    nativeOrdersOverlap: true,
    directEvidenceId: "order-link:9007",
  }), "EXACT");
});

test("weightedAveragePrice uses fill quantity rather than a median or simple average", () => {
  assert.equal(weightedAveragePrice([
    { quantity: 1, price: 100 },
    { quantity: 3, price: 120 },
  ]), 115);
});

test("review metrics calculate VWAP, fee/funding-adjusted net PnL and holding duration", () => {
  const metrics = reviewMetrics({
    confidence: "EXACT",
    side: "LONG",
    fills: [
      { role: "ENTRY", quantity: 1, price: 100, time: "2026-08-29T00:00:00.000Z", commission: 0.2 },
      { role: "ENTRY", quantity: 3, price: 120, time: "2026-08-29T01:00:00.000Z", commission: 0.24 },
      { role: "EXIT", quantity: 4, price: 140, time: "2026-08-29T02:30:00.000Z", commission: 0.28 },
    ],
    funding: -1,
  });

  assert.equal(metrics.entryVwap, 115);
  assert.equal(metrics.exitVwap, 140);
  assert.equal(metrics.grossPnl, 100);
  assert.equal(metrics.commission, 0.72);
  assert.equal(metrics.funding, -1);
  assert.equal(metrics.fundingIncome, -1);
  assert.equal(metrics.netPnl, 98.28);
  assert.equal(metrics.holdingDurationMs, 9_000_000);
  assert.equal(metrics.outcome, "WIN");
});

test("treats mixed realized-PnL evidence as insufficient instead of mixing measured and derived PnL", () => {
  const metrics = reviewMetrics({
    confidence: "EXACT",
    side: "LONG",
    commission: 0,
    fundingIncome: 0,
    fills: [
      { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0, commissionAsset: "USDT" },
      { role: "EXIT", quantity: 0.5, price: 120, time: 2_000, commission: 0, commissionAsset: "USDT", realizedPnl: 10 },
      { role: "EXIT", quantity: 0.5, price: 140, time: 3_000, commission: 0, commissionAsset: "USDT" },
    ],
  });

  assert.equal(metrics.sampleStatus, "样本不足");
  assert.equal(metrics.grossPnl, null);
  assert.equal(metrics.netPnl, null);
});

test("derives gross PnL when every realized-PnL field is explicitly unavailable", () => {
  const metrics = reviewMetrics({
    confidence: "EXACT",
    side: "LONG",
    commission: 0,
    fundingIncome: 0,
    fills: [
      { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0, commissionAsset: "USDT", realizedPnl: null },
      { role: "EXIT", quantity: 1, price: 120, time: 2_000, commission: 0, commissionAsset: "USDT", realizedPnl: null },
    ],
  });

  assert.equal(metrics.sampleStatus, "COMPLETE");
  assert.equal(metrics.grossPnl, 20);
  assert.equal(metrics.netPnl, 20);
});

test("rejects a review group containing an exit before its first entry", () => {
  const metrics = reviewMetrics({
    confidence: "EXACT",
    side: "LONG",
    commission: 0,
    fundingIncome: 0,
    fills: [
      { role: "EXIT", quantity: 0.5, price: 120, time: 500, commission: 0, commissionAsset: "USDT" },
      { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0, commissionAsset: "USDT" },
      { role: "EXIT", quantity: 0.5, price: 130, time: 2_000, commission: 0, commissionAsset: "USDT" },
    ],
  });

  assert.equal(metrics.sampleStatus, "样本不足");
  assert.equal(metrics.holdingDurationMs, null);
  assert.equal(metrics.netPnl, null);
});

test("signed funding income is added after commission", () => {
  const metrics = reviewMetrics({
    confidence: "EXACT",
    side: "LONG",
    fills: [
      { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0.2, commissionAsset: "USDT" },
      { role: "EXIT", quantity: 1, price: 140, time: 2_000, commission: 0.3, commissionAsset: "USDT" },
    ],
    fundingIncome: 2,
  });

  assert.equal(metrics.grossPnl, 40);
  assert.equal(metrics.commission, 0.5);
  assert.equal(metrics.fundingIncome, 2);
  assert.equal(metrics.netPnl, 41.5);
});

test("review metrics do not sum commissions from different assets", () => {
  const metrics = reviewMetrics({
    confidence: "EXACT",
    side: "LONG",
    fills: [
      { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0.2, commissionAsset: "USDT" },
      { role: "EXIT", quantity: 1, price: 140, time: 2_000, commission: 0.01, commissionAsset: "BNB" },
    ],
    fundingIncome: 0,
  });

  assert.equal(metrics.sampleStatus, "样本不足");
  assert.equal(metrics.isComplete, false);
  assert.equal(metrics.netPnl, null);
});

test("review metrics accept an explicitly converted commission amount", () => {
  const metrics = reviewMetrics({
    confidence: "EXACT",
    side: "LONG",
    fills: [
      { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0.2, commissionAsset: "BNB" },
      { role: "EXIT", quantity: 1, price: 140, time: 2_000, commission: 0.01, commissionAsset: "USDT" },
    ],
    commissionInQuote: 0.8,
    fundingIncome: 0,
  });

  assert.equal(metrics.sampleStatus, "COMPLETE");
  assert.equal(metrics.commission, 0.8);
  assert.equal(metrics.netPnl, 39.2);
});

test("review metrics require explicitly known commission, funding income, and fill times", () => {
  const fills = [
    { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0, commissionAsset: "USDT" },
    { role: "EXIT", quantity: 1, price: 140, time: 2_000, commission: 0, commissionAsset: "USDT" },
  ];

  assert.equal(reviewMetrics({
    confidence: "EXACT",
    fills: fills.map(({ commission, ...fill }) => fill),
    fundingIncome: 0,
  }).sampleStatus, "样本不足");

  assert.equal(reviewMetrics({
    confidence: "EXACT",
    fills,
  }).sampleStatus, "样本不足");

  assert.equal(reviewMetrics({
    confidence: "EXACT",
    fills: fills.map(({ time, ...fill }) => fill),
    commission: 0,
    fundingIncome: 0,
  }).sampleStatus, "样本不足");
});

test("explicit zero fees and funding income are complete when every fill is timed", () => {
  const metrics = reviewMetrics({
    confidence: "EXACT",
    side: "LONG",
    fills: [
      { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0, commissionAsset: "USDT" },
      { role: "EXIT", quantity: 1, price: 140, time: 2_000, commission: 0, commissionAsset: "USDT" },
    ],
    commission: 0,
    fundingIncome: 0,
  });

  assert.equal(metrics.sampleStatus, "COMPLETE");
  assert.equal(metrics.commission, 0);
  assert.equal(metrics.fundingIncome, 0);
  assert.equal(metrics.netPnl, 40);
});

test("invalid quantity or price rejects the entire VWAP sample", () => {
  const validExit = { role: "EXIT", quantity: 1, price: 140, time: 2_000, commission: 0, commissionAsset: "USDT" };
  const common = { confidence: "EXACT", side: "LONG", commission: 0, fundingIncome: 0 };

  const invalidQuantity = reviewMetrics({
    ...common,
    fills: [
      { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0, commissionAsset: "USDT" },
      { role: "ENTRY", quantity: 0, price: 100, time: 1_100, commission: 0, commissionAsset: "USDT" },
      validExit,
    ],
  });
  assert.equal(invalidQuantity.sampleStatus, "样本不足");
  assert.equal(invalidQuantity.entryVwap, null);

  const invalidPrice = reviewMetrics({
    ...common,
    fills: [
      { role: "ENTRY", quantity: 1, price: 100, time: 1_000, commission: 0, commissionAsset: "USDT" },
      { role: "ENTRY", quantity: 1, price: 0, time: 1_100, commission: 0, commissionAsset: "USDT" },
      { ...validExit, quantity: 2 },
    ],
  });
  assert.equal(invalidPrice.sampleStatus, "样本不足");
  assert.equal(invalidPrice.entryVwap, null);

  assert.equal(weightedAveragePrice([
    { quantity: 1, price: 100 },
    { quantity: -1, price: 120 },
  ]), null);

  assert.equal(weightedAveragePrice([
    { quantity: 1, price: 100 },
    { quantity: 1, price: -120 },
  ]), null);
});

test("completedResults cannot bypass complete fill evidence", () => {
  const metrics = reviewMetrics({
    confidence: "EXACT",
    completedResults: [100, -40, 0],
  });

  assert.equal(metrics.sampleStatus, "样本不足");
  assert.equal(metrics.isComplete, false);
  assert.equal(metrics.sampleSize, 0);
  assert.equal(metrics.netPnl, null);
});

test("result statistics are exposed as a pure helper without review completeness", () => {
  assert.equal(typeof reviewMath.reviewResultStatistics, "function");
  const stats = reviewMath.reviewResultStatistics([100, -40, 0, "not-a-number"]);

  assert.deepEqual(stats, {
    sampleSize: 3,
    wins: 1,
    losses: 1,
    breakeven: 1,
    winRate: 50,
    averageWin: 100,
    averageLoss: -40,
    profitFactor: 2.5,
    expectancy: 20,
  });
  assert.equal("sampleStatus" in stats, false);
  assert.equal("isComplete" in stats, false);
});

test("review metrics refuse to manufacture a complete conclusion without exact confidence or both sides", () => {
  const metrics = reviewMetrics({
    confidence: "UNPAIRED",
    fills: [{ role: "ENTRY", quantity: 1, price: 100, time: 1_000 }],
  });

  assert.equal(metrics.sampleStatus, "样本不足");
  assert.equal(metrics.isComplete, false);
  assert.equal(metrics.netPnl, null);
  assert.equal(metrics.holdingDurationMs, null);

  assert.equal(reviewMetrics({ completedResults: [10] }).sampleStatus, "样本不足");
});
