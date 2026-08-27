# Radar scan progress and USDT scope

> **实施状态（2026-08-28）：** 已完成并部署到 VPS。扫描器会持续保存 USDT 永续的总数、已扫描、命中、剩余、百分比与当前币种；前端按快照轮询展示。

## Goal

让雷达扫描显示真实、可解释的币种进度：总币种数、已扫描数、命中数、剩余数、百分比和当前币种；扫描范围只包含 Binance Futures 的 TRADING USDT 永续合约，并在后台扫描过程中持续保存进度，便于前端轮询展示。

## Constraints

- 保留现有 Binance 请求节流与重试策略，不提高请求频率。
- 只调整雷达公共币种筛选，不改变通用市场/交易下拉列表对 USDC 的支持。
- 保留旧快照兼容性，历史数据缺少进度字段时使用安全默认值。
- 不触碰实盘开关、下单、平仓和 VPS 环境变量。
- 先通过针对性测试和构建验证，再部署 VPS。

## Design

1. 新增共享的扫描进度模型，统一计算 total、scanned、matched、remaining 和 percent。
2. 为 reversal、MA30/OI、multi-timeframe 扫描器增加进度回调；后台任务每次处理币种后保存最新快照。
3. pending 快照沿用上一轮已知币种总数；首次扫描在 exchangeInfo 返回后立刻写入真实总数。
4. reversal 的 4H 和日线分别展示进度行，避免把两个周期的扫描错误合并成一个币种数。
5. `ManualProgress` 使用确定性填充进度条，并补充无总数时的列表读取状态。
6. 雷达公共列表仅保留 TRADING + PERPETUAL + USDT。

## Verification

- 先新增会失败的进度模型、扫描回调和 USDT 过滤测试。
- 运行相关单元测试，再运行前端 lint/build 或项目已有的最小验证命令。
- 检查改动范围，确认没有触碰实盘配置和交易接口。
- 部署前只做静态/API 健康检查，不触发扫描、下单或平仓。
