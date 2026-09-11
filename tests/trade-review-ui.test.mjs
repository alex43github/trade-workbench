import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");

test("reviews renders the read-only dashboard instead of redirecting", () => {
  const page = read("../app/reviews/page.tsx");

  assert.match(page, /TradeReviewDashboard/);
  assert.doesNotMatch(page, /redirect\("\/radar"\)/);
});

test("review dashboard defaults to exact complete evidence and calls only the review GET endpoint", () => {
  const dashboard = read("../app/trade/TradeReviewDashboard.tsx");

  assert.match(dashboard, /\/api\/trade\/review/);
  assert.match(dashboard, /EXACT_COMPLETE/);
  assert.match(dashboard, /样本数/);
  assert.doesNotMatch(dashboard, /review\/sync|fetch\([^)]*,\s*\{\s*method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
});

test("review dashboard makes unsupported filters and uncertain evidence visible", () => {
  const dashboard = read("../app/trade/TradeReviewDashboard.tsx");

  for (const label of ["日期", "来源", "币种", "方向", "周期", "入场方式", "出场方式", "可信度", "数据接口待支持", "样本不足", "UNPAIRED", "UNCERTAIN", "clientOrderId"]) {
    assert.match(dashboard, new RegExp(label));
  }
});
