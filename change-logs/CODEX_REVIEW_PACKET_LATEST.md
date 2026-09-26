[RESULT FAST-DETACH-V2-TASK-PR15-THIRD-FINAL-AUDIT-REPAIR]

# CODEX REVIEW PACKET — ASTPS FAST-DETACH PR #15 THIRD FINAL AUDIT REPAIR

TASK_ID=ASTPS_FAST_DETACH_PR15_THIRD_FINAL_AUDIT_REPAIR
STATUS=CHANGES_REQUIRED_PENDING_REVIEW
READY_FOR_FINAL_AUDIT=false
PROMOTION_DECISION=DO_NOT_PROMOTE
STARTED_AT=2026-09-26T16:45:37+08:00
FINISHED_AT=2026-09-26T16:50:34+08:00
CODE_REPAIR_COMMIT=f4793dfafd50ffd08f562893a106297522c85bb7
AUDIT_ARTIFACT_COMMIT=e36308f1079638dd1194f8a39e0fc574f760b051
PRIOR_AUDIT_EVIDENCE_COMMIT=b624779b82c092019bdc87509a9fc1a919e8f57e
BRANCH=codex/astps-fast-detach-handoff-20260926
PR=https://github.com/alex43github/trade-workbench/pull/15
MERGED=false
DEPLOYED=false

SUMMARY=
继续同一 PR #15，逐项处理 THIRD FINAL AUDIT 的剩余范围；没有新开研究线、没有 merge、deploy、Promotion 或生产接线。EDP/EAP 指标现在使用两个因果窗口，并要求 immutable execution_context.edp_price 与同一闭合观测的 execution_context.edp_utc 成对存在；采集器保留 first_detected_at_utc 作为检测器墙钟时间，不再把 decision-bar anchor_price 当作 EDP price。新增了 edp_utc 不得晚于检测时间、缺失 EDP timestamp fail-closed、以及 collector 冻结闭合观测时间的 focused regression。Production Final Action 语义与 runtime-lineage blocker、Drive canonical reconciliation、DATA_REGISTRY runtime-only DATA_BLOCKED 证据保持准确；没有伪造 LIVE EAP，没有启动 collector，没有修改 threshold/model/Bark/order path。

CHANGED_FILES=
以下是本轮新增/修订的全部文件；完整相对基线差异见 CODEX_REVIEW_PACKET_LATEST.patch。

