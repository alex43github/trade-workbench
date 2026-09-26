# Codex Review Packet — FAST-DETACH-V2-TASK-007D

TASK_ID=FAST-DETACH-V2-TASK-007D
STATUS=APPROVAL_GATE
STARTED_AT=2026-09-26T00:12:09+08:00
FINISHED_AT=2026-09-26T00:13:06+08:00
COMMIT_SHA=NOT_COMMITTED

## SUMMARY

TASK-007D 已完成并停止在 approval gate。177 个 LIVE_FORWARD 事件没有可审计的 EAP 记录；审计结论是 `EAP_ZERO_ROOT_CAUSE=OBSERVER_NOT_CONNECTED`，不是“确认没有执行权限”。已完成：

- 以 COPY 方式将 `epoch-20260924T185000` 持久化到 `/var/lib/trade-workbench/research/forward-shadow/`；原始 `/tmp` source 保持不变。
- 保留 Historical/Live source separation，Historical=50、Live=177、Unified View=227。
- 新增 EAP source audit、EAP schema/observer、append-only `EAP_GRANTED` transition、immutable EAP status ledger、EDP/EAP denominator separation。
- Existing 177 条 live 事件分类为 `EAP_NOT_OBSERVED`；没有构造 synthetic/replay EAP。
- 生成 EDP-only descriptive summary；不做 promotion、threshold、model、Bark、order 或 production 结论。
- 生成 `PRODUCTION_OBSERVABILITY_GAP.json`，记录候选、通知、scorecard、outcome 四类生产可观测性缺口。
- 完成 VPS shadow validation；未进入 `/opt`、未启动常驻 collector、未重启生产服务、未访问 chunk002。

本 Review Packet round 只新增本 packet 及标准 `git diff` patch，不修改 TASK-007D 运行产物和生产代码。工作树在本 round 开始前已经包含多项前序任务的 dirty/untracked changes；下文将其与 TASK-007D scope 分开列出。

## CHANGED_FILES

### A. TASK-007D scope（本任务产物或本任务直接修改）

以下每个文件均已给出目的、核心逻辑、Production 影响及 threshold/model/Bark/order 影响：

