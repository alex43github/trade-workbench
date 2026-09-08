import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const terminalSource = await readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
const stylesSource = await readFile(new URL("../app/trade/trade.module.css", import.meta.url), "utf8");

test("trade chart lets custom symbols be added to a persisted watchlist", () => {
  assert.match(terminalSource, /useWatchlist/);
  assert.match(terminalSource, /toggleFavorite/);
  assert.match(terminalSource, /aria-pressed=\{isFavorite\}/);
  assert.match(terminalSource, /watchlist\.map/);
  assert.match(terminalSource, /加入.*自选/);
  assert.doesNotMatch(terminalSource, /slice\(0, 12\)/);
  assert.match(stylesSource, /\.favoriteButton/);
});
