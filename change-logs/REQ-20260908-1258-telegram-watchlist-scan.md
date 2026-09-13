# REQ-20260908-1258-telegram-watchlist-scan

状态：BLOCKED
创建时间：2026-09-08 12:58 Asia/Shanghai
最后更新时间：2026-09-08 12:58 Asia/Shanghai

## 用户原始要求

- 修复 Telegram 无响应、无法操作/下单的问题。
- 将交易页自选币固定为四个实线分隔的来源区：固定主流币、Binance/Bybit 持仓币、手动自选、机器自选。
- 每天北京时间 08:05 起每小时扫描；12:05、16:05、20:05、00:05、04:05 等轮次额外纳入 4 小时形态。机器自选要求最近连续三根已收盘 1 小时 K 线在 MA30 ± 1 ATR 外，并按强势排序；扫描可慢，但不得触发 Binance 风控。

## 范围与验收标准

- Telegram webhook 能区分并记录脱敏后的鉴权、重复更新、解析、会话、回发失败；可复现的失败返回能让 Telegram 重试，成功/重复更新仍立即确认。
- 固定 BTC、ETH、SOL、HYPE、ENA 始终保留；Binance 与 Bybit 任一非零持仓进入持仓区；手动与机器来源互不删除。
- 机器来源只由已收盘 1 小时 MA30 ± 1 ATR 规则决定；三根后入池，回到阈值内移除机器来源；4 小时扫描仅作为排序确认。
- 维护调度自北京时间 08:05 起持续每小时运行，4 小时窗口按 08/12/16/20/00/04 叠加；扫描按限速、缓存和失败保留策略运行，仅读 Binance/Bybit 公共行情或既有只读账户接口，不下单、不改杠杆。

## 修改前基线

- 本地 main：99e374be905298dfee3e876a027c43a4d8c88c4a。
- 本地工作区含大量与本 REQ 无关的已修改、删除和未跟踪文件，不能作为 VPS 已发布版本。
- 引用任务显示曾从 `/private/tmp/trade-workbench-bybit-recovery-v2` 部署并于当时验证服务，但不能替代当前 VPS 只读核验。
- 当前两次 SSH（同一主机与私钥路径）均返回 `Permission denied (publickey)`；尚未取得 RELEASE.json、服务日志或 Telegram webhook 状态。

## 并行开发与集成

- 开发基线版本：未建立。
- 开发基线 commit：未建立。
- 当前 main commit（开始时）：99e374be905298dfee3e876a027c43a4d8c88c4a。
- 工作分支和 worktree：未创建；当前不可从未验证基线创建可部署任务。
- 可能冲突的 REQ / 文件 / 数据契约：自选来源、SQLite schema、维护 timer、Telegram webhook、Binance/Bybit 账户同步；当前工作区已有这些区域的未提交改动。
- 最终集成 main commit：未开始。
- rebase/merge 结果：未开始。
- 语义冲突检查：待 VPS 基线冻结后执行。

## 实施计划

见 `docs/superpowers/plans/2026-09-08-telegram-watchlist-scan.md`。

## 实际修改

- 仅创建本需求审计日志、更新索引，并撰写设计/实施计划；未修改生产代码、数据库、环境变量、定时器或交易开关。

## 本地验证

- 只读审计：已读取维护调度、ATR 生命周期、自选来源和 Telegram webhook 代码与相关测试。
- 未运行构建或测试：当前工作区不是干净、可信的开发基线。

## VPS 部署与线上验证

- 未部署。
- SSH 只读检查被拒绝：`Permission denied (publickey)`；无线上 Telegram 根因或服务状态证据。

## 当前状态

BLOCKED：等待恢复 SSH 只读访问，并完成 VPS 发布 manifest / Git commit 与本地基线的比对冻结。

## 剩余问题与下一步

1. 用已授权的 SSH 身份只读检查 `/opt/trade-workbench/RELEASE.json`、服务、Telegram webhook 日志和部署 Git commit。
2. 建立可复核的发布基线后，在独立 worktree 依计划 TDD 实施并进行集成。

## 时间线

- 2026-09-08 12:58：记录需求、确认设计和阻塞原因；未进行代码或 VPS 变更。
