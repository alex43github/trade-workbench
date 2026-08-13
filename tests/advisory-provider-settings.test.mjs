import assert from "node:assert/strict";
import test from "node:test";

import { getActiveProvider, setActiveProvider } from "../lib/advisory/provider-settings.ts";

function memoryDb() {
  let active = null;
  return {
    prepare(sql) {
      return {
        values: [], bind(...values) { this.values = values; return this; },
        async first() { return active ? { value: active } : null; },
        async run() { if (/INSERT INTO advisory_settings/.test(sql)) active = this.values[1]; return { success: true }; },
      };
    },
  };
}

test("global provider persists one valid manual selection", async () => {
  const db = memoryDb();
  assert.equal(await getActiveProvider(db, { AI_PROVIDER: "openai" }), "openai");
  await setActiveProvider(db, "anthropic");
  assert.equal(await getActiveProvider(db, { AI_PROVIDER: "openai" }), "anthropic");
  await assert.rejects(() => setActiveProvider(db, "unknown"), /unsupported/);
});
