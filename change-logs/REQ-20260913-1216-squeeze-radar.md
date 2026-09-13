# REQ-20260913-1216-squeeze-radar

状态：BLOCKED
创建时间：2026-09-13 12:16 Asia/Shanghai
最后更新时间：2026-09-13 12:18 Asia/Shanghai

## 用户原始要求

- 执行 GitHub Issue #1 的 `[TASK SQZ-RADAR-01]`：部署 Binance USDT-M 研究版轧空/轧多雷达，保留 1H/4H Bark 路由、关闭独立 15m 路由，并完成获授权的合成及健康 Bark 验证。

## 范围与验收标准

- 只涉及 `structure-radar`、Bark、精确所需 systemd/config 与本地 Bridge Runner 的 `BARK_ALERT` 分派；绝不修改订单、Gateway、仓位或交易开关。
- 任何 VPS 发布必须从可验证的集成主线 commit 进行，且仅同步已审阅的任务文件。

## 修改前基线

- 本地 `main`：`99e374be905298dfee3e876a027c43a4d8c88c4a`；工作区含大量与本 REQ 无关的已修改、删除和未跟踪文件。
- VPS（2026-09-13T04:16:02Z）`/opt/trade-workbench/RELEASE.json` 缺失，且发布目录不能提供 Git commit；无法证明其与本地 `main` 或当前未提交雷达代码的对应关系。
- VPS `trade-workbench.service`、`binance-gateway.service`、`squeeze-radar.service` 均为 active；仅确认网站/网关回环端口 3000/8788，未确认本任务实现正在线上运行。

## 并行开发与集成

- 开发基线版本：未建立。
- 开发基线 commit：未建立。
- 当前 main commit（开始时）：`99e374be905298dfee3e876a027c43a4d8c88c4a`。
- 工作分支和 worktree：未创建；不可从当前含大量未知脏改动的目录生成可部署候选。
- 可能冲突的 REQ / 文件 / 数据契约：`services/structure-radar/*`、Bark 路由、systemd unit 与维护 timer；当前本地这些区域已有未提交修改。
- 最终集成 main commit：未开始。
- rebase/merge 结果：未开始。
- 语义冲突检查：未开始；缺少可信发布基线。

## 实施计划

1. 先冻结并记录 VPS 当前发布的可复核 commit/manifest，与本地集成主线建立对应关系。
2. 在隔离 worktree 上以测试保护完成最小的雷达状态机、路由与通知改动，集成至最新 main。
3. 通过单一发布锁，仅同步精确的雷达文件，备份 VPS 目标配置并验证两个扫描周期后再发送两条获授权 Bark。

## 实际修改

- 创建本 REQ 审计日志并更新索引；未修改生产代码、VPS 文件、环境、timer、服务或交易开关。

## 本地验证

- 只读检查了 `services/structure-radar`、Bark sender、现有 squeeze 骨架、service unit 与相关测试。
- 首次通过 `npm exec tsx` 的目标测试在受限沙箱中因 `tsx` 创建 IPC socket 被拒绝；改用 Node 原生 TypeScript 执行后，`node --test tests/squeeze-radar.test.mjs tests/bridge-bark-alert.test.mjs` 通过：11/11。

## VPS 部署与线上验证

- 仅做了脱敏的只读检查；未读取环境文件内容、未显示密钥。
- 未部署、未重启服务、未修改 15m/1H/4H 路由、未发送任何 Bark。

## 当前状态

BLOCKED：发布协议要求的可信 VPS 发布基线不存在。当前唯一可用发布方式无法证明会保留线上无关代码，因此若继续同步将违反用户的“不得部署无关脏改动”和“不能安全完成则 BLOCKED”边界。

## 剩余问题与下一步

1. 由发布协调者先创建/恢复 VPS `RELEASE.json`，并提供可复核的已发布 commit 或干净可重建来源。
2. 基线冻结后，按本 REQ 的隔离分支、集成与精确发布流程继续；不得复用当前未提交工作区直接上线。

## 时间线

- 2026-09-13 12:16：读取项目发布协议和相关雷达实现；完成 VPS 脱敏只读核查，确认发布基线缺失，未作变更。
- 2026-09-13 12:18：运行与本 REQ 相关的本地状态机、Bark 去重与 Bridge sender 测试，11/11 通过；未发送通知。
