import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("远程页面提供同源管理员登录入口并避免持久化令牌", async () => {
  const gate = await readFile(new URL("../app/components/OperatorGate.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");

  assert.match(gate, /\/api\/advisory\/session/);
  assert.match(gate, /type=\"password\"/);
  assert.match(gate, /autoComplete=\"current-password\"/);
  assert.doesNotMatch(gate, /localStorage|sessionStorage/);
  assert.doesNotMatch(gate, /实盘路由仍保持关闭/);
  assert.match(gate, /账户读取、实盘策略和 AI 会诊/);
  assert.doesNotMatch(layout, /模拟盘|模拟交易/);
  assert.match(layout, /OperatorGate/);
});
