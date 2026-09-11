import assert from "node:assert/strict";
import test from "node:test";

import { providerAlertKey, resumableSymbolsFromAlerts } from "../lib/advisory/provider-alerts.ts";

test("provider alert keys deduplicate one provider failure class per UTC day", () => {
  assert.equal(providerAlertKey("deepseek", "QUOTA", "2026-08-13T12:30:00Z"), "provider:deepseek:QUOTA:2026-08-13");
});

test("manual resume only selects supported symbols from open provider alerts", () => {
  const alerts = [
    { context_json: JSON.stringify({ symbol: "BTCUSDT" }) },
    { context_json: JSON.stringify({ symbol: "BTCUSDT" }) },
    { context_json: JSON.stringify({ symbol: "SOLUSDT" }) },
    { context_json: JSON.stringify({ symbol: "DOGEUSDT" }) },
    { context_json: "invalid" },
  ];
  assert.deepEqual(resumableSymbolsFromAlerts(alerts), ["BTCUSDT", "SOLUSDT"]);
});
