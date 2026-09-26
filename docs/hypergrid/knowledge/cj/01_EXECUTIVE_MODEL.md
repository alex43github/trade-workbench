# 01 · Executive Model

## 一句话模型

[INFERENCE] CJ 归档最可复用的共同结构不是“某个 APR 数字”，而是：识别外部流量/价格/利率造成的摩擦 → 把仓位拆成可观测的现金流与库存 → 以成本、退出和失败模式约束执行 → 用监控而不是预测驱动切换。

## 机制分层

| 层 | 研究问题 | 证据/来源 | HyperGrid 目的 |
| --- | --- | --- | --- |
| 流量 | 是否有真实交易、借贷或资金费支付者？ | [AUTHOR_CLAIM | CJ:2090359344445719016; CJ:1914933717157777419] FOMO、DEX 首发和外部对手盘被视为收益来源 | G1 过滤“高 APR 但无流量”的候选 |
| 定价 | 价差/费率差是否超过 all-in cost？ | [INFERENCE | CJ:1908175169929302313; CJ:1930592265342525690] | G1/G7 统一 edge ledger |
| 库存 | LP、现货、PT、借贷抵押品和 perp 是否暴露同一方向？ | [INFERENCE | CJ:1899347899970154794; CJ:1913110637544448479] | G2/G6/G7 计算净 delta 与可退出性 |
| 执行 | 价格窗口是否能穿过 quote → inclusion → settlement？ | [AUTHOR_CLAIM | CJ:1931626940806598927; CJ:2030312359747879130] | G3/G4 做 quote freshness、slippage、MEV 和失败成本 |
| 停止 | 哪个事件把收益假设变成损失假设？ | [AUTHOR_CLAIM | CJ:1934241999819038740; CJ:2095097321096970650] | G4 统一 halt/restart 原因 |

## 可操作状态机

```text
DISCOVERED
  -> DATA_VALIDATED (价格/池/费率/可借额度/时间戳齐全)
  -> SHADOW (仅模拟成交、库存、费用和失败)
  -> STAGED (人工/策略批准，有限额和 kill switch)
  -> EXECUTABLE (仅当所有安全不变量满足)
  -> HALTED (流动性、价格、RPC、信用、库存或模型约束失效)
  -> RECONCILING -> SHADOW 或 STAGED
```

[INFERENCE] 任何策略不得从 `DISCOVERED` 直接进入 live；`EXECUTABLE` 只是后续产品设计状态，本任务不实现它。

## 关键的正/负反馈

- [AUTHOR_CLAIM | CJ:2090359344445719016] 外部 FOMO 资金会增加做市/套利的价差和手续费机会，但热度极高也可能是短期见顶信号。
- [INFERENCE] 这形成“流量增加 → gross edge 增加 → 专业资金进入 → edge 衰减”的负反馈；G1 必须记录 edge half-life，而不是只展示 APR。
- [OBSERVATION | CJ:2092322901647372641; CJ:2093471899749908678] 归档同时记录早期高收益、随后滑点加大、策略需要动态调参，说明 headline yield 与净执行收益不是同一指标。
- [INFERENCE] 新链/新产品边际收益应作为会衰减的 regime feature，默认设置过期时间和再验证门槛。

## 时间变化与矛盾登记

| 主题 | 早期/正面表述 | 后期/限制表述 | 处理 |
| --- | --- | --- | --- |
| LP | [AUTHOR_CLAIM | CJ:2094571978401423557] 短时高换手可快速产生 fee | [AUTHOR_CLAIM | CJ:2095097321096970650] 新手不要盲目组，进入专业玩家阶段 | 作为 regime-dependent hypothesis，不作恒定优势 |
| 自动再平衡 | [OBSERVATION | CJ:1933013337576780181] 作者反对 LP 自动迁移 | [INFERENCE] perp 移动网格是不同策略，不自动等同 | 分离 LP position policy 与 perp quote policy |
| APR | [AUTHOR_CLAIM | CJ:1987051719541547037] 3000%/1000% 作为短线门槛 | [OBSERVATION | CJ:2092322901647372641] 早期高 APR 会随专业资金进入而下滑 | 仅 H-CJ-019，需净收益和生存分析 |
| 低延迟 | [AUTHOR_CLAIM | CJ:2092322901647372641] Rust/热路径可达几十微秒 | [AUTHOR_CLAIM | CJ:2030312359747879130] 低延迟目的首先是降低滑点，不是抢延迟套利 | 以可观测 execution quality 检验，不采纳语言崇拜 |
| 资金费 | [AUTHOR_CLAIM | CJ:2014538756033028248] 常规策略通常只是几十 APR | [AUTHOR_CLAIM | CJ:2081272253535436978] 极端行情可出现更高 APR | 按 regime 分层，净成本后回测 |

## 工程归属

- [INFERENCE] G1 负责候选发现和 edge/cost 预估；G2 负责 shadow grid/LP 仿真；G3 负责受限执行；G4 负责 staging、fail-closed、kill switch；G5 负责指标、证据和审计；G6 负责有回测支持的自适应策略；G7 负责独立套利研究/执行，不与 LP 网格共享未经验证的参数。
- [INFERENCE] 每个候选必须同时产出：source IDs、证据等级、假设 ID、数据新鲜度、成本预算、退出路径和失败原因；否则只能停留在 research。
