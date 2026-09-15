import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../app/api/radar/atr-band/route.ts", import.meta.url), "utf8");

test("ATR POST detaches the long-running scan from the request lifecycle", () => {
  assert.match(source, /detachTask\(task,/);
  assert.doesNotMatch(source, /context\.waitUntil\(task\)/);
});
