# ASTPS / FAST-DETACH — Codex 全量接管 Handoff

**版本：2026-09-26 v1.0**  
**仓库：** `alex43github/trade-workbench`  
**项目：** Adaptive Smooth Trend & Persistent Squeeze / Monster Squeeze + FAST-DETACH V2  
**执行方式：** 从现在开始由 Codex 独立连续推进；ChatGPT 不再参与小时级任务路由。Codex 完成全部阶段后，再交给 ChatGPT 做一次最终审计。

## 0. 操作模式

此前 ChatGPT → GitHub Issue → Bridge → Codex 的小时级编排链已经取消。

- Issue #12 只保留为历史审计证据，不再作为调度器。
- `BRIDGE-MULTI-ISSUE-ROUTER-001` 不再继续。
- Codex 不需要等待 ChatGPT 每小时 `[TASK]/[REVIEW]`。
- 按本文连续推进，除真正 human-only blocker 外不要停。
- 每阶段必须留下 Git commit、测试、数据不变量和状态。
- 最终到 `READY_FOR_FINAL_AUDIT=true` 后停止，不 merge、不 Promotion，等待 ChatGPT 审计。

## 1. 最终目标

1. **更早发现**：建立真实 EDP，研究 5m/15m ignition、reclaim、second test、Higher Floor、PE transition、Price×OI 等能否比现有 Broad/Deep/1H 提前 15m/30m/1H/3H。
2. **更早执行**：建立真实 EAP。EAP 必须来自真实 Execution Permission，不得由 RECLAIM / PLATFORM_RECLAIM / Deep / Family / Score 名称推断。
3. **资金效率**：持续评估 EDP→EAP delay、MissedConvexity、Time-to-Positive、MFE/MAE、+5/+8/+10/+15/+20 TTP、NormalMAE、Severe Failure、time-underwater、capital occupancy、capital efficiency。
4. **完整晋级链**：`LIVE_GROWTH_LOG → Research Queue → Historical Replay → A/B → temporal OOS → cross-symbol OOS → Candidate → Forward → Promotion Recommendation → 最终人工审计`。

## 2. 总体架构

### A. Data Foundation
1H/15m/5m closed-bar；OI/Funding/Top Trader/Global L/S/Taker；freshness/DataGap。  
硬规则：UTC；missing 不插值/不补0；5m derivatives 仅 `metrics_present==1`；Funding 不 forward-fill；`mark_price<=0` 不做派生；不得冒充 canonical 1m。

### B. Discovery
High Recall：Broad Sweep、5m/15m ignition/reclaim/second test、Higher Floor、PE transition、Price×OI、Funding/positioning/taker/relative strength。  
**进入候选 ≠ 可以交易。**

### C. State / Family / Mechanism
Smooth Persistent Trend、Monster/Structural Convexity、Short/Long Squeeze、Re-Ignition、Pulse/Fragile、Terminal、Reset/Reclaim/Second Test。用于分层、解释、风险，不机械 hard gate。

### D. Execution Permission
EAP 唯一来源。Price Structure 继续作为 Capital-Efficiency 核心：structure acceptance、reclaim quality、second test、Higher Floor、ExtensionATR、MA30/ATR、execution-too-deep、chase/reset/wait。

### E. Failure Cost / Risk
NormalMAE、Severe Failure、pulse/blow-off/terminal、adverse path、time-underwater、failed reclaim。

### F. Evidence Ledger
Append-only：
- `LIVE_EVENT_SNAPSHOT`
- `LIVE_EVENT_TRANSITION`
- `LIVE_EVENT_OUTCOME`
- `UNIFIED_RESEARCH_VIEW`
- `LIVE_FORWARD_EPOCH`

EDP snapshot 不得被 EAP/outcome 覆盖。

### G. Historical Replay / OOS
严格分开：`HISTORICAL_REPLAY` / `LIVE_FORWARD` / `REPLAY_EAP` / prospective LIVE EAP。Denominator 永不混用。

### H. Production Observability
必须追踪：`Scan → Broad Candidate → Event → Deep → Score Snapshot → Notification → Outcome`。Heartbeat 不能替代 candidate/event/notification/outcome ledger。

