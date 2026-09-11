import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("long-running radar scans are scheduled in the background", async () => {
  const [ma30Source, reversalSource] = await Promise.all([
    readFile(new URL("app/api/radar/ma30-oi/route.ts", root), "utf8"),
    readFile(new URL("app/api/radar/reversal/route.ts", root), "utf8"),
  ]);

  for (const source of [ma30Source, reversalSource]) {
    assert.match(source, /getRequestExecutionContext/);
    assert.match(source, /waitUntil/);
    assert.match(source, /status: 202/);
    assert.match(source, /onProgress/);
    assert.match(source, /progress/);
  }
});

test("scheduled maintenance keeps using awaitable scan functions", async () => {
  const source = await readFile(new URL("app/api/advisory/maintenance/route.ts", root), "utf8");
  const reversalRoute = await readFile(new URL("app/api/radar/reversal/route.ts", root), "utf8");

  assert.match(source, /runMa30OiScan/);
  assert.match(source, /runReversalScan/);
  assert.match(reversalRoute, /runReversalScan\(intervals: ReversalInterval\[\] = \[\.\.\.REVERSAL_INTERVALS\]/);
  assert.doesNotMatch(source, /scanReversal\(/);
  assert.doesNotMatch(source, /scanMa30Oi\(/);
});

test("radar buttons poll the pending snapshot until the background scan completes", async () => {
  const source = await readFile(new URL("app/radar/page.tsx", root), "utf8");

  assert.match(source, /payload\.status === "pending"/);
  assert.match(source, /fetch\("\/api\/radar\/(?:ma30-oi|reversal)"/);
  assert.match(source, /setTimeout\(resolve, 1_000\)/);
});
