[RESULT FAST-DETACH-V2-TASK-PR15-SECOND-FINAL-AUDIT-REPAIR]

# CODEX REVIEW PACKET — ASTPS FAST-DETACH PR #15 SECOND FINAL AUDIT REPAIR

TASK_ID=ASTPS_FAST_DETACH_PR15_SECOND_FINAL_AUDIT_REPAIR
STATUS=CHANGES_REQUIRED_PENDING_REVIEW
READY_FOR_FINAL_AUDIT=false
PROMOTION_DECISION=DO_NOT_PROMOTE
STARTED_AT=2026-09-26T14:55:00+08:00
FINISHED_AT=2026-09-26T16:01:00+08:00
COMMIT_SHA=14b1376
BRANCH=codex/astps-fast-detach-handoff-20260926
PR=https://github.com/alex43github/trade-workbench/pull/15
MERGED=false
DEPLOYED=false

SUMMARY=
继续同一 PR #15 修复 ChatGPT SECOND FINAL AUDIT 的 P0/P1 项，没有新开研究线、没有 merge、deploy、Promotion 或生产接线。`calculateEapSeparatedMetrics()` 现在明确拆分 immutable EDP window 与 immutable EAP window：EDP MFE/MAE 包含 EDP→EAP 路径，EAP MFE/MAE 不包含 EAP 之前路径；新增的“前段大涨/大跌、后段小波动”测试先在旧实现上失败，再在最小实现后通过。重新读取 Drive canonical parent/file/revision，确认 exact MODEL_REGISTRY.json 存在，生成了逐文件 machine-readable pending-writeback manifest，但本轮保持 Drive read-only。全 repository 与 canonical model 的 execution-permission 审计没有发现真实可审计 permission source，因此明确 `PRODUCTION_HAS_NO_AUDITABLE_EXECUTION_PERMISSION_SOURCE=true`，不启动 persistent collector，不伪造 LIVE EAP。按冻结 Task-001/002B/003/004 generator 在隔离 `/tmp` 尝试生成 chunk002：得到 50 行 task-001 schema、source SHA valid、0 duplicate IDs、0 leakage，但不是要求的 `fast-detach-v2-unified-event-2`，因此严格标为 DATA_BLOCKED，六个 Primary hypotheses 继续 INSUFFICIENT，未调参、未改 prereg。

CHANGED_FILES=
本轮实质 commit `14b1376` 的 16 个文件，以及本 Review Packet 的 2 个审计文件。PR #15 既有文件未在本轮重复改写。