## 3. 当前已知基线（接手后必须重新验证）

### Historical
`chunk001 SHA = de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e`

- Historical events = 50
- chunk001 必须 frozen
- 007 系列此前未用 chunk002 证明结论

### TASK-007C
Forward epoch：`epoch-20260924T185000`

- LIVE_FORWARD_EVENTS = 177
- HISTORICAL_EVENTS = 50
- UNIFIED_VIEW_TOTAL_EVENTS = 227
- snapshots = 177
- transitions = 185
- outcomes = 1064
- 15m/30m/1H/3H/6H/12H mature N = 177
- 24H mature N = 2
- 48H 当时 = 0
- leakage / duplicate / mutation = 0

ETHUSDT：
- `event_id=d52a8c...c88d7b`
- EDP `2026-09-24T12:59:59.999Z`
- anchor `2647.6`
- snapshot SHA `5ed537ac52495fc3029be06429a45591da169c002c0a13bd85e4a5ce55838010`

TRXUSDT：
- `event_id=b4c0b9...86bc553`
- EDP `2026-09-24T12:59:59.999Z`
- anchor `0.34003`
- snapshot SHA `c80b0646c712f711b5122002bba8321d38ec155f3399ce9af86245543e3fdf24`

### 007D 当前关键结论
- `LIVE_EAP_OBSERVED_N=0`
- `LIVE_EAP_CONFIRMED_ABSENT_N=0`
- `LIVE_EAP_NOT_OBSERVED_N=177`
- 根因方向：`OBSERVER_NOT_CONNECTED`

**禁止把 EAP=0 解读成 177 个事件都没有执行许可。**

旧 review SHA：`c5446abdcac204e87d71bf5c3cd8d4f841017950`。该 branch 与 main 无 common ancestor，不能作为最终 baseline。

已知 P0：
1. EAP decision bar 必须允许晚于 EDP：`eap_decision_bar >= edp_decision_bar` 且 `eap_decision_bar <= eap_time`；EAP causal evidence 不得晚于 EAP decision boundary。
2. EAP 6H denominator 不能写死为0。拆分 `DISCOVERY_SAMPLE_QUALITY_6H` 与 `EAP_SAMPLE_QUALITY_6H`。

## 4. Google Drive / Research Governance

`Google Drive / Trading-System` 仍是唯一 shared fact source。每重大阶段开始前重新读取 canonical；与本文冲突时 **Drive 胜出**。

必读：
- `00_CURRENT/MODEL_CURRENT.md/json`
- `00_CURRENT/RESEARCH_STATE.md`
- `00_CURRENT/WORKBENCH_SPEC.md`
- `01_LIVE/LIVE_CASES.jsonl`
- `01_LIVE/LIVE_OUTCOMES.jsonl`
- `01_LIVE/LIVE_HYPOTHESES.md`
- `01_LIVE/LIVE_GROWTH_LOG.md`
- `01_LIVE/DAILY_MARKET_REVIEW.md`
- `02_RESEARCH/CURRENT_CANDIDATE_MODEL.md`
- `02_RESEARCH/REGRESSION_RESULTS.md`
- `02_RESEARCH/REJECTED_RULES.md`
- `02_RESEARCH/RESEARCH_QUEUE.md/json`
- `03_MODEL_REGISTRY/MODEL_REGISTRY.json`
- `03_MODEL_REGISTRY/CHANGELOG.md`
- `04_DATA/DATA_REGISTRY.md`

规则：
- existing canonical Markdown/JSON 只能 update-in-place，同 file ID；
- Prediction Snapshot 不可覆盖；
- Promotion 前不更新 MODEL_CURRENT；
- 若无法安全写 Drive，生成 `DRIVE_WRITEBACK_PENDING.md/json`，写清 exact target + intended patch + source commit，不得伪造“已同步”。

## 5. Codex 自主执行路线图

