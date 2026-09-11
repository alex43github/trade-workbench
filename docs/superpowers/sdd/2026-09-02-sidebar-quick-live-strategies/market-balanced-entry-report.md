# 市价多／空均衡损实现审计报告

日期：2026-09-03  
范围：`MARKET_BALANCED_LONG_1H`、`MARKET_BALANCED_SHORT_1H` 两个快捷模板的服务端实盘路径。  
状态：已完成服务端最小端到端实现，未发布，未执行真实下单。

## 需求落点

- 市价多：最终确认后以一笔 `MARKET + BUY` 开新仓；使用服务器读取的已收盘 1h SMA30／ATR14。收盘价首次低于 `MA30 - 1 ATR` 减少本策略来源成交量 50%，之后任何一根新的已收盘 1h K 线再次跌破则退出本策略剩余成交量。
- 市价空：镜像为 `MARKET + SELL`；首次收盘高于 `MA30 + 1 ATR` 回补 50%，第二次（允许间隔任意 K 线）回补剩余成交量。
- 两个市价均衡损模板均不配置止盈；除上述两次 1h 收盘突破／跌破外，不会凭空添加其他退出条件。
- 总保证金优先使用用户填写值；留空时由服务端读取总权益并按 5% 计算。市价模板只生成一条入场腿，该腿金额就是整笔总保证金，不会再错误地除以五。
- 仍使用既有最终确认、实盘开关、策略账本、订单尝试账本、成交同步和保护执行器。市价模板使用独立确认串 `CREATE_QUICK_MARKET_STRATEGY`，不会与原限价确认串混用。

## 数据流与持久化顺序

1. 快捷请求只提供模板 ID、币种和可选总保证金；`live-submit` 服务端读取 1h 行情、账户权益／可用余额、交易所过滤器、当前杠杆和持仓模式。
2. `expandQuickLiveTemplate` 生成服务端所有 MA／ATR／退出规则快照；`buildMarketLiveEntryOrder` 按标记价、杠杆、可用余额、`MARKET_LOT_SIZE`／`LOT_SIZE` 和最小名义价值计算数量，并生成唯一 `teleMK…`／`webMK…` client order ID。
3. 先创建策略，再保留订单；启用生产账本时先写入 generation、order attempt 和 RESERVED 订单，随后才调用既有 gateway `/fapi/v1/order`。回报和超时查询结果写回订单账本后，策略才转为 ACTIVE 或 RECONCILIATION_REQUIRED。
4. 成交同步按 client order ID 读取累计 `executedQty`，以 `clientOrderId:cumulativeQty` 形成 source fill ID，并只对累计成交量减去已绑定量后的剩余来源量创建 MA 保护。保护快照从已持久化的快捷策略复制，不重新信任浏览器数据。
5. 保护创建和退出仍走既有 reduce-only 市价保护路径；退出执行器按来源策略的 side 读取对应持仓桶，并持久化跨 K 线 breach count、已处理 candle ID 和剩余来源数量。

## 严格隔离依据

- Hedge Mode：通过 `selectPositionRiskRow(rows, symbol, strategySide)` 选择同币种的明确 LONG／SHORT 行；成交保护、保护策略创建和保护执行不再取该币种的第一行，因此不会把另一方向仓位作为来源。
- ONE_WAY：市价均衡损对单向持仓模式一律返回 409，绝不因同向／反向而例外放行；单向模式会把新成交和既有仓位合并，无法提供可证明的独立保护边界。需要使用这些模板时必须先切换 Hedge Mode。
- 保护退出数量取本策略 `remainingQuantity` 与当前对应方向数量的交集，并使用 reduce-only；不会按币种总持仓直接生成本次来源数量。
- 网关订单策略仅额外放行服务端标记的 `teleMK`／`webMK` 市价开仓，且必须是 Hedge Mode 的 `positionSide=LONG` 或 `SHORT`、无 `reduceOnly`；`positionSide=BOTH`（包括同向单向开仓）及任意未标记市价开仓均被拒绝。既有 `alexMC` 手动平仓和 `alex|tele|web` 保护市价单规则保留。
- 市价模板从自动重锚列表排除；已成交来源的退出快照和 breach 计数不会因限价重挂逻辑被移动或重置。

## TDD 记录

先增加 `tests/market-balanced-entry.test.mjs` 的失败断言并运行，初始结果为模块缺失／模板按五腿分摊／确认串不匹配／反向仓位未拦截。随后以最小改动补充市价 planner、模板元数据、提交分支、账本 MARKET 类型和持仓隔离。

当前聚焦结果：

- `node --test tests/market-balanced-entry.test.mjs`：5 passed。
- `node --test tests/binance-order-policy.test.mjs`：6 passed。
- `node --test tests/position-mode.test.mjs`：4 passed。
- `node --test tests/protection-strategies.test.mjs`：7 passed。
- `binance-gateway/order-policy.mjs` 的回归测试覆盖：指定 `webMK…` + Hedge `LONG` 放行、未标记市价开仓拒绝、`BOTH` 拒绝、`reduceOnly` 变体拒绝；同时保留已有手动平仓／保护单放行。
- 联合运行模板、快捷退出、保护、提交、重锚和网关相关测试：98 passed，0 failed。
- `git diff --check`：待父任务在合并并发 UI 改动后执行最终检查。

## 剩余风险与交接

- `QuickLiveStrategyPanel.tsx` 需要并发 UI worker 将两个 MARKET 模板加入选项，并在提示中把“单笔整笔保证金、立即市价开仓”说明清楚；当前服务端已暴露 `QUICK_LIVE_MARKET_TEMPLATE_IDS`／`QUICK_LIVE_ALL_TEMPLATE_IDS`，不要破坏原六个限价模板的兼容导出。
- 当前 `npx tsc --noEmit` 仍被并发 UI 改动阻塞：`StrategyWizard.tsx` 尚未补齐两个 MARKET 模板的方向映射；另有并发 `TradeChart.tsx` 的 `lineWidth` 类型和 `TradingTerminal.tsx` 的 interval 类型错误。服务端市价入口相关模块未出现类型错误。
- ONE_WAY 交易所本身没有真正的仓位 lot 隔离；本实现用来源成交量账本和 reduce-only 数量保证系统不主动碰旧来源，但交易所聚合仓位在经济意义上不可区分。若必须物理隔离相反方向，应先切换 Hedge Mode。
- 市价数量按提交瞬间标记价预估，实际成交价可能造成轻微保证金偏差；成交同步会以 Binance 实际成交量建立保护。市场单不执行重试或价格兜底，超时进入对账。
- 本报告没有发布、重启服务或向 Binance 发送真实订单；上线前必须由父任务完成 UI 审核、构建和无下单浏览器检查。