| File | 修改目的 / 核心逻辑 | 是否影响 Production | 是否影响 threshold/model/Bark/order path |
|---|---|---|---|
| `EAP_SOURCE_AUDIT.md` | 补充全仓库与 Drive canonical source audit，明确无真实 permission source，candidate/shadow 不计入 LIVE EAP。 | 否，审计文档 | 否 |
| `change-logs/ASTPS_CODEX_AUTONOMOUS_STATUS.md` | 更新本轮 gate、Drive IDs/revisions、permission-source flag、chunk002 DATA_BLOCKED 与测试结果。 | 否 | 否 |
| `change-logs/ASTPS_FAST_DETACH_FINAL_AUDIT_MANIFEST.json` | 更新 final gate、两窗口语义、Drive exact IDs、generation attempt、source audit、invariants 与 blockers。 | 否 | 否 |
| `change-logs/ASTPS_FAST_DETACH_PERMISSION_SOURCE_AUDIT.json` | 新增 machine-readable 全仓库/Drive execution-permission audit。 | 否 | 否 |
| `change-logs/CHUNK002_SOURCE_MANIFEST.json` | 记录 frozen source、prereg 顺序及同 schema generation attempt。 | 否 | 否 |
| `change-logs/CHUNK002_TEMPORAL_OOS_AUDIT.json` | 保留六项 INSUFFICIENT，并附 DATA_BLOCKED generation evidence。 | 否 | 否；未调参 |
| `change-logs/CHUNK002_UNIFIED_GENERATION_ATTEMPT.json` | 新增 exact source/table/date-range/field mismatch、输出 SHA 与隔离路径。 | 否 | 否 |
| `change-logs/DRIVE_PENDING_WRITEBACK_MANIFEST.json` | 新增逐 canonical file 的 ID、mtime、revision、精确 patch/append payload、Git source commit 与未写原因。 | 否；未写 Drive | MODEL_REGISTRY 明确 NO_WRITE |
| `docs/research/ASTPS_FAST_DETACH_CHUNK002_TEMPORAL_OOS.md` | 记录实际 frozen generator 尝试及 unified schema DATA_BLOCKED 结论。 | 否 | 否 |
| `docs/research/ASTPS_FAST_DETACH_FINAL_ENGINEERING_REPORT.md` | 更新两窗口实现、Drive 正确解析、source audit、chunk002 attempt、测试与 gate。 | 否 | 否 |
| `docs/research/ASTPS_FAST_DETACH_FINAL_RESEARCH_REPORT.md` | 更新 canonical Drive、no-source、candidate/shadow boundary 与 OOS disposition。 | 否 | 否 |
| `docs/research/ASTPS_FAST_DETACH_PROMOTION_RECOMMENDATION.md` | 继续 DO_NOT_PROMOTE，反映 exact Drive resolution 与无权限源。 | 否 | 明确不改 |
| `docs/research/DRIVE_WRITEBACK_PENDING.md` | 修正 canonical parent/file IDs，确认 registry 存在，链接 pending manifest。 | 否；未写 Drive | 否 |
| `docs/superpowers/plans/2026-09-26-astps-fast-detach-pr15-second-final-audit-repair.md` | 本轮审计修复计划与验收标准。 | 否 | 否 |
| `services/structure-radar/research/task-007d-eap.ts` | 分离 EDP/EAP causal windows，并保留 immutable EDP timestamp contract。 | 否；research-only，未接生产 | 否 |
| `tests/fast-detach-task-007d.test.mjs` | 新增窗口隔离回归：前段大幅波动只进入 EDP MFE/MAE。 | 否 | 否 |
| `change-logs/CODEX_REVIEW_PACKET_LATEST.md` | 本轮可审计 handoff packet，停止于 approval gate。 | 否 | 否 |
| `change-logs/CODEX_REVIEW_PACKET_LATEST.patch` | 本轮完整 Git diff 审计补丁；由 packet 完成后生成。 | 否 | 否 |

TEST_RESULTS=
- TDD red proof: 旧实现运行 `npx tsx --test tests/fast-detach-task-007d.test.mjs` 为 15 pass / 1 fail；失败断言证明旧实现无法把 EDP→EAP 前段纳入 EDP MFE。
- Focused: `npx tsx --test tests/fast-detach-task-007.test.mjs tests/fast-detach-task-007b.test.mjs tests/fast-detach-task-007c.test.mjs tests/fast-detach-task-007d.test.mjs`；39 total / 39 pass / 0 fail / 0 skip。
- Related regression: `npm run radar:test`；88 total / 87 pass / 0 fail / 1 environment skip（loopback listener 被当前执行环境禁止）。
- Repository build: `npm run build` phase within `npm test` PASS。
- Full repository test: `npm test` exit 1；1096 total / 988 pass / 107 fail / 1 skip。失败保持如实记录，集中在既有 live-exchange/Bybit/trade/UI baseline，不作为 PASS。
- Typecheck: `npx tsc --noEmit` exit 2；31 个既有 app/lib TypeScript errors；重新筛查无 `task-007`、`task007` 或 `fast-detach` error。
- JSON validation: 7 machine-readable files parse successfully，包括 final manifest、source manifest、OOS audit、permission audit、generation attempt、Drive pending manifest、PRE_CHUNK002_PREREG。
- `git diff --check`：最终 packet 与 patch 生成后 PASS；`git status --short` 已复核且仅包含本轮 review artifacts 的待提交变更。
- Fast-Detach Python regression：checked-out repository 没有对应 Python regression runner；已明确标为 UNAVAILABLE，未将 unavailable 当作 PASS。