### PHASE 1 — 重建干净 007D baseline
- 从 current `origin/main` 建真实 ancestry branch/worktree；
- `git merge-base origin/main HEAD` 必须有效；
- 只带 TASK-007/007B/007C/007D research/shadow 文件；
- 修复 later-bar EAP semantics；
- 修复动态 EAP denominator；
- tests：later-bar PASS / EAP-before-EDP FAIL / future-evidence FAIL / EAP denominator fixture；
- 重跑 TASK007/007B/007C/007D、Fast-Detach Python regression、Radar regression、typecheck、`git diff --check`。

完成：`PHASE1_007D_REVIEW_BASELINE=PASS`

### PHASE 2 — 持久化 Forward Epoch
授权建立 `/var/lib/trade-workbench/research/forward-shadow/`。
- COPY，不 MOVE；
- `/tmp` 原证据保留；
- copy 前后 size/rows/SHA；
- byte-for-byte SHA match；
- 不重写 snapshot/event_id/first_detected_at；
- 不把 outcome merge 回 snapshot。

完成：
`PERSISTENT_FORWARD_EPOCH_READY=true`
`PERSISTENT_COPY_SHA_MATCH=true`
`SOURCE_TMP_PRESERVED=true`

### PHASE 3 — 接通真实 EAP Observer
追踪：`Detection → State → Execution Evaluation → Execution Permission → Recommendation / Order Permission`

EAP schema 至少：
`event_id, eap_time_utc, decision_bar_close_utc, eap_price, permission_type, permission_version, source_decision_id, source_cycle_id, causal_evidence, data_gaps, permission_payload_sha256`

分类：
- EAP_OBSERVED
- EAP_CONFIRMED_ABSENT
- EAP_NOT_OBSERVED
- REPLAY_EAP

旧 177 events 若没有 immutable permission log，不能回填 LIVE EAP。Replay 只能标 `REPLAY_EAP`。

完成：`EAP_OBSERVER_CONNECTED=true`

### PHASE 4 — Production Observability
只修审计/持久化，不改变交易判断。

建立：`Scan → Broad Candidate Ledger → Event Ledger → Deep Ledger → Score Snapshot → Notification Ledger → Outcome Ledger`

能区分：
MISSED_FALSE_NEGATIVE / DETECTED_BUT_DOWNGRADED / DETECTED_BUT_NOT_NOTIFIED / CANDIDATE_PIPELINE_GAP / SECOND_CHANCE_MISSED / COVERAGE_UNKNOWN

Writer 失败不能重触发扫描，也不能改变 decision。

完成：`PRODUCTION_OBSERVABILITY_CHAIN=PASS`

### PHASE 5 — Persistent Shadow Forward Collector
EAP observer + persistence 通过后启动常驻 shadow collector，可建立独立 shadow systemd service。
允许：写 research forward-shadow、电脑离线继续、自动 mature 15m/30m/1H/3H/6H/12H/24H/48H。
禁止：orders、Bark behavior change、threshold change、Production promotion。
所有自然事件都进 denominator，包括 losers/flat/no-EAP/slow/false positives。
目标：至少 20–30 个 prospective `EAP_OBSERVED` 后做 execution-level 统计，并有足够 6H maturity。

### PHASE 6 — Discovery Forward Audit
对现有 177 events 做 EDP-only descriptive analysis。
按 timeframe/setup/family/mechanism/discovery channel/state 分层，统计 median return、positive-return rate、MFE/MAE、+5/+8/+10/+15/+20 hit、TTP、TimeToPositive、max time underwater、NormalMAE、SevereFailure。
若算 PF，必须命名 `DIAGNOSTIC_OVERLAPPING_EVENT_PF`。
不得据此调 threshold。

### PHASE 7 — EDP→EAP 资本效率
prospective EAP 足够后计算 EDP→EAP minutes、price expansion、MissedConvexity、MFE/MAE from EDP/EAP、TimeToPositive from EAP、capital occupancy、capital efficiency。
重点研究：Detection 很早但 EAP 太晚、可否安全前移、哪些变量只适合 ranking、Execution Too Deep、Second Test/Reclaim/Higher Floor 对 MissedConvexity 的影响。

