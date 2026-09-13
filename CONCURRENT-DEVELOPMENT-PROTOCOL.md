# Trade Workbench 并行开发、集成与发布协议

适用场景：多个 Codex 对话或开发者同时修改同一个 Trade Workbench 项目。

## 结论

基于 v1.0 的任务分支不能在 v2 已上线后直接部署。Git 能帮助合并文本，但不能自动判断“旧逻辑是否仍符合新接口、新数据库、新风控规则”。直接把旧工作目录或旧分支的文件同步到 VPS，可能会覆盖已经上线的功能，产生静默回退，或造成没有 Git 冲突但业务行为冲突的问题。

正确流程是：**隔离开发 → 重新基于最新主线集成 → 测试 → 单线程发布**。任务分支从不直接部署到 VPS。

```text
已发布版本 v1.1（唯一基线）
      ├── task/REQ-A  独立 worktree ─┐
      ├── task/REQ-B  独立 worktree ─┼─> rebase/merge 到最新 main
      └── task/REQ-C  独立 worktree ─┘          ↓
                                      集成测试 + 发布候选
                                                   ↓
                                    单一发布锁 → VPS v1.2
```

## 1. 三个唯一真实来源

必须同时维护以下三项，缺任何一项都不允许宣称“基于最新版本上线”：

| 名称 | 真实来源 | 作用 |
|---|---|---|
| 集成主线 | `main` 的明确 commit | 所有新任务最终要集成到的代码基线 |
| 已发布版本 | VPS 的发布 manifest + `APP_VERSION`/`BUILD_ID`（如已配置） | 明确线上实际运行的代码版本 |
| 需求审计 | `change-logs/INDEX.md` 和对应 REQ 日志 | 明确每项改动是否仅本地、已集成、已部署或已验证 |

`main` 只能由集成步骤更新；VPS 只能从一个已确定的 `main` commit 发布。禁止从任意任务 worktree、散落文件列表或未提交目录直接发布。

## 2. 先建立可信基线（当前阶段的必要前置）

当前工作区已有大量未提交改动，且尚未证明本地 `main` 与 VPS 完全一致。因此在正式并行开发前，必须先完成一次“基线冻结”：

1. SSH 检查 VPS 当前服务、发布目录和实际运行版本。
2. 审查本地未提交改动，确认哪些已上线、哪些只在本地、哪些应放弃或拆成需求日志。
3. 将确认需要保留的代码整合为一个可测试的 commit。
4. 为该 commit 创建明确发布标签，例如 `release/v1.0.0` 或 `v1.0.0`。
5. 将该 commit 部署到 VPS 并完整验证。
6. 在 VPS 记录不含密钥的发布 manifest，例如 `/opt/trade-workbench/RELEASE.json`：

```json
{
  "version": "v1.0.0",
  "commit": "完整或短 commit SHA",
  "deployedAt": "ISO-8601 时间",
  "requestIds": ["REQ-..."],
  "verified": true
}
```

7. 在对应 REQ 日志和 `change-logs/INDEX.md` 写入版本、commit 和 VPS 验证证据。

在这一步完成前，不应该同时让多个任务以“v1.0”自行修改并尝试上线。可以并行做只读调研、需求拆解和测试设计，但不能并行发布。

## 3. 每个并行任务的开工规则

### 3.1 任务日志先行

每项任务先创建或续写 `change-logs/REQ-*.md`，并新增以下字段：

```text
开发基线版本：v1.1.0
开发基线 commit：abc1234
目标集成主线：main
工作分支：task/REQ-...-short-slug
工作目录：.worktrees/task-REQ-...-short-slug
```

基线必须是已经验证的 `main`/发布 commit，不允许只写“最新代码”。如果任务工作期间主线前进了，日志要记录其落后版本和后续集成结果。

### 3.2 独立 worktree + 分支

同一时间的两个对话不能在同一个可写目录编辑文件。每个任务使用自己的 branch 和 worktree。

`.worktrees/` 已被 `.gitignore` 忽略。没有桌面原生 worktree 工具时，可在干净基线后使用：

```bash
git worktree add .worktrees/task-REQ-YYYYMMDD-HHMMSS-short-slug \
  -b task/REQ-YYYYMMDD-HHMMSS-short-slug <base-commit-or-tag>
```

在该 worktree 内安装/复用依赖、修改、测试和提交。不要在主工作目录直接改动另一个任务的文件。

### 3.3 不碰其他任务的边界

- 不修改另一个 REQ 日志的实施内容或状态；
- 不覆盖 `main`、不 reset、不 checkout 回退其他工作；
- 不同步整个旧 worktree 到 VPS；
- 如果发现另一个任务改到了同一文件或同一数据契约，在自己的日志中记录“潜在冲突”，并等待集成阶段处理；
- 数据库 schema、API contract、网关、风控、定时器和部署文件属于高冲突区域，开始前必须主动检查当前主线和相关 REQ 日志。

## 4. 任务完成不等于可以部署

任务分支即使本地测试通过，也只能达到 `VERIFIED_LOCAL`。它必须经过一次“回到最新主线”的集成门槛。

### 4.1 集成门槛

当任务完成时，集成人员/对话执行：

