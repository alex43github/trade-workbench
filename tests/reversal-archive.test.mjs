import assert from "node:assert/strict";
import test from "node:test";
import {
  REVERSAL_ARCHIVE_PAGE_SIZE,
  calculateReversalElapsedBars,
  normalizeReversalArchiveQuery,
} from "../lib/radar/reversal-snapshot.ts";

test("normalizes archive pagination to sixty rows and a safe newest-first sort", () => {
  assert.deepEqual(normalizeReversalArchiveQuery({ page: "not-a-number", sort: "DROP TABLE", order: "sideways" }), {
    page: 1,
    pageSize: 60,
    sort: "signalTime",
    order: "desc",
  });
  assert.equal(REVERSAL_ARCHIVE_PAGE_SIZE, 60);
});

test("keeps an approved archive sort and page while rejecting out-of-range pages", () => {
  assert.deepEqual(normalizeReversalArchiveQuery({ page: "3", sort: "breakoutLookbackBars", order: "asc" }), {
    page: 3,
    pageSize: 60,
    sort: "breakoutLookbackBars",
    order: "asc",
  });
  assert.equal(normalizeReversalArchiveQuery({ page: "0" }).page, 1);
});

test("calculates elapsed closed bars with each scan interval", () => {
  const signalTime = Date.parse("2026-08-31T08:00:00.000Z");
  assert.equal(calculateReversalElapsedBars(signalTime, "4h", signalTime + 8 * 60 * 60 * 1_000), 2);
  assert.equal(calculateReversalElapsedBars(signalTime, "1w", signalTime + 15 * 24 * 60 * 60 * 1_000), 2);
  assert.equal(calculateReversalElapsedBars(signalTime, "15m", signalTime + 14 * 60 * 1_000), 0);
});
