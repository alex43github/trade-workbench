import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("reversal archive GET forwards only pagination and sort query values to the dashboard loader", async () => {
  const source = await readFile(new URL("../app/api/radar/reversal/route.ts", import.meta.url), "utf8");
  assert.match(source, /export async function GET\(request: Request\)/);
  assert.match(source, /new URL\(request\.url\)\.searchParams/);
  assert.match(source, /loadReversalDashboard\(await getD1\(\), archiveQuery\)/);
  assert.match(source, /page: searchParams\.get\("page"\)/);
  assert.match(source, /sort: searchParams\.get\("sort"\)/);
  assert.match(source, /order: searchParams\.get\("order"\)/);
});