### PHASE 8 — chunk002 独立 OOS
本 handoff 授权 **在 prereg freeze 后**首次访问 chunk002，仅用于 temporal OOS。
访问前生成 `PRE_CHUNK002_PREREG.md/json`，冻结 exact rules / denominators / metrics / failure criteria / prereg SHA。
禁止看结果后改阈值仍称 OOS。失败规则必须降级/reject/family-specific，并写 REGRESSION_RESULTS / REJECTED_RULES。

### PHASE 9 — Historical vs Live Forward
分 denominator：
HISTORICAL_REPLAY / LIVE_FORWARD_DISCOVERY / LIVE_FORWARD_EAP / REPLAY_EAP

比较 Detection Recall、Execution Precision、EDP/EAP、lead、MissedConvexity、1/3/6/12H MFE/MAE、TTP、NormalMAE、Severe Failure、time-underwater、capital efficiency。
同时列 supports / failures / counterexamples / Family boundaries。

### PHASE 10 — 吸收 LIVE_GROWTH_LOG
每阶段检查 RESEARCH_PRIORITY、REPEATED_LIVE_PATTERN、Research Handoff P0/P1。
重点：漏扫、晚扫、DETECTED_BUT_NOT_NOTIFIED、Second-Chance Miss、Broad阈值过紧、5m/15m detection弱、Deep hard gate、State/Family误判、Premature Exhaustion、Sticky failure、Reset/Reclaim/Second Test miss、Execution Too Deep、CE ranking distortion。
Live lesson 第一身份永远是 Hypothesis。

## 6. Candidate / Production Governance

Codex 可以生成 Candidate Rule、更新 research artifacts、做 OOS/Forward、生成 Promotion Recommendation。

最终 ChatGPT 审计前：
- 不实际 Promotion；
- 不改 MODEL_CURRENT；
- 不改 Production threshold/ranking/Bark/order semantics。

Behavior-neutral observability/persistence 可以开发验证，但必须证明不改变交易决策。

## 7. 永久数据不变量

每阶段保存：

```text
FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
HISTORICAL_CHUNK001_SHA_BEFORE=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_CHUNK001_SHA_AFTER=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_FROZEN_UNCHANGED=true
```

任何失败：立即 STOP，禁止继续研究结论或 Promotion。

## 8. Git / Worktree Discipline

- 不 reset/clean 用户 dirty work；
- isolated worktree/branch；
- 必须有真实 main ancestry；
- 不用 orphan branch；
- 每 phase 独立 commit；
- 不夹 unrelated dirty files；
- 不 force-push main；
- 最终建立 review branch/PR，但不 merge。

建议集成 branch：`codex/astps-fast-detach-handoff-20260926`

## 9. 最低测试矩阵

Protocol：event_id deterministic、replay/idempotence、collision hard fail、snapshot/outcome immutability、first-EAP immutability、REPLAY_EAP separation。  
Causality：feature timestamp <= decision boundary、EAP evidence <= EAP boundary、future evidence reject、closed-bar only。  
Persistence：restart recovery、SHA copy verification、append-only、no source deletion。  
Denominator：failed/no-EAP retained、dynamic EAP denominator、Discovery/EAP separation。  
Observability：writer failure 不 retrigger scan、不 alter decision、identity across sinks。  
Regression：Task006 Python、Task007/007B/007C/007D+、radar、targeted TS/typecheck、`git diff --check`。  
禁止删/弱化 test 换 PASS。

## 10. Production 安全边界

允许无人值守：
- research code/tests
- branch/worktree
- shadow collector
- persistent research storage
- audit/observability writers
- shadow systemd service
- Git commit/push/PR
- Drive research writeback（若可安全原地更新）

严禁：
- 真实下单
- 改 API trading permission
- 改 private key/wallet/order execution
- 改 Production threshold/ranking
- 改 Bark 交易建议语义
- 自动 Promotion
- 删除 evidence
- 重写 snapshot/event_id/first_detected_at
- 把 REPLAY_EAP 冒充 LIVE EAP
- 用 hindsight 构造 prospective record

## 11. 持续状态文件

维护 `change-logs/ASTPS_CODEX_AUTONOMOUS_STATUS.md`，每阶段追加：
`PHASE / STATUS / BASE_SHA / COMMIT_SHA / WORK_COMPLETED / TESTS / DATA_INVARIANTS / NEW_EVIDENCE_N / EAP_OBSERVED_N / OUTCOME_MATURITY / KNOWN_FAILURES / COUNTEREXAMPLES / BLOCKERS / NEXT_PHASE`

