import assert from "node:assert/strict";
import test from "node:test";

import { detachTask } from "../services/workbench/background-task.mjs";

test("detached task returns immediately while the underlying work is still pending", async () => {
  let resolveTask;
  let settled = false;
  const task = new Promise((resolve) => {
    resolveTask = resolve;
  }).finally(() => {
    settled = true;
  });

  const result = detachTask(task, () => {
    throw new Error("unexpected background error");
  });

  assert.equal(result, undefined);
  assert.equal(settled, false);

  resolveTask();
  await task;
  assert.equal(settled, true);
});

test("detached task consumes and reports background rejection", async () => {
  const observed = [];
  detachTask(Promise.reject(new Error("background boom")), (error) => {
    observed.push(error instanceof Error ? error.message : String(error));
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(observed, ["background boom"]);
});