| File | 修改目的与核心逻辑 | Production 影响 | threshold/model/Bark/order path |
|---|---|---|---|
| `EAP_SOURCE_AUDIT.md` | 审计 EDP→EAP 链路并将 177 条事件分类为 `EAP_NOT_OBSERVED`；记录 scanner、state、consultation 与缺失 permission observer 的证据。 | 无；只读审计文档。 | 无。
| `PRODUCTION_OBSERVABILITY_GAP.json` | 固化四类缺口：candidate writeback、notification ledger、hourly scorecard、score outcome；标记需要后续 production change。 | 本轮未修复、未接线。 | 无。
| `change-logs/REQ-20260925-fast-detach-v2-task-007d.md` | 记录 TASK-007D 结果、SHA、指标、验证和 stop gate。 | 无。 | 无。
| `docs/superpowers/plans/2026-09-25-fast-detach-v2-task-007d.md` | 记录 TASK-007D 实施计划和完成清单。 | 无。 | 无。
| `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-007c-storage-plan.md` | 补充 persistent Forward epoch COPY 的结果、路径和不变量。 | 只记录 shadow storage，不改变 production。 | 无。
| `services/structure-radar/research/task-007-protocol.ts` | 增加 `EAP_GRANTED` transition type，保持 event identity 和 transition contract。 | 仅 research/shadow 协议；未部署到 production。 | 不改变 threshold/model/Bark/order。
| `services/structure-radar/research/task-007c-shadow.ts` | 将 discovery denominator 与 EAP-valid denominator 分开，并暴露 discovery/EAP sample quality。 | 无 production 接线。 | 不改变 threshold/model/Bark/order。
| `services/structure-radar/research/task-007c-shadow-state.ts` | 为 identity 增加 EAP 状态；旧调用默认 `NOT_ESTABLISHED`，collector 明确写 `EAP_NOT_OBSERVED`。 | 无 production 接线。 | 不改变 threshold/model/Bark/order。
| `scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts` | 增加可选 EAP observer；只有真实 permission decision 才 append `EAP_GRANTED`，否则保留 `EAP_NOT_OBSERVED`；重复决策复用，冲突 hard fail。 | 仅 shadow collector；本轮未长驻运行。 | 不修改 production scanner/model/threshold、Bark 或 order。
| `services/structure-radar/research/task-007d-audit.ts` | 提供 EAP root-cause、identity、source separation、feature leakage、重复键和 immutable snapshot 审计。 | 无。 | 无。
| `services/structure-radar/research/task-007d-eap.ts` | 定义 EAP schema、causal timestamp、permission-only 语义、append-only transition 与 idempotence。 | 无 production 接线。 | 不改变 threshold/model/Bark/order。
| `services/structure-radar/research/task-007d-persistence.ts` | 以 COPY 而非 MOVE 持久化 epoch，并逐字节验证 source/target SHA；保留 source。 | 写入用户授权的 `/var/lib/.../forward-shadow/`，不写 `/opt`。 | 不改变 threshold/model/Bark/order。
| `services/structure-radar/research/task-007d-summary.ts` | 生成 EDP-only descriptive summary，按 timeframe/setup/channel 分层；EAP_NOT_OBSERVED 不进入 EAP metrics。 | 无。 | 不做 promotion，不修改 threshold/model/Bark/order。
| `scripts/fast-detach-v2-task-007d-shadow-validation.ts` | 执行 persistent copy、EAP audit、EDP summary、24h ETH/TRX、immutable ledger、SHA、PID、chunk002 和 production side-effect 验证。 | 只写 shadow audit 目录；不部署、不重启。 | 无。
| `tests/fast-detach-task-007d.test.mjs` | 覆盖 root cause、EAP identity、append-only/reuse/conflict、metric separation、sample quality、summary、gap JSON、persistent copy。 | 无。 | 无。
| `change-logs/CODEX_REVIEW_PACKET_LATEST.md` | 本轮统一交接 Review Packet。 | 无。 | 无。
| `change-logs/CODEX_REVIEW_PACKET_LATEST.patch` | 按用户要求由 `git diff > change-logs/CODEX_REVIEW_PACKET_LATEST.patch` 生成的工作树 patch。 | 无。 | 无。

### B. 前序任务已存在的 dirty/untracked files（本 round 未修改）

这些路径在本轮开始前已存在于工作树中；本 packet 不把它们的既有内容归因于 TASK-007D。本组每个文件的统一审计结论是：修改目的/核心逻辑属于前序任务或既有平台改动；本 round 未读取并重写其逻辑；本 round 对 Production、threshold/model/Bark/order 的新增影响为“无”，但既有内容如涉及 production，仍需由其原任务 packet 审核。

#### B1. Git tracked dirty files

- `change-logs/INDEX.md`
- `deploy/README.md`
- `deploy/trade-workbench.service`
- `lib/advisory/notifications.ts`
- `lib/notifications/bark.ts`
- `lib/radar/atr-persistence.ts`
- `lib/radar/binance-public.ts`
- `scripts/radar-deployment-preflight.mjs`
- `services/structure-radar/config.ts`
- `tests/radar-deployment-preflight.test.mjs`
- `tests/structure-radar-daemon.test.mjs`

#### B2. 前序 Fast-Detach 研究、文档和测试