除 `BLOCKED_HUMAN_ACTION_REQUIRED` 外不要停。

## 12. 最终交付

生成：
1. `docs/research/ASTPS_FAST_DETACH_FINAL_ENGINEERING_REPORT.md`
2. `docs/research/ASTPS_FAST_DETACH_FINAL_RESEARCH_REPORT.md`
3. `docs/research/ASTPS_FAST_DETACH_PROMOTION_RECOMMENDATION.md`
4. `change-logs/ASTPS_FAST_DETACH_FINAL_AUDIT_MANIFEST.json`

Promotion Recommendation 只能是：
PROMOTE_RECOMMENDED / HOLD_CANDIDATE / DEMOTE / REJECT

不实际修改 Production。

## 13. Final Stop Gate

只有满足以下才输出 `READY_FOR_FINAL_AUDIT=true`：

- clean 007D baseline PASS
- EAP observer connected
- persistent Forward store PASS
- Production observability PASS
- persistent collector stable
- prospective EAP cohort 已形成，或明确样本不足但 collector 正常
- chunk002 OOS 完成
- Historical vs Live comparison 完成
- Drive writeback 完成或完整 pending patches
- Promotion recommendation 完成
- no leakage/duplicate/mutation
- no unauthorized Production trading change
- final branch/commit/PR 可审计

最终 Codex 回复：

```text
ASTPS_FAST_DETACH_HANDOFF COMPLETE
STATUS=READY_FOR_FINAL_AUDIT
FINAL_BRANCH=
FINAL_COMMIT_SHA=
PR=
PHASE1_007D=
PERSISTENT_FORWARD=
EAP_OBSERVER=
PRODUCTION_OBSERVABILITY=
PERSISTENT_COLLECTOR=
HISTORICAL_OOS=
LIVE_FORWARD_ANALYSIS=
HISTORICAL_VS_LIVE=
DRIVE_WRITEBACK=
LIVE_FORWARD_EVENTS=
PROSPECTIVE_EAP_EVENTS=
MATURE_6H=
MATURE_24H=
MATURE_48H=
FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
HISTORICAL_FROZEN_UNCHANGED=true
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_TRADING_BEHAVIOR_CHANGED=false
PROMOTION_RECOMMENDATION=
KNOWN_BLOCKERS=
READY_FOR_FINAL_AUDIT=true
```

然后停止，不 merge、不 Promotion，等待 ChatGPT 最终审计。

## 14. 给 Codex 的启动指令

你现在接管 ASTPS / FAST-DETACH 主交易系统后续全部研究与工程工作。不要再等待 ChatGPT 的小时级 TASK/REVIEW。以本 handoff 为执行计划，但每阶段开始必须重新读取 Google Drive `Trading-System` canonical 状态，Drive 与 handoff 冲突时以 Drive 为准。先从 PHASE 1 开始：从真实 current main ancestry 重建 007D review baseline，修复 EAP later-bar semantics 和动态 EAP denominator；然后按 PHASE 2→10 连续推进。除真正 human-only blocker 外不要停止。每阶段必须 commit、测试、记录数据不变量和状态。允许建立 persistent shadow storage/service 与 behavior-neutral observability；严禁真实下单、Production threshold/Bark/order semantics 修改、自动 Promotion。chunk002 仅在 prereg freeze 后第一次访问并保持独立 OOS。完成全部阶段后生成 Final Engineering Report、Final Research Report、Promotion Recommendation、Final Audit Manifest，输出 `READY_FOR_FINAL_AUDIT=true` 后停止，等待 ChatGPT 最终审计。

## 五条不可破坏原则

1. **EDP ≠ EAP。**
2. **Discovery Recall 与 Execution Precision 分开。**
3. **Live Forward、Historical Replay、REPLAY_EAP 分 denominator。**
4. **新规则必须 Hypothesis → OOS → Forward，再谈 Promotion。**
5. **证据不可变性优先于“模型看起来更聪明”。**
