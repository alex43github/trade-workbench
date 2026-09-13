# REQ-20260908-concurrent-release-protocol

状态：VERIFIED_LOCAL  
创建时间：2026-09-08  
最后更新时间：2026-09-08  
是否部署到 VPS：否（本次是项目协作和发布流程文档变更）

## 用户原始要求

用户担心同时开多个对话从同一网站旧版本修改不同功能：对话 1 发布 v1.1 后，对话 2、3 仍基于 v1.0 完成并直接部署，可能覆盖已演进到 v2 的代码。用户要求明确如何避免代码过时、不兼容和冲突。

## 范围与验收标准

- 建立“独立开发、最新主线集成、单一发布”的并行开发规则；
- 明确任务分支不能直接部署，旧基线任务完成后必须 rebase/merge 最新 `main`；
- 规定可信发布基线、版本/commit/REQ 关联和 VPS 发布锁；
- 把规则写入项目提示词、日志模板、VPS handoff 和独立协议；
- 不修改业务代码、不建立真实 worktree、不执行 VPS 发布。

## 修改前基线

- 现有日志协议可记录需求、测试和部署，但没有强制记录开发基线、worktree、集成 commit 和发布串行化；
- `.worktrees/` 已被 `.gitignore` 忽略，适合后续任务隔离；
- 当前 `main` 工作区存在大量未提交改动，尚未确认与 VPS 版本一致，不能直接作为可信并行基线。

## 并行开发与集成

- 开发基线版本：未建立；本次需求正是定义建立方式。
- 开发基线 commit：未建立。
- 当前 main commit（开始时）：`99e374b`（但工作区不干净，不能当作 VPS 已发布版本）。
- 工作分支和 worktree：不适用；本次仅修改当前项目流程文档。
- 可能冲突的 REQ / 文件 / 数据契约：后续所有涉及 `main`、部署、数据库、Gateway、策略、timer 的 REQ。
- 最终集成 main commit：未提交。
- rebase/merge 结果：不适用。
- 语义冲突检查：确认协议禁止旧 worktree/旧任务分支直接覆盖 VPS，要求基于最新 `main` 做语义检查后才可发布。

## 实施计划

1. 新增独立并行开发与发布协议。
2. 将协议加入后续模型强制提示词和日志模板。
3. 在 VPS handoff 中建立入口链接。
4. 将本需求加入日志索引。

## 实际修改

- `CONCURRENT-DEVELOPMENT-PROTOCOL.md`
- `PROJECT-MODIFICATION-PROMPT.md`
- `VPS-HANDOFF.md`
- `change-logs/README.md`
- `change-logs/INDEX.md`
- `change-logs/REQ-20260908-concurrent-release-protocol.md`

## 本地验证

- `.worktrees/` 已由 `.gitignore` 忽略，符合后续 Git worktree 隔离要求。
- 文档规则要求每项任务记录基线版本/commit、worktree、最终集成 commit 和 VPS 发布证据。
- 本次仅文档/流程修改；未运行构建或业务测试。

## VPS 部署与线上验证

本次不涉及网站代码、服务配置或线上发布，不能标记为 `DEPLOYED_UNVERIFIED` 或 `VERIFIED_ON_VPS`。

## 当前状态

已建立并行开发、集成和发布协议。真正开始多个功能并行开发前，仍需先完成一次可信基线冻结：确认 VPS 版本，审查当前未提交改动，形成并验证单一 `main` release commit/tag。

## 剩余问题与下一步

- 用户若授权，可单独启动“基线冻结”任务：盘点本地与 VPS 差异、建立第一版发布 manifest/tag、验证 VPS，并将其记录为可供后续 worktree 使用的基线。
- 在基线冻结前，不要让多个任务对同一个当前工作区并行写入或直接部署。

## 时间线

- 2026-09-08：建立并行 worktree、最新主线集成、单一发布者和 VPS 发布锁规则。

