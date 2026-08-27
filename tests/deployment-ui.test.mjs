import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("部署入口受服务端权限保护且不调用 shell", async () => {
  const source = await readFile(new URL("app/api/deployment/route.ts", root), "utf8");
  assert.match(source, /requireOperator/);
  assert.match(source, /requireOperatorMutation/);
  assert.match(source, /triggerDeploymentUpdate/);
  assert.doesNotMatch(source, /exec\(|spawn\(|child_process|bash|sh -c/);
});

test("连接设置提供部署状态和受控更新按钮", async () => {
  const source = await readFile(new URL("app/settings/ConnectionSettings.tsx", root), "utf8");
  assert.match(source, /api\/deployment/);
  assert.match(source, /请求部署更新/);
  assert.match(source, /部署与升级/);
});
