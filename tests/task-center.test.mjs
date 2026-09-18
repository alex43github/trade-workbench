import assert from "node:assert/strict";
import test from "node:test";

import { parseProgressPct } from "../lib/task-center/progress.ts";
import { buildChatGPTTasks, isSnapshotStale } from "../lib/task-center/snapshot.ts";
import { aggregateBridgeTasks, parseBridgeEvents } from "../lib/task-center/github-bridge.ts";
import { buildTaskCenterSummary, createGithubBridgeLoader } from "../lib/task-center/service.ts";
import { isTaskCenterEnabled, requireTaskCenterAccess } from "../lib/task-center/access.ts";

const NOW = new Date("2026-09-18T15:00:00.000Z");

test("parses explicit test, step, and coverage progress without inventing percentages", () => {
  assert.equal(parseProgressPct("completed 3/5 tests"), 60);
  assert.equal(parseProgressPct("已完成步骤 7 / 10"), 70);
  assert.equal(parseProgressPct("coverage: 82%"), 82);
  assert.equal(parseProgressPct("issue #1 has 3 comments"), null);
  assert.equal(parseProgressPct("work is underway"), null);
});

test("marks a snapshot stale only after the configured freshness window", () => {
  assert.equal(isSnapshotStale("2026-09-18T14:31:00.000Z", NOW), false);
  assert.equal(isSnapshotStale("2026-09-18T14:29:59.000Z", NOW), true);
});

test("maps enabled, paused, and completed automation records to unified tasks", () => {
  const snapshot = {
    schemaVersion: 1,
    lastSyncedAt: "2026-09-18T14:50:00.000Z",
    tasks: [
      {
        id: "enabled-1",
        title: "Enabled automation",
        enabled: true,
        timing_mode: "exact_schedule",
        schedule: "每小时10分 Asia/Shanghai",
        last_run_time: "2026-09-18T14:09:11.000Z",
        updated_at: "2026-09-18T14:09:33.000Z",
      },
      {
        id: "paused-1",
        title: "Paused automation",
        enabled: false,
        paused: true,
        updated_at: "2026-09-18T14:10:00.000Z",
      },
      {
        id: "completed-1",
        title: "Completed automation",
        status: "completed",
        enabled: false,
        updated_at: "2026-09-18T14:11:00.000Z",
      },
    ],
  };

  const result = buildChatGPTTasks(snapshot, { now: NOW });
  assert.deepEqual(result.tasks.map((task) => task.status), ["SCHEDULED", "PAUSED", "COMPLETED"]);
  assert.equal(result.tasks[0].source, "CHATGPT_AUTOMATION");
  assert.equal(result.tasks[0].schedule, "每小时10分 Asia/Shanghai");
  assert.equal(result.tasks[0].lastRunAt, "2026-09-18T14:09:11.000Z");
  assert.equal(result.stale, false);

  const staleResult = buildChatGPTTasks({ ...snapshot, lastSyncedAt: "2026-09-18T14:00:00.000Z" }, { now: NOW });
  assert.deepEqual(staleResult.tasks.map((task) => task.status), ["STALE", "PAUSED", "COMPLETED"]);
  assert.equal(buildTaskCenterSummary(staleResult.tasks).nextScheduled?.title, "Enabled automation");
});

function comment(id, body, updatedAt) {
  return {
    id,
    body,
    created_at: updatedAt,
    updated_at: updatedAt,
    html_url: `https://github.com/alex43github/trade-workbench/issues/1#issuecomment-${id}`,
  };
}