| File | 修改目的 / 核心逻辑 | 是否影响 Production | 是否影响 threshold/model/Bark/order path |
|---|---|---|---|
| scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts | 新 snapshot 将 edp_price 与同一最新闭合观测 bar 的 edp_utc 一起冻结；first_detected_at_utc 保持检测时间；既有 snapshot 不回写。 | 否，shadow/research only | 否 |
| services/structure-radar/research/task-007c-shadow-state.ts | identity builder 支持显式 edpUtc，并拒绝未来于 detectedAtUtc 的 EDP timestamp。 | 否，shadow/research only | 否 |
| services/structure-radar/research/task-007d-eap.ts | 明确 EDP timestamp/price contract；EDP/EAP 窗口仍分离；EDP price 缺失或 timestamp 缺失 fail-closed。 | 否，未接生产 observer | 否 |
| tests/fast-detach-task-007c.test.mjs | 验证闭合 EDP price/time freeze、未来 EDP timestamp 拒绝、collector snapshot contract。 | 否 | 否 |
| tests/fast-detach-task-007d.test.mjs | 验证 EDP/EAP excursion window、later-bar EDP latency、缺失 price/timestamp fail-closed。 | 否 | 否 |
| EAP_SOURCE_AUDIT.md | 记录 Final Action 语义存在但没有到 immutable permission ledger 的 runtime lineage。 | 否，审计证据 | 否 |
| change-logs/ASTPS_CODEX_AUTONOMOUS_STATUS.md | 更新本轮 commit、gate、invariants 与测试结果。 | 否 | 否 |
| change-logs/ASTPS_FAST_DETACH_FINAL_AUDIT_MANIFEST.json | 更新第三审计 manifest、EDP price contract、DATA_BLOCKED、Drive IDs、invariants、tests 与 blockers。 | 否 | 否 |
| change-logs/ASTPS_FAST_DETACH_PERMISSION_SOURCE_AUDIT.json | 记录 canonical Final Action vocabulary、runtime lineage 检查与精确实现缺口。 | 否 | 否 |
| change-logs/CHUNK002_SOURCE_MANIFEST.json | 保留 prereg-before-read、canonical source exists/runtime inaccessible 的证据。 | 否 | 否，未调参 |
| change-logs/CHUNK002_TEMPORAL_OOS_AUDIT.json | 保留六项 hypotheses INSUFFICIENT 与 same-pipeline DATA_BLOCKED 结论。 | 否 | 否，未调参 |
| change-logs/CHUNK002_UNIFIED_GENERATION_ATTEMPT.json | 区分 canonical 5m master 存在与 frozen generator runtime 不可用，并记录 exact next materialization step。 | 否 | 否 |
| change-logs/DRIVE_PENDING_WRITEBACK_MANIFEST.json | 逐 canonical file 记录 Drive ID、mtime、revision、exact payload/NO_WRITE、source commit 与未写原因。 | 否，未写 Drive | 否 |
| docs/research/ASTPS_FAST_DETACH_FINAL_ENGINEERING_REPORT.md | 更新第三审计修复、EDP pair contract、gate、tests 与 safety invariants。 | 否 | 否 |
| docs/research/ASTPS_FAST_DETACH_FINAL_RESEARCH_REPORT.md | 更新 Drive、DATA_REGISTRY、EAP lineage 与 OOS disposition。 | 否 | 否 |
| docs/research/ASTPS_FAST_DETACH_PROMOTION_RECOMMENDATION.md | 保持 DO_NOT_PROMOTE，明确 lineage/data blockers。 | 否 | 明确不改 |
| docs/research/DRIVE_WRITEBACK_PENDING.md | 修正 canonical parent/file resolution 并链接完整 pending manifest。 | 否，未写 Drive | 否 |
| docs/superpowers/plans/2026-09-26-astps-fast-detach-pr15-second-final-audit-repair.md | 纠正旧计划中的过宽 permission-source wording，保留历史计划可读性。 | 否 | 否 |
| docs/superpowers/plans/2026-09-26-astps-fast-detach-pr15-third-final-audit-repair.md | 记录本轮目标、约束、TDD 与验收标准。 | 否 | 否 |
| change-logs/CODEX_REVIEW_PACKET_LATEST.md | 本轮可审计 handoff packet，停在 ChatGPT approval gate。 | 否 | 否 |
| change-logs/CODEX_REVIEW_PACKET_LATEST.patch | 由完成后的 Git diff 生成，供 reviewer 审查。 | 否 | 否 |

TEST_RESULTS=
- Focused TASK-007/007B/007C/007D: npx tsx --test tests/fast-detach-task-007.test.mjs tests/fast-detach-task-007b.test.mjs tests/fast-detach-task-007c.test.mjs tests/fast-detach-task-007d.test.mjs；41 total / 41 pass / 0 fail / 0 skip。
- Final focused smoke used the identical command; two sandbox tsx IPC-pipe attempts returned environment EPERM, then the same command passed with the permitted escalation. No assertion failure occurred。
- Related radar regression: npm run radar:test；88 total / 87 pass / 0 fail / 1 environment skip，skip 为当前环境禁止 loopback listener。
- Repository build: npm run build；PASS。
- Full repository suite: npm test；exit 1，1098 total / 1010 pass / 88 fail / 0 skip；build phase PASS。失败如实保留为既有 live-exchange/Bybit/trade/UI baseline，不作为 PASS，也未弱化测试。
- Typecheck: npx tsc --noEmit；exit 2，31 个既有 app/lib errors；没有 TASK-007/007B/007C/007D scope errors。
- Fast-Detach Python regression: checked-out repository 没有对应 runner，UNAVAILABLE_IN_CHECKED_OUT_REPOSITORY；未将 unavailable 当作 PASS。
- JSON validation: final audit manifest、permission audit、chunk002 source/OOS/generation manifests、Drive pending manifest、PRE_CHUNK002_PREREG 共 7 个 machine-readable files parse successfully。
- git diff --check: PASS。
- git status --short: packet/patch commit 后应为空；提交前只包含本轮 packet/patch 与 final manifest 的待提交变更。

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
UNIFIED_VIEW_TOTAL_EVENTS=227
HISTORICAL_EVENTS=50
LIVE_FORWARD_DISCOVERY_EVENTS=177
LIVE_FORWARD_EAP_EVENTS=0
REAL_LIVE_EAP_SOURCE_FOUND=false
PRODUCTION_EXECUTION_PERMISSION_SEMANTICS_FOUND=true
NO_AUDITABLE_RUNTIME_LINEAGE_FROM_PRODUCTION_FINAL_ACTION_TO_IMMUTABLE_PERMISSION_LEDGER=true

