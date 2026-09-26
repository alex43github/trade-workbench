# FAST-DETACH-V2 TASK-007C Persistent Storage Plan

状态：DESIGN_ONLY；本 TASK-007C 不写入 `/var/lib/trade-workbench/research/forward-shadow/`。

## 目标布局

```text
/var/lib/trade-workbench/research/forward-shadow/
└── epochs/
    └── epoch-20260924T185000/
        ├── LIVE_FORWARD_EPOCH.json
        ├── LIVE_EVENT_SNAPSHOT.jsonl
        ├── LIVE_EVENT_TRANSITION.jsonl
        ├── LIVE_EVENT_OUTCOME.jsonl
        ├── UNIFIED_RESEARCH_VIEW.jsonl
        ├── SHADOW_FORWARD_SUMMARY.jsonl
        ├── SHADOW_SCANNER_STATE.json
        ├── MANIFEST.json
        └── SHA256SUMS
```

`MANIFEST.json` 记录 protocol version、epoch id、source path、source SHA、文件行数、collector build SHA、迁移时间和迁移状态。`SHA256SUMS` 是复制完成后的逐文件 SHA 清单。不同 Forward Epoch 必须使用不同目录，禁止把不同 epoch 合并到同一 ledger。

## 迁移前置条件

1. 获得对 `/var/lib/trade-workbench/research/forward-shadow/` 的明确写入授权。
2. 停止或安全暂停 shadow collector，并确认 lock 已释放；不停止生产服务。
3. 重新读取现有 Epoch、snapshot、transition、outcome、view、summary、state 的文件清单、行数和 SHA。
4. 重新读取历史 `chunk_001_unified.jsonl` SHA，必须仍为 `de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e`；不得访问 `chunk_002`。
5. 源目录仍保持 `/tmp/fast-detach-v2-task007-20260924/`，不删除、不重写、不改名。

## copy → verify SHA → preserve source

迁移只允许采用“复制后验证”的流程：

1. 在目标目录建立同一 `epoch_id` 的 staging 目录；不得直接覆盖已存在的 canonical 目录。
2. 逐文件复制原始 bytes，包含 JSONL 换行；不重新序列化、不排序、不合并 outcome 到 snapshot。
3. 在 staging 目录生成 `SHA256SUMS`，逐项与迁移前 source inventory 比较；文件大小、行数和 SHA 必须完全一致。
4. 只读加载 staging 的 protocol records，验证 event/transition/outcome identity、hash、source separation 和 view projection。
5. 生成 `MANIFEST.json`，再次计算 MANIFEST 自身 SHA。
6. 通过 atomic rename 将 staging 变为该 epoch 的目标目录；若目标已存在且任何 payload 不一致，立即 HARD FAIL，不覆盖。
7. 迁移后再次比较 source SHA；source 必须与迁移前完全一致。源保留作为原始 TASK-007/007B/007C 证据。

## 当前 source inventory（启动前基线）

```text
source root=/tmp/fast-detach-v2-task007-20260924
epoch=epoch-20260924T185000
LIVE_FORWARD_EPOCH.json      446a6a3281d2b1eb74dc886b032c3ee19abe82ad0547c0f65b41159c692c7781
chunk_001_unified.jsonl      de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
```

TASK-007C 结束时必须把完整逐文件 inventory 追加到验收报告；上面的启动基线不得被后续动态 append 文件的 SHA 替代或解释为“不变”。

## 禁止事项

- 当前任务不创建目标目录、不复制到 `/var/lib`、不安装 systemd/cron、不开启常驻服务。
- 不把 `/tmp` 迁移解释为 production 接线，也不把目标目录作为生产 scanner 的写入目录。
- 不修改 `/opt`、生产模型/threshold、Bark 或订单链。

## 短时验证 inventory（非迁移）

本节只记录 `/tmp/fast-detach-v2-task007-20260924/` 的最终 shadow 证据，不表示已迁移或写入目标持久化目录：

```text
LIVE_FORWARD_EPOCH.json      446a6a3281d2b1eb74dc886b032c3ee19abe82ad0547c0f65b41159c692c7781
LIVE_EVENT_SNAPSHOT.jsonl    fc006c8b67ab3f628f1f049c40072ce862f35bb13fef4b56533ff9442c982f6c
LIVE_EVENT_TRANSITION.jsonl  6995e06be3dafc708f0a82b7affa928e3c981a060999d4d4f5b88434d0f93e03
LIVE_EVENT_OUTCOME.jsonl     1d1dd68393a8068e1767ba9a286099907ab650bc6653adf0098116e453fddc9c
UNIFIED_RESEARCH_VIEW.jsonl  bf746b20d0daf6eb497ef94984a4945a5c4956678fd9fc5d212405cdae13936f
SHADOW_SCANNER_STATE.json    7108020caa12449b564e40f5d8a89f79ddee2b169b27c4fd6563e710f0c39e0d
```

## TASK-007D persistent copy result

在 TASK-007D 明确授权后，已将同一 `epoch-20260924T185000` 复制到：

```text
/var/lib/trade-workbench/research/forward-shadow/epochs/epoch-20260924T185000/
```

复制采用 staging → byte/SHA/row-count verify → publish；`PERSISTENT_COPY_SHA_MATCH=true`、`SOURCE_TMP_PRESERVED=true`。源 `/tmp` 目录仍保留，canonical snapshot/transition/outcome/view 未重写。persistent 目录中的 `audit/` 只包含 TASK-007D 新增的 EAP status、EDP-only summary 和 observability gap audit，不属于 Production 接线。