- `PRODUCTION_OBSERVABILITY_GAP_REPORT.md`
- `artifacts/fast-detach-v2/generate_fast_detach_v2.py`
- `artifacts/fast-detach-v2/task_002_5m.py`
- `artifacts/fast-detach-v2/task_003_pe.py`
- `artifacts/fast-detach-v2/task_004_unified.py`
- `artifacts/fast-detach-v2/task_005_discovery.py`
- `artifacts/fast-detach-v2/task_006_oos.py`
- `artifacts/fast-detach-v2/test_generator.py`
- `artifacts/fast-detach-v2/test_task_002.py`
- `artifacts/fast-detach-v2/test_task_003.py`
- `artifacts/fast-detach-v2/test_task_004.py`
- `artifacts/fast-detach-v2/test_task_005.py`
- `artifacts/fast-detach-v2/test_task_006.py`
- `change-logs/REQ-20260920-bark-resend-guard.md`
- `change-logs/REQ-20260923-fast-detach-v2-task-001.md`
- `change-logs/REQ-20260923-fast-detach-v2-task-002.md`
- `change-logs/REQ-20260924-fast-detach-v2-task-002b.md`
- `change-logs/REQ-20260924-fast-detach-v2-task-003.md`
- `change-logs/REQ-20260924-fast-detach-v2-task-004.md`
- `change-logs/REQ-20260924-fast-detach-v2-task-005.md`
- `change-logs/REQ-20260924-fast-detach-v2-task-006.md`
- `change-logs/REQ-20260924-fast-detach-v2-task-007.md`
- `change-logs/REQ-20260924-fast-detach-v2-task-007b.md`
- `change-logs/REQ-20260924-fast-detach-v2-task-007c.md`
- `docs/superpowers/plans/2026-09-23-fast-detach-v2-task-001.md`
- `docs/superpowers/plans/2026-09-23-fast-detach-v2-task-002.md`
- `docs/superpowers/plans/2026-09-24-fast-detach-v2-task-002b.md`
- `docs/superpowers/plans/2026-09-24-fast-detach-v2-task-003.md`
- `docs/superpowers/plans/2026-09-24-fast-detach-v2-task-004.md`
- `docs/superpowers/plans/2026-09-24-fast-detach-v2-task-005.md`
- `docs/superpowers/plans/2026-09-24-fast-detach-v2-task-006.md`
- `docs/superpowers/plans/2026-09-24-fast-detach-v2-task-007.md`
- `docs/superpowers/plans/2026-09-24-fast-detach-v2-task-007b.md`
- `docs/superpowers/plans/2026-09-24-fast-detach-v2-task-007c.md`
- `docs/superpowers/specs/2026-09-23-fast-detach-v2-task-001-design.md`
- `docs/superpowers/specs/2026-09-23-fast-detach-v2-task-002-design.md`
- `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-002b-design.md`
- `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-003-design.md`
- `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-004-design.md`
- `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-005-design.md`
- `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-006-design.md`
- `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-007-design.md`
- `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-007b-design.md`
- `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-007c-design.md`
- `scripts/fast-detach-v2-task-007-live-dry-run.ts`
- `scripts/fast-detach-v2-task-007b-natural-outcome.ts`
- `services/structure-radar/research/task-007-adapters.ts`
- `services/structure-radar/research/task-007-repository.ts`
- `services/structure-radar/research/task-007b-outcomes.ts`
- `tests/fast-detach-task-007.test.mjs`
- `tests/fast-detach-task-007b.test.mjs`
- `tests/fast-detach-task-007c.test.mjs`

#### B3. 前序 Radar、heartbeat、focus、部署和发布 artifacts