test("aggregates Bridge events into status, progress, timeline, and links", () => {
  const comments = [
    comment(101, "[TASK bridge-pass]\nTask center parser\ncompleted 3/5 tests", "2026-09-18T14:00:00.000Z"),
    comment(102, "[DECISION bridge-pass]\n下一步：实现 UI", "2026-09-18T14:05:00.000Z"),
    comment(103, "[RESULT bridge-pass] PASS\ncoverage: 82%", "2026-09-18T14:10:00.000Z"),
    comment(104, "[TASK bridge-fail]\nFailing task", "2026-09-18T14:00:00.000Z"),
    comment(105, "[RESULT bridge-fail] FAIL\nTypecheck failed", "2026-09-18T14:10:00.000Z"),
    comment(106, "[TASK bridge-blocked]\nBlocked task", "2026-09-18T14:00:00.000Z"),
    comment(107, "[BLOCKED bridge-blocked]\nblocker: waiting for approval", "2026-09-18T14:10:00.000Z"),
    comment(108, "[VPS_TASK vps-1]\nVPS read-only check", "2026-09-18T14:00:00.000Z"),
    comment(109, "[VPS_RESULT vps-1] PASS\ncompleted 2/2 steps", "2026-09-18T14:10:00.000Z"),
  ];

  const events = parseBridgeEvents(comments);
  assert.equal(events.length, comments.length);
  const tasks = aggregateBridgeTasks(comments, { now: NOW });
  const pass = tasks.find((task) => task.id === "bridge-pass");
  assert.equal(pass?.status, "COMPLETED");
  assert.equal(pass?.progressPct, 82);
  assert.equal(pass?.timeline.length, 3);
  assert.equal(pass?.latestEvent?.result, "PASS");
  assert.match(pass?.link ?? "", /issuecomment-103$/);
  assert.equal(pass?.metadata.issueUrl, "https://github.com/alex43github/trade-workbench/issues/1");
  assert.equal(tasks.find((task) => task.id === "bridge-fail")?.status, "FAILED");
  assert.equal(tasks.find((task) => task.id === "bridge-blocked")?.status, "BLOCKED");
  assert.equal(tasks.find((task) => task.id === "bridge-blocked")?.blocker, "waiting for approval");
  assert.equal(tasks.find((task) => task.id === "vps-1")?.source, "VPS_BRIDGE");
  assert.equal(tasks.find((task) => task.id === "vps-1")?.status, "COMPLETED");
});

test("marks an old active Bridge task stale without treating it as failed", () => {
  const tasks = aggregateBridgeTasks([
    comment(110, "[TASK old-task]\nwaiting for runner", "2026-09-18T13:00:00.000Z"),
  ], { now: NOW });
  assert.equal(tasks[0].status, "STALE");
  assert.equal(tasks[0].stale, true);
  assert.notEqual(tasks[0].status, "FAILED");
});

test("does not invent progress when Bridge text has no reliable ratio", () => {
  const tasks = aggregateBridgeTasks([
    comment(111, "[TASK unknown-progress]\nthree comments and one issue", "2026-09-18T14:50:00.000Z"),
  ], { now: NOW });
  assert.equal(tasks[0].progressPct, null);
});

test("caches GitHub comments and falls back to the last cache on fetch failure", async () => {
  const comments = [comment(112, "[TASK cached-task]\nCached task", "2026-09-18T14:50:00.000Z")];
  let calls = 0;
  const loader = createGithubBridgeLoader();
  const fetcher = async () => {
    calls += 1;
    return new Response(JSON.stringify(comments), { status: 200, headers: { "content-type": "application/json" } });
  };

  const first = await loader.load({ fetcher, now: new Date("2026-09-18T14:51:00.000Z") });
  const cached = await loader.load({ fetcher, now: new Date("2026-09-18T14:51:10.000Z") });
  assert.equal(calls, 1);
  assert.equal(cached.cached, true);
  assert.equal(cached.tasks[0].id, "cached-task");

  const fallback = await loader.load({
    fetcher: async () => { throw new Error("GitHub unavailable"); },
    now: new Date("2026-09-18T14:52:00.000Z"),
    forceRefresh: true,
  });
  assert.equal(fallback.degraded, true);
  assert.equal(fallback.tasks[0].id, first.tasks[0].id);
  assert.match(fallback.error ?? "", /GitHub unavailable/);
});

test("task center access is loopback-only and disabled by default in production", async () => {
  assert.equal(isTaskCenterEnabled(new Request("http://localhost:3000/ops/tasks"), { NODE_ENV: "development" }), true);
  assert.equal(isTaskCenterEnabled(new Request("https://public.example/ops/tasks"), { NODE_ENV: "development" }), false);
  assert.equal(isTaskCenterEnabled(new Request("http://127.0.0.1:3000/ops/tasks"), { NODE_ENV: "production" }), false);
  assert.equal(isTaskCenterEnabled(new Request("http://127.0.0.1:3000/ops/tasks"), { NODE_ENV: "production", TASK_CENTER_ENABLED: "true" }), true);
  assert.equal(isTaskCenterEnabled(new Request("https://public.example/ops/tasks"), { NODE_ENV: "production", TASK_CENTER_ENABLED: "true" }), false);
  assert.equal(isTaskCenterEnabled(new Request("http://localhost:3000/ops/tasks"), { NODE_ENV: "development", TASK_CENTER_ENABLED: "false" }), false);

  const denied = await requireTaskCenterAccess(new Request("https://public.example/api/ops/tasks"), { NODE_ENV: "development" });
  assert.equal(denied?.status, 404);
});
