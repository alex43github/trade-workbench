# 实盘策略订单初始化修复报告

## 根因

`ensureLiveStrategySchema()` 原来只在所有异步建表、建索引操作完成后才设置 `liveStrategyInitialized = true`。VPS 上监控接口和实盘策略接口可能同时首次访问，因此两个请求都会进入同一组 D1 schema 初始化批次。`CREATE TABLE/INDEX IF NOT EXISTS` 只能处理已经提交的对象，不能让并发 D1 schema 写入互斥；后到的请求因此可能收到 `there is already another table or index with this name: live_strategy_execution_fills`，导致实盘策略状态列表无法读取。

## RED

新增 `tests/live-strategy-schema-initialization.test.mjs`，实际调用 `ensureLiveStrategySchema()`，用受控的异步 D1 batch reproduces 并发 schema 写入冲突。生产代码修复前运行：

```text
✖ concurrent live strategy schema requests share one D1 initialization
Error: there is already another table or index with this name: live_strategy_execution_fills
```

该失败来自第二个并发初始化请求，符合线上错误。

## GREEN

在 `db/ensure.ts` 中把原初始化逻辑拆为 `ensureLiveStrategySchemaInner()`，并增加模块级 `liveStrategyInitialization` Promise 锁：

- 第一个请求创建并执行初始化 Promise；后续请求复用同一 Promise，不再重复提交 schema batch。
- 初始化失败时清空 Promise 锁，允许后续请求重新尝试。
- 修复只改变初始化协调，不删除、重建或迁移任何表、索引和订单数据。

修复后验证结果：

```text
node --test tests/live-strategy-schema-initialization.test.mjs
✔ concurrent live strategy schema requests share one D1 initialization

node --test tests/live-strategy-schema-initialization.test.mjs tests/trade-monitor-api.test.mjs tests/live-strategy-generations.test.mjs
ℹ tests 7
ℹ pass 7
ℹ fail 0

git diff --check -- db/ensure.ts tests/live-strategy-schema-initialization.test.mjs
通过
```

本次未发布到 VPS；由主 agent 审核后再决定部署。
