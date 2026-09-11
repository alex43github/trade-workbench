import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDb = path.join(os.tmpdir(), `streetlight-watchlist-source-priority-${process.pid}-${Date.now()}.sqlite`);
fs.rmSync(testDb, { force: true });
process.env.STREETLIGHT_LOCAL_D1 = testDb;

const { getD1 } = await import("../db/index.ts");
const { ensureWatchlistSchema } = await import("../db/ensure.ts");
const {
  listWatchlist,
  listWatchlistSections,
  removeWatchlistSource,
  syncExchangePositionWatchlist,
  syncHourlyStrongWatchlist,
  syncWatchlistSource,
} = await import("../lib/watchlist.ts");

const db = await getD1();

test("migrates legacy ownership and projects pinned, position, manual, then ATR sources", async () => {
  await db.prepare(`CREATE TABLE watchlist_entries (
    symbol TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    quote_asset TEXT NOT NULL,
    source TEXT NOT NULL CHECK (source IN ('MANUAL', 'ATR_BAND')),
    added_at TEXT DEFAULT CURRENT_TIMESTAMP NOT NULL,
    removed_at TEXT
  )`).run();
  await db.batch([
    db.prepare(`INSERT INTO watchlist_entries
      (symbol, display_name, quote_asset, source, added_at, removed_at)
      VALUES (?, ?, ?, ?, ?, NULL)`).bind("LEGACYMANUALUSDT", "Legacy Manual", "USDT", "MANUAL", "2026-01-01 00:00:00"),
    db.prepare(`INSERT INTO watchlist_entries
      (symbol, display_name, quote_asset, source, added_at, removed_at)
      VALUES (?, ?, ?, ?, ?, NULL)`).bind("LEGACYATRUSDT", "Legacy ATR", "USDT", "ATR_BAND", "2026-01-02 00:00:00"),
    db.prepare(`INSERT INTO watchlist_entries
      (symbol, display_name, quote_asset, source, added_at, removed_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`).bind("LEGACYREMOVEDUSDT", "Legacy Removed", "USDT", "MANUAL", "2026-01-03 00:00:00"),
  ]);

  await ensureWatchlistSchema();

  const migratedSources = await db.prepare(`SELECT symbol, source
    FROM watchlist_entry_sources ORDER BY symbol, source`).all();
  assert.deepEqual(migratedSources.results.map((row) => ({ symbol: row.symbol, source: row.source })), [
    { symbol: "BTCUSDT", source: "PINNED" },
    { symbol: "ENAUSDT", source: "PINNED" },
    { symbol: "ETHUSDT", source: "PINNED" },
    { symbol: "HYPEUSDT", source: "PINNED" },
    { symbol: "LEGACYATRUSDT", source: "ATR_STRONG_1H" },
    { symbol: "LEGACYMANUALUSDT", source: "MANUAL" },
    { symbol: "SOLUSDT", source: "PINNED" },
  ]);

  const migratedList = await listWatchlist(db);
  assert.deepEqual(migratedList.map((item) => item.symbol), [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT", "ENAUSDT",
    "LEGACYMANUALUSDT", "LEGACYATRUSDT",
  ]);

  await db.prepare("DELETE FROM watchlist_entry_sources WHERE source <> 'PINNED'").run();
  await syncWatchlistSource(db, "MANUAL", [
    { symbol: "DOGEUSDT" },
    { symbol: "ETHUSDT" },
    { symbol: "WIFUSDT" },
    { symbol: "MANUALONLYUSDT" },
  ]);
  await syncWatchlistSource(db, "POSITION", [
    { symbol: "DOGEUSDT" },
    { symbol: "POSITIONONLYUSDT" },
  ]);
  await syncWatchlistSource(db, "ATR_STRONG_1H", [
    { symbol: "WIFUSDT" },
    { symbol: "ATRONLYUSDT" },
  ]);

  assert.deepEqual((await listWatchlist(db)).map((item) => item.symbol), [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT", "ENAUSDT",
    "DOGEUSDT", "POSITIONONLYUSDT",
    "MANUALONLYUSDT", "WIFUSDT",
    "ATRONLYUSDT",
  ]);
});

test("removing one source preserves other ownership and cannot remove pinned symbols", async () => {
  await removeWatchlistSource(db, "MANUAL", ["WIFUSDT", "BTCUSDT"]);

  assert.deepEqual((await listWatchlist(db)).map((item) => item.symbol), [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "HYPEUSDT", "ENAUSDT",
    "DOGEUSDT", "POSITIONONLYUSDT", "MANUALONLYUSDT", "ATRONLYUSDT", "WIFUSDT",
  ]);
  const wifSources = await db.prepare(`SELECT source FROM watchlist_entry_sources
    WHERE symbol = ? ORDER BY source`).bind("WIFUSDT").all();
  assert.deepEqual(wifSources.results.map((row) => ({ source: row.source })), [{ source: "ATR_STRONG_1H" }]);

  await removeWatchlistSource(db, "ATR_STRONG_1H", ["WIFUSDT"]);
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "WIFUSDT"), false);

  await removeWatchlistSource(db, "POSITION", ["DOGEUSDT"]);
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "DOGEUSDT"), true);
  const dogeSources = await db.prepare(`SELECT source FROM watchlist_entry_sources
    WHERE symbol = ? ORDER BY source`).bind("DOGEUSDT").all();
  assert.deepEqual(dogeSources.results.map((row) => ({ source: row.source })), [{ source: "MANUAL" }]);
});

test("a degraded hourly scan never removes the existing strong source", async () => {
  await syncHourlyStrongWatchlist(db, { status: "ready", strong: [{ symbol: "PEPEUSDT" }] });
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "PEPEUSDT"), true);

  await syncHourlyStrongWatchlist(db, { status: "degraded", strong: [] });
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "PEPEUSDT"), true);

  await syncHourlyStrongWatchlist(db, { status: "ready", strong: [] });
  assert.equal((await listWatchlist(db)).some((item) => item.symbol === "PEPEUSDT"), false);
});

test("projects Binance and Bybit positions once in the position section", async () => {
  await syncExchangePositionWatchlist(db, "BINANCE", [{ symbol: "DOGEUSDT", quantity: 1 }]);
  await syncExchangePositionWatchlist(db, "BYBIT", [{ symbol: "DOGEUSDT", quantity: 2 }, { symbol: "WIFUSDT", quantity: 1 }]);

  const sections = await listWatchlistSections(db);
  const positions = sections.find((section) => section.id === "POSITION");
  assert.deepEqual(positions?.items.map((item) => item.symbol), ["DOGEUSDT", "WIFUSDT"]);

  await syncExchangePositionWatchlist(db, "BINANCE", []);
  assert.deepEqual((await listWatchlistSections(db)).find((section) => section.id === "POSITION")?.items.map((item) => item.symbol), ["DOGEUSDT", "WIFUSDT"]);
});
