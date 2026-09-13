import assert from "node:assert/strict";
import test from "node:test";
import { listManualFocusSymbols } from "../lib/structure-radar/focus-source-store.ts";

test("manual focus source store returns only normalized manual active symbols", async () => {
  let sql = "";
  const db = {
    prepare(value) {
      sql = value;
      return { async all() { return { results: [{ symbol: "enausdt" }, { symbol: "LSKUSDT" }, { symbol: "bad" }] }; } };
    },
  };
  const result = await listManualFocusSymbols(db);
  assert.match(sql, /source = 'MANUAL'/);
  assert.match(sql, /removed_at IS NULL/);
  assert.deepEqual(result, ["ENAUSDT", "LSKUSDT"]);
});
