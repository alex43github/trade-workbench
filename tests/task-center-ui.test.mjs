import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const page = await readFile(new URL("../app/ops/tasks/page.tsx", import.meta.url), "utf8");
const client = await readFile(new URL("../app/ops/tasks/TaskCenterClient.tsx", import.meta.url), "utf8");

test("task center route is explicitly dynamic and guarded", () => {
  assert.match(page, /force-dynamic/);
  assert.match(page, /(?:requireTaskCenterAccess|isTaskCenterEnabled)/);
  assert.match(page, /TaskCenterClient/);
});

test("task center UI exposes Chinese filters, status labels, refresh cadence, and required details", () => {
  for (const text of ["/api/ops/tasks", "ChatGPT", "GitHub", "VPS", "RUNNING", "WAITING", "BLOCKED", "FAILED", "COMPLETED", "PAUSED", "SCHEDULED", "STALE", "未知", "时间线", "下一步", "阻塞", "最后更新", "下次运行"]) {
    assert.match(client, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `missing UI text: ${text}`);
  }
  assert.match(client, /30_000|30000/);
  assert.doesNotMatch(client, /prompt/i);
});