DATA_INVARIANTS=
FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
TRANSITION_MUTATION_COUNT=0
HISTORICAL_SHA_BEFORE=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_SHA_AFTER=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_FROZEN_UNCHANGED=true
FORWARD_EPOCH_MUTATION_COUNT=0
FORWARD_EPOCH_UNCHANGED=true

PRODUCTION_SIDE_EFFECTS=
CHUNK002_ACCESSED=true
CHUNK002_ACCESS_ORDER=after PRE_CHUNK002_PREREG commit 8e13298; current generation output stayed in isolated /tmp
PRODUCTION_HAS_NO_AUDITABLE_EXECUTION_PERMISSION_SOURCE=true
REAL_LIVE_EAP_SOURCE_FOUND=false
REAL_EAP_OBSERVER_CONNECTED=false
PERSISTENT_SHADOW_COLLECTOR_STARTED=false
PROSPECTIVE_EAP_COHORT_FORMED=false
DRIVE_WRITEBACK_PERFORMED=false
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false
THRESHOLD_CHANGED=false
BARK_CHANGED=false
ORDER_PATH_CHANGED=false
DEPLOYED=false
MERGED=false
SYNTHETIC_LIVE_EAP_EVENTS_CREATED=0
SNAPSHOT_REWRITTEN=false
FIRST_DETECTED_AT_REWRITTEN=false
EVENT_ID_REWRITTEN=false

KNOWN_LIMITATIONS=
- Real execution-permission semantics/source are absent from the audited repository and canonical Drive model; historical 177 LIVE_FORWARD events remain EAP_NOT_OBSERVED.
- Persistent collector is intentionally not started before a real permission source is established; prospective EAP N=0 and execution-level statistics are not established.
- Frozen generator successfully rebuilt a task-001-shaped chunk002, but no frozen adapter/source table produced `fast-detach-v2-unified-event-2`; exact missing sections and unavailable 5m/derivatives payloads are in the generation-attempt manifest.
- Drive exact files and current revisions are known, but no writeback was performed. `MODEL_REGISTRY.json` was not absent and no replacement was created; its pending operation is explicit NO_WRITE to protect the production registry.
- Fast-Detach Python regression runner is unavailable in the checked-out repository and is not treated as PASS.
- Existing repository baseline test/typecheck failures remain outside this research-only repair.

BLOCKERS=
[
  "PRODUCTION_HAS_NO_AUDITABLE_EXECUTION_PERMISSION_SOURCE",
  "REAL_EAP_OBSERVER_NOT_CONNECTED",
  "PERSISTENT_SHADOW_COLLECTOR_NOT_STARTED",
  "PROSPECTIVE_EAP_COHORT_ZERO",
  "CHUNK002_GENERATION_NOT_FAST_DETACH_V2_UNIFIED_EVENT_2",
  "CHUNK002_TEMPORAL_OOS_NOT_COMPLETED",
  "DRIVE_WRITEBACK_NOT_PERFORMED_READ_ONLY_RECONCILIATION",
  "FAST_DETACH_PYTHON_REGRESSION_UNAVAILABLE",
  "REPOSITORY_BASELINE_TEST_AND_TYPECHECK_FAILURES_OUTSIDE_SCOPE"
]

APPROVAL_REQUIRED=
ChatGPT Reviewer must inspect the two immutable causal windows, the new regression, the exact canonical Drive resolution and pending manifest, the repository/Drive permission-source audit, and the isolated chunk002 generation DATA_BLOCKED evidence. Do not merge, deploy, restart, promote, tune thresholds, change model/Bark/order behavior, start a collector without a real permission source, or fabricate LIVE EAP/OOS evidence. `READY_FOR_FINAL_AUDIT=false` remains required.

RECOMMENDED_NEXT_TASK=
Reviewer-directed fix only. If approved, the next task must first establish a real read-only immutable execution-permission source and then separately authorize a CANDIDATE_EAP/SHADOW_EAP Hypothesis → OOS → Forward cycle. Do not self-invent a research task or set READY_FOR_FINAL_AUDIT=true.
