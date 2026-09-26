# 03 · Grid / Synthetic Grid / Position Sizing

## 网格的统一定义

- [INFERENCE] 网格是把一个连续的价格/价差路径离散成若干可触发 level，并为每个 level 预先分配库存、资金和退出条件；它可以由订单簿挂单、CLMM 区间、触发 swap 或两腿套利组成。
- [AUTHOR_CLAIM | CJ:2079420210935898272; CJ:2043146683727692020] 作者在韩国/美国价差和原油/期现差价场景中偏好“扩大加仓、缩小减仓”的网格路径，而不是一次性建满。
- [INFERENCE] 网格不创造 edge；它只改变入场、库存累积和实现 PnL 的路径。若价差趋势化、相关性断裂或流动性撤走，网格会把未实现损失和保证金需求逐级放大。

## 静态与自适应

- [INFERENCE] 静态网格固定中心、边界、间距和 level allocation，适合可回放、可审计的 baseline。
- [INFERENCE] 自适应网格可依据 realized volatility、价差 z-score、流动性和库存改变 spacing/center，但每次参数变化都要记录版本并能复现。
- [AUTHOR_CLAIM | CJ:1933013337576780181] 作者反对 LP 的无脑自动再平衡，理由是频繁追涨杀跌会在波动中兑现损失；这应被视为 LP-specific hypothesis，不等于所有自适应网格都无效。
- [AUTHOR_CLAIM | CJ:2080291927170400660; CJ:2093471899749908678] 作者同时记录过移动网格和动态参数用于 perp/价差策略，且在波动不足或滑点过大时减仓/停做。

## 间距：算术、几何与波动敏感

- [INFERENCE] 算术 spacing 适合绝对价差近似稳定的标的；几何 spacing 适合百分比波动较稳定的标的，不能把两者的 level 数直接比较。
- [INFERENCE] 波动敏感 spacing 可用 `step = max(min_step, k × realized_vol × horizon)`，但 `k`、horizon、min_step 都是 H-CJ 假设而非默认生产值。
- [INFERENCE] spacing 应同时覆盖 fee、slippage、gas、借贷/资金费和失败交易的 break-even；只看价格触发距离会产生负期望频繁成交。

## 触发 swap 与层数

- [INFERENCE] triggered swap（触发 swap）可以模拟 synthetic grid：price/tick 到达 level 后，以 min-output、deadline 和 quote freshness 约束一笔有限额 swap；它不是免费限价单。
- [AUTHOR_CLAIM | CJ:1916086010678849899; CJ:1906004982194934146] 作者描述过非线性资金加权/逐级增加的马丁式层次和 9 个订单示例；这些属于仓位路径案例，不得直接当成 15-level 或倍增规则。
- [INFERENCE] level count 由资本、最坏趋势损失、订单容量、gas、监控复杂度和恢复路径共同决定；H-CJ-007 比较等额、几何和 capped martingale。
- [INFERENCE] 每一层必须有独立的 reserved capital、max notional、expected fill、remaining inventory 和 cancel/expire 状态；层数越多，状态机和对账负担越大。

## Re-centering 与库存约束

- [INFERENCE] re-centering 不能只由价格越界触发；至少要联合库存偏斜、edge decay、realized volatility、可用流动性、费用和距离上一次迁移的时间。
- [INFERENCE] 每次中心迁移先模拟“撤旧仓/换库存/建新仓”的 all-in cost；只有预期改善超过成本与风险缓冲，才进入 G4 staging。
- [INFERENCE] inventory constraint 应包括 token 数量、USD delta、stablecoin/borrow capacity、单池/单 venue 集中度和跨策略相关性。
- [AUTHOR_CLAIM | CJ:2094294541214117902] 作者把手动同时操作 7–8 个土狗、极限约 10 个作为精力上限；H-CJ-018 将其转为人机协作和监控负载假设，不当成通用最优值。

## 趋势、撤流和尾部失败

- [INFERENCE] 上升/下降趋势会连续触发同一方向 level，使“均值回归”假设失效；网格的最大损失应在 stress path 上先于收益回测。
- [INFERENCE] liquidity withdrawal（TVL/active liquidity 下降）会同时放大滑点、无法退出和价格冲击；即使网格名义价差仍存在，也可能不可执行。
- [OBSERVATION | CJ:2002222238624592254; CJ:1995702534275825960] 归档描述过市价失败、默认滑点不足时没有结果、高滑点又吃掉利润的场景；这说明 failed/unknown execution 必须成为网格状态，而非简单重试。

## G2/G4 验收字段

| 字段 | 必须记录 |
| --- | --- |
| 网格定义 | center、lower/upper、spacing_type、step、level_count、allocation_curve、version |
| 触发 | trigger_price/tick、quote_time、oracle/index time、reason、expected edge |
| 成本 | fee、slippage、gas、funding/borrow、failed-tx reserve |
| 库存 | per-level reserved、filled、remaining、net delta、margin headroom |
| 状态 | planned、quoted、submitted、included、partial、unknown、cancelled、expired、halted |
| 退出 | trend breach、liquidity breach、risk limit、stale data、manual approval |

[INFERENCE] G2 只做 shadow/paper state machine；G3/G4 的真实执行接口必须在另一个任务中以安全门控实现。