- `app/api/radar/heartbeat/route.ts`
- `artifacts/post-baseline-06/run-isolated-public-binance-smoke.sh`
- `artifacts/post-baseline-06/structure-radar-candidate-3e3f4a0ae27d4a4c839b9d875d7d689b96897a12.tar.gz`
- `artifacts/post-baseline-06/structure-radar-candidate-3e3f4a0ae27d4a4c839b9d875d7d689b96897a12.tar.gz.sha256`
- `artifacts/post-baseline-08/DEPLOYMENT_FILES`
- `artifacts/post-baseline-08/PROVENANCE.txt`
- `artifacts/post-baseline-08/SHA256SUMS`
- `artifacts/post-baseline-08/run-isolated-public-binance-smoke.sh`
- `artifacts/post-baseline-08/structure-radar-candidate-2e6e8a43127f40008c2d8a0b9048f85e05939e90.tar.gz`
- `artifacts/post-baseline-08/test-fixtures/node`
- `artifacts/post-baseline-08/test-smoke-helper.mjs`
- `artifacts/post-baseline-15/DEPLOYMENT_FILES`
- `artifacts/post-baseline-15/PROVENANCE.txt`
- `artifacts/post-baseline-15/SHA256SUMS`
- `artifacts/post-baseline-15/structure-radar-candidate-2e6e8a43127f40008c2d8a0b9048f85e05939e90.tar.gz`
- `artifacts/post-baseline-15/structure-radar-candidate-2e6e8a43127f40008c2d8a0b9048f85e05939e90.tar.gz.sha256`
- `artifacts/post-baseline-24/DEPLOYMENT_FILES`
- `artifacts/post-baseline-24/PROVENANCE.txt`
- `artifacts/post-baseline-24/SHA256SUMS`
- `artifacts/post-baseline-24/structure-radar-candidate-2e6e8a43-post-baseline-24-market-migration-65e7e14e4f012646.tar.gz`
- `artifacts/post-baseline-24/structure-radar-candidate-2e6e8a43-post-baseline-24-market-migration-65e7e14e4f012646.tar.gz.sha256`
- `deploy/trade-workbench-1h-cache-seed.service`
- `deploy/trade-workbench-1h-cache-update.service`
- `deploy/trade-workbench-1h-cache-update.timer`
- `deploy/trade-workbench-focus-deep-v1.service`
- `deploy/trade-workbench-focus-deep-v1.timer`
- `deploy/trade-workbench-focus-v23-cache-fallback.service`
- `deploy/trade-workbench-focus-v23-cache-fallback.timer`
- `deploy/trade-workbench-focus-v23-cache.service`
- `deploy/trade-workbench-focus-v23-cache.timer`
- `deploy/trade-workbench-heartbeat-webhook-retry.timer`
- `deploy/trade-workbench-heartbeat-webhook.service`
- `deploy/trade-workbench-heartbeat-webhook.timer`
- `lib/radar/coverage-health.ts`
- `lib/radar/deep-validation.ts`
- `lib/radar/focus-cache-contract.ts`
- `lib/radar/focus-cache-ranking.ts`
- `lib/radar/focus-resend-guard.ts`
- `lib/radar/market-cache-reader.ts`
- `lib/radar/notification-ledger.ts`
- `lib/radar/overnight-empty-alert.ts`
- `lib/radar/scan-heartbeat.ts`
- `lib/radar/sticky-lifecycle.ts`
- `lib/radar/sticky-replay.ts`
- `ops/google-apps-script-heartbeat-webhook.js`
- `scripts/atr-persistence-v1-hourly.ts`
- `scripts/build-radar-package.mjs`
- `scripts/build-universe-1h-snapshot.ts`
- `scripts/focus-deploy-contract.mjs`
- `scripts/focus-pool-v22-cd-bark.ts`
- `scripts/focus-pool-v23-cache-only.ts`
- `scripts/import-binance-public-data-cache.ts`
- `scripts/replay-sticky-second-chance.ts`
- `scripts/run-focus-v23-fallback.ts`
- `scripts/run-focus-v23-main.ts`
- `scripts/run-isolated-public-binance-smoke.sh`
- `scripts/update-universe-1h-hourly.ts`
- `scripts/write-scan-heartbeat.ts`
- `services/heartbeat-webhook-sender/send-heartbeat.mjs`
- `tests/focus-cache-ranking.test.mjs`
- `tests/focus-resend-guard.test.mjs`
- `tests/heartbeat-webhook-assets.test.mjs`
- `tests/heartbeat-webhook-bridge.test.mjs`
- `tests/one-hour-cache.test.mjs`
- `tests/one-hour-deploy-contract.test.mjs`
- `tests/overnight-empty-alert-runner.test.mjs`
- `tests/overnight-empty-alert.test.mjs`
- `tests/radar-deep-secondchance.test.mjs`
- `tests/radar-scan-heartbeat.test.mjs`
- `tests/structure-radar-package-closure.test.mjs`
- `tests/structure-radar-public-smoke-helper.test.mjs`
- `tests/structure-radar-websocket-url.test.mjs`

## TEST_RESULTS

本轮按协议重跑：

