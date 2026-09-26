# 10 · Product Requirements for HyperGrid

以下要求把 CJ 归档的机制转成 G1–G7 的产品边界。它们是 research/product requirements，不是本任务的实现清单。

## G1 Candidate Scanner

- [INFERENCE] 发现池/venue/instrument 的 TVL、active liquidity、volume、depth、fee/funding/borrow、price dispersion、token metadata、oracle/index 和可退出性。
- [INFERENCE] 为每个候选输出 gross edge、all-in cost、capacity、inventory direction、regime、edge half-life、source IDs、evidence class 和 hypothesis ID。
- [INFERENCE] 过滤 token tax/transfer restriction、可撤流动性、价格源不一致、stale data、过度集中、无法模拟退出的候选。
- [AUTHOR_CLAIM | CJ:1914933717157777419; CJ:2095097321096970650] 热门/早期流量可能带来机会，但专业资金进入后 edge 会下降；G1 必须做衰减评分。

## G2 Shadow Grid Engine

- [INFERENCE] 支持 static/adaptive、arithmetic/geometric、synthetic swap、CLMM range 和 multi-leg basis 的 shadow state machine。
- [INFERENCE] 逐层模拟 fill、partial fill、inventory、fees、IL/HODL、funding/borrow、gas、slippage、failed tx、reorg/unknown 和 trend/gap paths。
- [INFERENCE] 保留 immutable config version、input snapshot、seed/replay ID 和 output attribution；任何结果可重放。
- [AUTHOR_CLAIM | CJ:1916086010678849899; CJ:1906004982194934146] 马丁/非线性加仓只能作为待测 allocation family，默认 capped，不得写成无界倍增。

## G3 Execution Engine（未来任务）

- [INFERENCE] 只接受 G4 批准的 execution intent，不直接消费未经验证的扫描信号。
- [INFERENCE] 支持 quote freshness、min-output/amount-in-max、deadline、nonce/replacement、idempotency、partial fill、unknown result 和 reconcile。
- [INFERENCE] 为每条腿记录 request/quote/submit/ack/inclusion/fill/finality，拒绝无法证明的成功。
- [VERIFIED_EXTERNAL_FACT | EX-ETH-TX](https://ethereum.org/developers/docs/transactions) 交易需要经过广播、交易池、validator inclusion 和确认过程；执行系统必须按阶段建模。

## G4 Safety / Staging

- [INFERENCE] 风险引擎可独立否决：stale/ambiguous data、inventory skew、range break、fee below cost、liquidation distance、venue/protocol alert、token restriction、MEV/gas unprofitable、counterparty/bridge risk。
- [INFERENCE] 所有 threshold 由版本化 hypothesis/config 管理，禁止把作者 APR、15-level、10% range、3000/1000 APR 等直接当 production constants。
- [INFERENCE] 提供 kill switch、manual approval、dry-run、paper、shadow、replay 和 restart reason；halt 后恢复需重新校验全量前置条件。

## G5 Dashboard

- [INFERENCE] 展示 raw source、normalized metrics、data age、evidence class、hypothesis status、per-position PnL attribution、fee-vs-IL、inventory、capacity、execution quality 和 halt/restart。
- [INFERENCE] 同一屏同时显示 gross APR 与 net realized PnL，明确年化窗口、样本量和 confidence，防止 headline yield 误导。
- [AUTHOR_CLAIM | CJ:1913575205576007986] 监控现货/合约价格、资金费、异常波动和交易量是归档中明确的工程方向。

## G6 Adaptive Grid

- [INFERENCE] 只有 H-CJ-002/H-CJ-005/H-CJ-008 等假设在多 regime out-of-sample 通过后，才能接入自适应 spacing/center/rebalance。
- [INFERENCE] 自适应动作必须先 shadow simulate “不动作、撤出、重心迁移、减少库存”四个分支，并把 gas/slippage/MEV/failed tx 算入。
- [AUTHOR_CLAIM | CJ:1933013337576780181] LP 自动再平衡的负面经验需作为反例/对照组保留，不可被优化器删除。

## G7 Arbitrage Research / Execution（独立模块）

- [INFERENCE] funding、perp/spot basis、cross-venue、DEX/CEX、stable/lending、borrow loop、Pendle、event market 和 new-chain 各自使用 playbook schema，不共用未经证明的风险参数。
- [INFERENCE] 每个 playbook 必须有 capital path、gross/net edge、cost、latency、inventory、liquidation/credit/smart-contract、unwind、failure、regime 和 source provenance。
- [VERIFIED_EXTERNAL_FACT | EX-HL-FUNDING](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding) funding 的结算/计算取决于 venue 规则；G7 只能使用实时官方 semantics，不从作者数字推断常数。

## 交付优先级

1. [INFERENCE] G1 read-only scanner + source/evidence registry。
2. [INFERENCE] G2 shadow/replay + PnL/IL/fee attribution。
3. [INFERENCE] G5 dashboard + G4 fail-closed safety。
4. [INFERENCE] G7 research adapters 和纸面 forward test。
5. [INFERENCE] G6 adaptive policies 在假设验证后再做。
6. [INFERENCE] G3 real execution 只有在独立授权和安全验收后实现，本任务不包含。
