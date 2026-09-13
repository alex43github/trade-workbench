import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("only a completed ATR strong scan synchronizes the shared persisted watchlist", async () => {
  const routeSource = await readFile(new URL("../app/api/radar/atr-band/route.ts", import.meta.url), "utf8");
  const watchlistSource = await readFile(new URL("../lib/watchlist.ts", import.meta.url), "utf8");
  assert.match(routeSource, /syncHourlyStrongWatchlist/);
  assert.match(routeSource, /await syncHourlyStrongWatchlist\(db, scan\)/);
  assert.doesNotMatch(routeSource, /syncHourlyStrongWatchlist\(db, dashboard\)/);
  assert.match(watchlistSource, /normalizeWatchlistItems/);
  assert.match(watchlistSource, /ATR_STRONG_1H/);
  assert.match(watchlistSource, /scan\.status !== "ready"/);
});
