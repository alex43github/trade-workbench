import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Bybit account path exposes actual position margin and read-only execution PnL", async () => {
  const [adapter, accountRoute, gateway] = await Promise.all([
    readFile(new URL("../lib/trade/bybit-live-adapter.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/account/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../bybit-gateway/server.mjs", import.meta.url), "utf8"),
  ]);
  assert.match(adapter, /positionIM/);
  assert.match(adapter, /executionHistory/);
  assert.match(accountRoute, /occupiedMargin:\s*Number\(position\.positionIM/);
  assert.match(accountRoute, /executionHistory/);
  assert.match(gateway, /GET \/v5\/execution\/list/);
});