- Focused: `node --test tests/fast-detach-task-007d.test.mjs` → 8 passed, 0 failed, 0 skipped。
- Related Node regression: `node --test tests/fast-detach-task-007.test.mjs tests/fast-detach-task-007b.test.mjs tests/fast-detach-task-007c.test.mjs tests/fast-detach-task-007d.test.mjs` → 29 passed, 0 failed, 0 skipped。
- Historical Fast-Detach regression: `python3 -m unittest discover -s artifacts/fast-detach-v2 -p 'test_*.py' -v` → 98 passed, 0 failed。
- Radar regression: `npm run radar:test` → 101 total, 100 passed, 0 failed, 1 skipped；唯一 skip 是当前 sandbox 禁止 loopback listener，测试本身已明确标注，未弱化。
- TypeScript check: `npx tsc --noEmit` → exit 1，8 个既有错误位于 `app/trade/TradeChart.tsx`、`app/trade/TradingTerminal.tsx`、`lib/trade/live-exit-reconciliation.ts`、`lib/trade/protection-math.ts`、`lib/trade/protection-strategies.ts`；本轮没有 TASK-007D 文件错误。
- Remote uploaded TypeScript syntax checks → passed。
- `git diff --check` → passed。
- `git status --short` → 已执行；完整 dirty inventory 见 `CHANGED_FILES`。

## DATA_INVARIANTS

```text
FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
HISTORICAL_SHA_BEFORE=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_SHA_AFTER=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_FROZEN_UNCHANGED=true
CHUNK002_ACCESSED=false
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false
```

Additional shadow result: `TRANSITION_MUTATION_COUNT=0`、`DUPLICATE_TRANSITION_KEYS=0`、`EAP_STATUS_AUDIT_ROWS=177`、`EAP_STATUS_AUDIT_CONFLICTS=0`、`EAP_STATUS_AUDIT_REUSED=true`。

## PRODUCTION_SIDE_EFFECTS

- Production service: `squeeze-radar.service`。
- PID before/after: `1412125 / 1412125`。
- 未写入 `/opt`，未修改 production scanner、threshold、model、Bark production behavior 或 order path。
- 未重启、未 reload、未启动常驻 collector。
- 只使用用户授权的 `/var/lib/trade-workbench/research/forward-shadow/` persistent shadow 目录；source `/tmp/fast-detach-v2-task007-20260924/live/run-20260924T185000/` 保留。
- Persistent copy 为 7 个 canonical files；source inventory 中的 stale temporary state file 未作为 canonical artifact 覆盖写入。
- COPY 后 VPS `/var/lib` 的 `df` 四舍五入显示 80%；已停止后续远端写入，未删除任何数据。

## KNOWN_LIMITATIONS

- EAP observer 当前未连接，因此 `LIVE_EAP_OBSERVED_N=0` 只能解释为“未观察到 immutable permission decision”，不能解释为“没有 execution permission”。
- EAP denominator 为 0，`EAP_SAMPLE_QUALITY_6H=LOW_SAMPLE`；只输出 EDP descriptive summary，不做 promotion 或 model conclusion。
- `PRODUCTION_OBSERVABILITY_GAP.json` 明确显示 candidate、notification、hourly scorecard、score outcome 尚无生产 canonical writer；本轮只审计，不修复。
- `npx tsc --noEmit` 的 8 个错误是前序 dirty worktree 中的既有类型/target 问题，未在本轮扩大或修复。
- 标准 `git diff` 默认不包含未跟踪文件；本 packet 已完整列出 untracked files，patch 文件严格按用户指定命令生成，未强行 stage 或 commit。

## BLOCKERS

当前 TASK-007D 验收 blocker：`[]`。

后续若要获得真实 EAP，需要 production-side permission observer/ledger adapter；这是 TASK-007E 的授权前提，不是本轮隐式授权。

## APPROVAL_REQUIRED

等待 ChatGPT Reviewer 检查本 packet。未经下一轮明确授权，不执行：

- 长驻 shadow collector；
- production event identity、permission、candidate、notification、score、outcome writer；
- `/opt` 部署、systemd 操作、Bark/order 接线；
- threshold/model/promotion；
- chunk002 访问；
- snapshot、`first_detected_at`、`event_id` 或 immutable Forward evidence 的任何重写/删除。

## RECOMMENDED_NEXT_TASK

优先由 ChatGPT Reviewer 决定是否进入 TASK-007E。若批准 long-run shadow，需明确真实 EAP observer、运行时长、shadow root、磁盘投影门限及以下入口脚本的参数：

`scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts`

若 Reviewer 提出修复任务，下一轮先完成修复并重新生成本 packet，不跳到后续 TASK。

CODEX_READY_FOR_CHATGPT_REVIEW
