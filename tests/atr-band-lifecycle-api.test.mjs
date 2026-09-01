import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("ATR lifecycle route exposes persisted lifecycle groups and three-hour scheduling", async () => {
  const [route, maintenance] = await Promise.all([
    readFile(new URL("../app/api/radar/atr-band/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/advisory/maintenance/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(route, /export async function runAtrLifecycleScan/);
  assert.match(route, /loadAtrLifecycleDashboard/);
  assert.match(route, /hasAtrLifecycleScanBucket/);
  assert.match(maintenance, /runAtrLifecycleScan/);
  assert.match(maintenance, /shanghaiHour\(\) % 3 === 0/);
  assert.match(maintenance, /getAtrLifecycleScanBucket/);
});