1. 更新本地 `main`，确认其 commit 是当前唯一集成基线。
2. 将任务分支 rebase 到最新 `main`，或在专用集成 worktree 中将其 merge 到最新 `main`。
3. 解决文本冲突后，逐项做语义检查：
   - API 请求/响应字段是否变化；
   - SQLite schema 和迁移/`ensure` 是否兼容；
   - 页面调用的路由、参数和状态是否还存在；
   - 策略、订单、网关和 timer 的安全条件是否仍成立；
   - 新旧功能是否修改同一状态、同一订单来源或同一 UI 语义。
4. 在“任务代码 + 最新 main”的组合上运行相关测试；高风险改动再运行完整测试和构建。
5. 更新任务日志的“最终集成基线 commit”“冲突处理”“测试结果”。
6. 只有成功进入 `main` 的 commit 才可成为发布候选。

不建议把几个落后任务一次性堆叠合并。每合入一个任务就跑相关验证，主线前进后下一个任务必须再次 rebase/merge 到新的主线。

### 4.2 对话 2、3 应如何处理

以用户举例：

- 对话 1：从 v1.0 完成并验证后，合入 `main`，发布 v1.1。
- 对话 2：虽然开发起点是 v1.0，完成时不能直接部署；先将它 rebase 到 v1.1 的 `main`，处理冲突和接口变化，测试通过后再合入 `main`，发布 v1.2。
- 对话 3：三天后即使自己仍基于 v1.0，也必须 rebase 到当时最新的 `main`（可能是 v2.0），重新处理冲突并验证；它不应覆盖 v2 的发布目录。

因此，旧任务的代码不保证能“很好自动整合”。可整合性来自最后一次 rebase/merge、语义审查和测试，而不是来自 Git 或 rsync 本身。

## 5. 单一发布者和 VPS 发布锁

同一时刻只能有一个发布动作。任务作者可以提交“发布候选”，但不可以自行绕过集成流程发布。

发布前，发布者必须：

1. 从 `main` 的确定 commit 创建发布版本/tag；
2. 在日志索引中声明“发布进行中”和目标版本；
3. 使用 VPS 发布锁避免两次 SSH/rsync/restart 交错；
4. 只同步该 commit 对应的已审阅发布内容；
5. 构建、重启、验证；
6. 更新 VPS `RELEASE.json`、REQ 日志和索引。

VPS 上可使用 `flock` 串行化发布，例如：

```bash
sudo flock -n /var/lock/trade-workbench-deploy.lock \
  bash -lc 'cd /opt/trade-workbench && npm run build && systemctl restart trade-workbench.service'
```

上例只说明锁的机制；真实发布命令还必须包含明确的同步范围、版本 manifest 和验证步骤。锁被占用时不能强行发布，应将对应 REQ 标记为 `BLOCKED` 或等待发布队列。

## 6. 发布版本记录

每次发布必须有单调递增版本，例如：

```text
v1.0.0  基线冻结
v1.1.0  合入 REQ-A
v1.2.0  合入 REQ-B
v2.0.0  有意的重大行为/数据契约变化
```

版本号本身不代替 commit。每个版本必须关联：

- `main` commit SHA；
- 包含的 REQ ID；
- 部署时间；
- VPS 验证结果；
- 回滚基线（上一个已经验证的 release tag）。

回滚也必须是一次新的、可审计的发布动作：从已验证 tag 发布，而不是把某个旧任务 worktree 复制回 VPS。

## 7. 并行度建议

可以同时做 2–3 个任务，但按风险分层：

| 可安全并行 | 应尽量串行 |
|---|---|
| 纯 UI 文案、样式、独立页面 | 数据库 schema、`db/ensure.ts`、迁移 |
| 独立雷达展示 | API contract、共享状态、观察列表 |
| 新增独立测试 | Binance Gateway、订单策略、风控、定时器 |
| 文档和日志 | 部署脚本、环境变量、Caddy、systemd |

两个任务都能编辑同一文件并不表示它们适合并行。涉及右侧“应尽量串行”的区域，先拆清接口所有权，或让一个任务先合入后另一个再开始。

## 8. 每条 REQ 日志新增要求

除既有审计字段外，每条日志必须有：

```markdown
## 并行开发与集成

- 开发基线版本：
- 开发基线 commit：
- 当前 main commit（开始时）：
- 工作分支和 worktree：
- 可能冲突的 REQ / 文件 / 数据契约：
- 最终集成 main commit：
- rebase/merge 结果：
- 语义冲突检查：
```

## 9. 禁止事项

- 禁止从任务 worktree 直接 rsync 到 VPS；
- 禁止在未 rebase/merge 最新 `main` 的情况下部署旧任务；
- 禁止用覆盖文件的方式“解决”冲突；
- 禁止跳过数据库/API/策略语义检查，只处理 Git 文本冲突；
- 禁止在两个对话中同时重启或迁移同一 VPS 服务；
- 禁止把“文件同步完成”写成“功能已上线”；
- 禁止在未建立可信基线前让多个任务各自认为自己代表线上版本。

## 10. 开始并行开发前的最小 Checklist

- [ ] VPS 当前发布版本、commit 和时间已记录。
- [ ] 本地 `main` 已与该发布版本一致，或差异已明确记录。
- [ ] 当前未提交改动已审查，且不会混入并行任务。
- [ ] 每个任务有唯一 REQ 日志、基线 commit、分支和 worktree。
- [ ] `main` 是唯一集成主线；任务分支无权直接发布。
- [ ] 已指定一次只允许一个发布者，并使用 VPS 发布锁。
- [ ] 每次发布更新版本/tag、RELEASE manifest、REQ 日志和索引。

