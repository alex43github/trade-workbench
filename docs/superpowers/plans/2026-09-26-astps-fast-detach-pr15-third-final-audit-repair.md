# PR #15 — THIRD FINAL AUDIT repair plan

## Goal

在现有 `codex/astps-fast-detach-handoff-20260926` 分支和 PR #15 内，逐项修复 THIRD FINAL AUDIT（review `5325149802`）指出的 P0/P1 问题；不新开研究线、不 merge、不 deploy、不 promotion，并保持 `READY_FOR_FINAL_AUDIT=false` 与 `PROMOTION_DECISION=DO_NOT_PROMOTE`。

## Constraints

- 不修改 Production model、threshold、Bark、order path 或生产服务。
- 不启动 persistent shadow collector，除非本轮能证明真实 Production permission source 与 immutable ledger lineage；本轮不伪造 LIVE EAP。
- 不修改 immutable snapshot、`first_detected_at`、`event_id`、历史 chunk 或 preregistration。
- 不访问或调参 chunk002；只更新已有 DATA_BLOCKED 证据，使其准确反映 canonical source 与运行时不可用边界。
- Drive 只读解析；pending writeback 必须是 machine-readable、revision-aware，不能创建 replacement。

## Work items

1. 读取并记录整个 repository 与 canonical Drive 的 Production Final Action 语义、生成路径、持久化路径和 event/decision key lineage；把结论从过强的 “no execution-permission source” 改为精确的 runtime-lineage blocker。
2. 先在 focused test 中冻结 immutable `edp_price` 与 immutable `edp_utc` 的同一 observation contract；拒绝使用 `anchor_price` 作为隐式 EDP price fallback；更新 shadow snapshot builder 仅对新 snapshot 捕获该字段。
3. 完成 Drive canonical metadata/revision 读取，补齐 `RESEARCH_STATE`、`REGRESSION_RESULTS`、`CURRENT_CANDIDATE_MODEL`、两个 `RESEARCH_QUEUE` 文件的 explicit `NO_WRITE`/pending payload；无规则拒绝时明确排除 `REJECTED_RULES.md`。
4. 根据 canonical `04_DATA/DATA_REGISTRY.md` 更新 chunk002 DATA_BLOCKED：说明 5m master 存在但当前 Codex/VPS runtime 未 materialize，列出下一步所需 materialization/path/barrier inputs；不把 runtime inaccessible 误报为 globally missing。
5. 更新 source audit、final manifest、engineering/research/promotion reports、status 与 Review Packet；所有时间改为真实证据或 commit-derived timestamp，移除未来/计划时间。
6. 运行 TDD focused tests、相关 radar regression、repository build/full test/typecheck、JSON checks、`git diff --check` 与 `git status --short`；生成 packet/patch，提交 immutable commits，push 到同一 PR，并发布结果评论后停止等待 ChatGPT 审计。

## Acceptance criteria

- EDP 与 EAP 窗口仍然分离；`MFE_FROM_EDP`/`MAE_FROM_EDP` 使用 immutable `edp_price`，覆盖 EDP→EAP 路径；EAP metrics 不看前段；missing `edp_price` fail-closed。
- `PRODUCTION_EXECUTION_PERMISSION_SEMANTICS_FOUND=true`，但 `NO_AUDITABLE_RUNTIME_LINEAGE_FROM_PRODUCTION_FINAL_ACTION_TO_IMMUTABLE_PERMISSION_LEDGER=true`；`REAL_LIVE_EAP_SOURCE_FOUND=false`、live EAP denominator 为 0。
- pending manifest 包含所有 reviewer 指定 canonical files、当前 modified time/revision、exact NO_WRITE 或 patch payload、source commit 与未写原因。
- DATA_REGISTRY 证据区分 canonical existence 与 authorized runtime availability；`chunk002` temporal OOS 仍未完成。
- 所有 production side-effect flags 为 false；`READY_FOR_FINAL_AUDIT=false`、`DO_NOT_PROMOTE`。
- Review Packet 完整、可审计、末尾为 `CODEX_READY_FOR_CHATGPT_REVIEW`。
