import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const servicePath = new URL("../deploy/trade-workbench-ma30-priority-watcher.service", import.meta.url);
const timerPath = new URL("../deploy/trade-workbench-ma30-priority-watcher.timer", import.meta.url);

test("prepared service is DRY_RUN-only until tomorrow acceptance", () => {
  const service = fs.readFileSync(servicePath, "utf8");
  assert.match(service, /Environment=MA30_PRIORITY_ENABLE_LIVE_BARK=NO/);
  const exec = service.split("\n").find((line) => line.startsWith("ExecStart="));
  assert.ok(exec);
  assert.equal(exec.includes("--live"), false);
  assert.match(exec, /ma30-priority-watcher-safe\.ts/);
});

test("prepared timer runs four minutes after each 15m boundary but is not self-enabled", () => {
  const timer = fs.readFileSync(timerPath, "utf8");
  assert.match(timer, /OnCalendar=\*-\*-\* \*:04,19,34,49:00/);
  assert.match(timer, /Unit=trade-workbench-ma30-priority-watcher\.service/);
  assert.match(timer, /WantedBy=timers\.target/);
});