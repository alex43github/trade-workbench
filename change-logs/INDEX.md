# Trade Workbench 修改日志索引

这是所有需求日志的入口。后续模型开始工作前必须先读取本文件，再打开与当前需求相关的日志。

| REQ ID | 需求 | 状态 | 最后更新时间 | 日志 |
|---|---|---|---|---|
| REQ-20260916-1001-s6-1-forward-observer | S6.1：research-only Forward Validation observer，append-only 因果快照与未来结果 | VERIFIED_LOCAL | 2026-09-16 10:25 | [打开日志](REQ-20260916-1001-s6-1-forward-observer.md) |
| REQ-20260913-1223-trend-radar | TREND-RADAR-01：小时强趋势雷达、Sticky Watchlist 与 Bark 通知 | BLOCKED | 2026-09-13 12:23 | [打开日志](REQ-20260913-1223-trend-radar.md) |
| REQ-20260913-1216-squeeze-radar | SQZ-RADAR-01：研究版轧空/轧多雷达与 Bark 路由 | BLOCKED | 2026-09-13 12:18 | [打开日志](REQ-20260913-1216-squeeze-radar.md) |
| REQ-20260908-1258-telegram-watchlist-scan | 修复 Telegram 响应并实现分区自选币、低频 1h/4h 扫描 | BLOCKED | 2026-09-08 12:58 | [打开日志](REQ-20260908-1258-telegram-watchlist-scan.md) |
| REQ-20260908-new-task-prompt | 重拟新对话开工提示词，统一基线、并行、集成、发布与审计规则 | VERIFIED_LOCAL | 2026-09-08 | [打开日志](REQ-20260908-new-task-prompt.md) |
| REQ-20260908-concurrent-release-protocol | 建立多对话并行开发、集成主线与单一 VPS 发布规则 | VERIFIED_LOCAL | 2026-09-08 | [打开日志](REQ-20260908-concurrent-release-protocol.md) |
| REQ-20260908-change-log-protocol | 建立跨对话修改日志和 VPS 验证协议 | VERIFIED_LOCAL | 2026-09-08 | [打开日志](REQ-20260908-change-log-protocol.md) |

## 使用规则

- 新需求先在本文件追加一行，再创建对应日志文件。
- 同一需求在不同对话继续时，只更新原行和原日志，不创建重复条目。
- 状态必须使用 `change-logs/README.md` 定义的状态值。
- `VERIFIED_ON_VPS` 只能在日志中存在真实远程验证证据后使用。