import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("multi-timeframe route has read and guarded manual scan paths", async () => {
 const source = await readFile(new URL("../app/api/radar/multitimeframe/route.ts", import.meta.url), "utf8");
  const persistence = await readFile(new URL("../lib/radar/multitimeframe.ts", import.meta.url), "utf8");
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  assert.match(source, /requireOperatorMutation/);
  assert.match(source, /250/);
  assert.match(persistence, /radar_multitimeframe_snapshots/);
  assert.match(source, /pending/);
});
