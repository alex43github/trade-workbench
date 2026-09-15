import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("maintenance keeps the 08:00 composite order after primary scans and permits daily catch-up", async () => {
  const source = await readFile(new URL("../app/api/advisory/maintenance/route.ts", import.meta.url), "utf8");

  assert.match(source, /const dailyDue = selectedJobs\?\.has\("daily"\) \|\| currentHour === 8/);
  assert.match(source, /if \(dailyDue\)/);
  assert.ok(source.indexOf("runReversalScan") < source.indexOf("runMultiTimeframeScan"));
  assert.ok(source.indexOf("runMultiTimeframeScan") < source.indexOf("runCompositeRanking"));
  assert.match(source, /realOrderRouteEnabled:\s*false/);
});