PRODUCTION_SIDE_EFFECTS=
CHUNK002_ACCESSED=true
CHUNK002_ACCESS_NOTE=existing authorized read occurred only after PRE_CHUNK002_PREREG commit 8e13298; this repair did not reread or regenerate chunk002
DRIVE_WRITEBACK_PERFORMED=false
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false
THRESHOLD_CHANGED=false
BARK_CHANGED=false
ORDER_PATH_CHANGED=false
SNAPSHOT_REWRITTEN=false
FIRST_DETECTED_AT_REWRITTEN=false
EVENT_ID_REWRITTEN=false
SYNTHETIC_LIVE_EAP_EVENTS_CREATED=0
PERSISTENT_SHADOW_COLLECTOR_STARTED=false
PROSPECTIVE_EAP_COHORT_FORMED=false
MERGED=false
DEPLOYED=false

KNOWN_LIMITATIONS=
- Canonical Production Final Action vocabulary exists, but no auditable runtime lineage was found that emits immutable GRANTED/DENIED/UNKNOWN decisions, persists source identity/payload hash, and joins them to Task-007 event_id.
- Historical 177 LIVE_FORWARD records remain EAP_NOT_OBSERVED; no prospective EAP denominator or execution-level statistics exist.
- Persistent shadow collector remains intentionally stopped until the real permission source/lineage is resolved.
- Canonical metrics_5m_all_fixed.csv.gz exists in ChatGPT File Library, but the authorized VPS/Codex generator runtime could not materialize it together with frozen Task-002B path/barrier inputs; same-pipeline chunk002 remains DATA_BLOCKED, not globally missing.
- Drive canonical files were re-resolved read-only. No writeback was performed; the exact pending append/NO_WRITE payloads and revision guards are recorded in DRIVE_PENDING_WRITEBACK_MANIFEST.json.
- Fast-Detach Python regression runner is absent from this checkout.
- Repository-wide baseline failures and typecheck errors remain outside this research-only repair.

BLOCKERS=
[
  "NO_AUDITABLE_RUNTIME_LINEAGE_FROM_PRODUCTION_FINAL_ACTION_TO_IMMUTABLE_PERMISSION_LEDGER",
  "REAL_EAP_OBSERVER_NOT_CONNECTED",
  "PERSISTENT_SHADOW_COLLECTOR_NOT_RUNNING_OR_STABLE",
  "PROSPECTIVE_EAP_COHORT_ZERO",
  "CHUNK002_TEMPORAL_OOS_NOT_COMPLETED_DATA_BLOCKED",
  "DRIVE_WRITEBACK_NOT_PERFORMED_READ_ONLY_FORMALLY_RECONCILED",
  "FAST_DETACH_PYTHON_REGRESSION_UNAVAILABLE",
  "REPOSITORY_BASELINE_TEST_FAILURES",
  "TYPECHECK_BASELINE_ERRORS"
]

APPROVAL_REQUIRED=
ChatGPT Reviewer must inspect the immutable EDP timestamp/price pair, separate EDP/EAP windows, later-bar and fail-closed tests, exact Drive pending manifest, canonical DATA_REGISTRY reconciliation, and the Final Action runtime-lineage audit. Keep READY_FOR_FINAL_AUDIT=false and DO_NOT_PROMOTE. Do not merge, deploy, restart, write Drive, start a persistent collector without a real permission source, fabricate LIVE EAP, tune thresholds, change model/Bark/order behavior, or access chunk002 again in this repair.

RECOMMENDED_NEXT_TASK=
Reviewer-directed fix only. If approved, the next task must first establish a read-only auditable Production Final Action to immutable permission-ledger lineage; only then may a separately labeled CANDIDATE_EAP/SHADOW_EAP Hypothesis to OOS to Forward cycle be authorized. Do not self-invent the next research task.

CODEX_READY_FOR_CHATGPT_REVIEW
