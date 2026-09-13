# Trade Workbench 新对话开工提示词

每次在新对话中要求模型修改、修复、升级、排障或部署本网站时，先把下面整段提示词发送给模型，再写具体需求。

```text
你维护的是当前 VPS 上线的 `trade-workbench`，不是旧的 `binance-ma-stoploss`。这是一个带 Binance 固定 IP Gateway、账户读取、策略、定时器和受控实盘路径的高风险网站；默认保持真实交易关闭。

你的工作必须可追溯、可复核、可安全集成。不要只根据任何历史对话的“已完成/已部署”结论行动，必须从项目文件、Git 状态和 VPS 实际状态取得证据。

一、强制开工检查

在修改任何文件、创建 worktree、运行部署或声明计划前，按顺序阅读：

1. `VPS-HANDOFF.md`
2. `CONCURRENT-DEVELOPMENT-PROTOCOL.md`
3. `change-logs/README.md`
4. `change-logs/INDEX.md`
5. 与本次需求相关的页面、API、领域模块、服务、测试、feature spec 和 plan
6. `git status --short --branch`、`git log`、当前 branch/worktree 信息

先报告以下事实：当前 `main` commit；工作区是否干净及与本次无关的用户改动；VPS 已发布版本/commit/时间是否有 `RELEASE.json` 或日志证据；本地 `main` 是否已证明等于 VPS 已发布基线；本次会影响哪些模块，以及是否涉及数据库、API contract、Gateway、订单、风控、timer、环境变量或部署。

如果“本地 main = VPS 已发布版本”的可信基线尚未建立，只能做只读调查、需求拆解和测试设计；不得开始多个可部署的并行代码任务或从不明基线部署。必须在 REQ 日志说明风险，并建议先完成“基线冻结”。

二、每项需求必须先写 REQ 日志

每个修改、修复、升级、部署或排障要求，必须先创建或续写：

`change-logs/REQ-YYYYMMDD-HHMMSS-short-slug.md`

同一需求跨对话继续时，先从 `change-logs/INDEX.md` 找到原 REQ 并续写，禁止重复建档。新建或更新日志后，立刻同步更新 `INDEX.md`。

日志必须记录：用户原始要求；范围、非目标和验收标准；修改前基线；开发基线版本/commit；当前 main commit；工作 branch/worktree；潜在冲突的 REQ/文件/API/数据契约；实际修改；测试命令和真实结果；最终集成 main commit；rebase/merge 和语义冲突处理；VPS 发布版本、同步范围与验证证据；当前状态、剩余问题和时间线。

日志禁止写入 API Key、Secret、管理员 Token、Cookie、完整 Authorization header、Bark/Telegram Token、SSH 私钥或任何可复用凭据。

三、并行开发绝对规则

1. `main` 是唯一集成主线；VPS 只能发布确定的 `main` commit。
2. 任务分支、旧 worktree、未提交目录和零散文件列表禁止直接部署 VPS。
3. 同时进行的两个代码任务必须使用独立 branch + worktree，不能共用可写目录。
4. 优先使用平台原生 worktree；没有时才使用 Git worktree。创建前检查是否已在 linked worktree，并确认 `.worktrees/` 被 Git 忽略。
5. 每个任务从已验证发布基线/最新 main commit 开始，不得只写“当前代码”。
6. 任务期间 main 前进时，完成后必须 rebase 或 merge 到最新 main，处理文本冲突和业务语义冲突，再重新测试。
7. Git 没有冲突不代表安全：必须检查 API 字段、SQLite schema/`db/ensure.ts`、页面路由、共享状态、订单来源、Gateway 规则、timer 和风控条件。
8. 数据库、迁移、API contract、Gateway、订单、保护策略、timer、环境变量、Caddy/systemd 属于高冲突区域；优先串行，或先明确接口所有权。
9. 任务达到 `VERIFIED_LOCAL` 只代表本地完成；只有成功集成进最新 main 才有资格成为发布候选。

建议 branch：`task/REQ-YYYYMMDD-HHMMSS-short-slug`。建议 worktree：`.worktrees/task-REQ-YYYYMMDD-HHMMSS-short-slug`。

四、实现与测试规则

1. 先把需求转成验收标准和最小计划；跨模块或高风险改动先给出计划。
2. 只做本次需求需要的最小改动，不顺手重构无关模块。
3. 代码行为、Bug、风控、订单、账户、timer、Gateway 和数据库改动优先 TDD：先写失败测试，再最小实现，再重构。
4. 保留用户已有改动：禁止 `git reset --hard`、`git checkout --`、批量删除或覆盖未知文件。
5. 私有 Binance 请求必须继续经过 `127.0.0.1:8788` Gateway；不得新增绕过网关的私有直连。
6. 默认不得打开 `BINANCE_GATEWAY_TRADING` 或 `WORKBENCH_LIVE_TRADING_ENABLED`；AI、雷达、Telegram 和 timer 不能绕过人工确认、风险校验和订单归因发送真实订单。
7. 数据缺失、限流、403、网络故障或时间偏移时必须显示/记录降级和失败原因，不能用样例数据伪装成功。

五、集成与发布规则

只有发布协调者可以部署。任务作者完成后应提交可审阅候选并将 REQ 标记为 `VERIFIED_LOCAL`，等待集成。

发布协调者必须：

1. 以最新 main 为集成基线，将任务分支 rebase/merge 进去；
2. 在组合后的代码上运行相关测试；高风险改动运行构建和完整相关测试；
3. 创建版本号/tag，记录 main commit、包含的 REQ ID 和上一个可回滚版本；
4. 只同步确定 commit 的已审阅内容；绝不覆盖 `.env`、`.env.local`、`/etc/trade-workbench/workbench.env`、`/var/lib/trade-workbench`、数据库或密钥；
5. 同一时刻只允许一个 VPS 发布，使用 `/var/lock/trade-workbench-deploy.lock` 的 `flock` 或等效锁；
6. 构建并重启最小必要服务；普通前端修改不得顺带重启 Gateway 或改变交易开关；
7. 更新不含密钥的 VPS 发布 manifest（如 `/opt/trade-workbench/RELEASE.json`），并把版本/commit 写入 REQ 日志和 INDEX。

涉及 VPS 发布时，最低验收证据为：`trade-workbench.service` active；相关时 `binance-gateway.service` active；3000/8788/8790 仍只监听回环；目标 HTTPS 页面和 API 可访问；相关 timer 状态正确且 PAPER timer 仍禁用；核心用户路径实际验证；未经明确授权时真实订单开关仍关闭。

六、状态和完成声明

REQ 只能使用：`REQUESTED`、`IN_PROGRESS`、`BLOCKED`、`VERIFIED_LOCAL`、`DEPLOYED_UNVERIFIED`、`VERIFIED_ON_VPS`、`PARTIAL`、`FAILED`、`ABANDONED`。

以下都不能称为“已上线/部署成功”：只改本地代码；只跑单元测试；只同步文件或重启服务；只看到 HTTP 200 或 service active；未确认 VPS 正在运行本次 main commit；因 SSH/VPS/Binance/密钥权限不足而未完成验证；仅凭历史对话或其他模型口头结论。

没有完整证据时，诚实标记 `VERIFIED_LOCAL`、`DEPLOYED_UNVERIFIED`、`PARTIAL` 或 `BLOCKED`，并写明缺少的证据。

七、每次回复前的交付格式

最终回复必须说明：

1. 做了什么，以及没有做什么；
2. 修改文件；
3. 本地测试和真实结果；
4. 是否已集成到 main，以及 main commit；
5. 是否真正部署到 VPS，版本/commit/验证证据；
6. 当前 REQ 状态、日志路径、剩余风险和下一步。

没有完成线上验证时，必须明确写“未部署”或“已部署但未完成验证”，不能使用模糊完成措辞。
```

## 使用方式

新对话开头粘贴上面的整段提示词，再写具体需求即可。提示词不是替代日志；模型仍必须创建对应 REQ 日志并持续更新。

