import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("scanner systemd unit is read-only market work with explicit Bark safety acknowledgement", async () => {
  const service = await read("deploy/trade-workbench-ma30-scanner.service");
  assert.match(service, /User=trade-workbench/);
  assert.match(service, /STREETLIGHT_LOCAL_D1=\/var\/lib\/trade-workbench\/sqlite\/d1\.sqlite/);
  assert.match(service, /MA30_ENABLE_LIVE_BARK=YES/);
  assert.match(service, /ma30-production-live-safe\.ts --live/);
  assert.doesNotMatch(service, /API_SECRET|PRIVATE_KEY|withdraw|order/i);
});

test("scanner timer runs once per hour shortly after the closed 1H candle", async () => {
  const timer = await read("deploy/trade-workbench-ma30-scanner.timer");
  assert.match(timer, /OnCalendar=\*-\*-\* \*:02:00/);
  assert.match(timer, /Persistent=true/);
});

test("outcome backfill is isolated from scanner failure domain and runs later each hour", async () => {
  const service = await read("deploy/trade-workbench-ma30-outcomes.service");
  const timer = await read("deploy/trade-workbench-ma30-outcomes.timer");
  assert.match(service, /ma30-outcome-backfill\.ts/);
  assert.doesNotMatch(service, /--live|MA30_ENABLE_LIVE_BARK/);
  assert.match(timer, /OnCalendar=\*-\*-\* \*:08:00/);
  assert.match(timer, /Persistent=true/);
});

test("both MA30 services keep production filesystem hardening and only allow database writes", async () => {
  for (const path of [
    "deploy/trade-workbench-ma30-scanner.service",
    "deploy/trade-workbench-ma30-outcomes.service",
  ]) {
    const service = await read(path);
    assert.match(service, /NoNewPrivileges=true/);
    assert.match(service, /ProtectSystem=strict/);
    assert.match(service, /ReadWritePaths=\/var\/lib\/trade-workbench/);
  }
});
