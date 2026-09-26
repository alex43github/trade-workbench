# 06 · Execution / MEV

## 延迟不是单一数字

- [AUTHOR_CLAIM | CJ:2030312359747879130; CJ:2092322901647372641] 作者把低延迟系统的主要价值描述为降低滑点/提高稳定性，并讨论过 Rust 热路径；同时强调非专业用户不要直接碰 perp 量化。
- [INFERENCE] HyperGrid 应把延迟拆成 market-data age、decision time、quote-to-submit、RPC/venue ack、block inclusion、fill-to-hedge 和 settlement/finality，而不是只报“几十微秒”。
- [INFERENCE] 低延迟只有在 edge 的衰减速度超过额外工程/运维成本时才有价值；对慢速 funding/lending 交易，数据正确性、信用和退出容量可能比语言/CPU 更重要。

## 区块、gas 与失败成本

- [VERIFIED_EXTERNAL_FACT | EX-ETH-GAS](https://ethereum.org/developers/docs/gas/) Ethereum gas 是计算资源成本，基础费和 priority fee 共同影响 inclusion；执行失败也可能消耗 gas。
- [VERIFIED_EXTERNAL_FACT | EX-ETH-TX](https://ethereum.org/developers/docs/transactions) 交易要经广播、交易池、validator inclusion 和后续确认/最终性；nonce 是账户的顺序计数器。
- [INFERENCE] 链上套利的 break-even 必须包含 expected gas under congestion、priority fee、failed/reverted tx reserve、replacement cost 和最终性等待，不应只用当前 gas price。
- [INFERENCE] gas auction 让“更快”变成成本函数；当 net edge 不足以覆盖 inclusion premium 时，策略应不下单。

## MEV、sandwich、front-run、back-run

- [AUTHOR_CLAIM | CJ:1931626940806598927] 作者明确警告公共节点暴露和大额 swap 的 MEV 夹子风险，并建议 private RPC 与最低接收数量。
- [VERIFIED_EXTERNAL_FACT | EX-FLASHBOTS](https://docs.flashbots.net/flashbots-protect/overview) Flashbots Protect 文档说明 private RPC 可把交易送入私有流并降低公开抢跑/夹子暴露；这不是所有链、所有 builder 或所有故障情况下的保证。
- [INFERENCE] G3 的 quote 必须包含 `amountOutMin/amountInMax`、deadline、route、pool state block、expected price impact；缺一项则进入 G4 halt/staging。
- [INFERENCE] private orderflow/RPC 也有信任、可用性、审查、延迟和 fallback 风险；fallback 到公共 RPC 前必须重新报价、重新计算 slippage 和检查策略是否仍有 edge。
- [INFERENCE] 对订单簿 venue，front-run/back-run 对应 queue position、maker fill、price drift 和对手单流；不能把 EVM mempool sandwich 模型原样套在 CEX/perp。

## Quote freshness、min-output、deadline

```text
acceptable_quote = quote_block/time is fresh
                   AND route/pool/market unchanged
                   AND expected_out >= min_out
                   AND deadline not expired
                   AND net_edge_after_cost >= threshold
```

- [INFERENCE] `min_out` 不应只由固定百分比决定，应来源于深度、波动、价格源差异、MEV buffer 和策略库存上限。
- [INFERENCE] deadline 保护的是时间陈旧，不保证成交质量；过短会造成失败成本，过长会让旧报价被执行。
- [INFERENCE] quote、submit、inclusion 和 fill 的每个时间戳必须进入审计日志，才能区分模型错误、网络延迟和对手盘选择。

## Nonce、replacement、reorg 与 unknown result

- [VERIFIED_EXTERNAL_FACT | EX-ETH-TX](https://ethereum.org/developers/docs/transactions) nonce 是顺序计数器，交易状态要在区块确认和最终性进程中解释。
- [VERIFIED_EXTERNAL_FACT | EX-ETH-REPLACEMENT](https://eips.ethereum.org/EIPS/eip-2831) Ethereum 的交易替换会让旧 hash 与新 hash 的跟踪变复杂，应用必须把 replacement lineage 作为一等状态。
- [INFERENCE] RPC timeout 不能等同于未上链；状态机必须支持 `UNKNOWN`，先按 nonce/hash/receipt/venue order 查询和对账，再决定是否 replace 或重试。
- [INFERENCE] reorg/finality 风险要求在 shadow 中模拟“已看到 receipt 但状态回滚/重组”的路径；未达到策略所需 finality 前，不应释放 hedge reservation。

## Rust/低延迟的正确位置

- [AUTHOR_CLAIM | CJ:2092322901647372641; CJ:2030179652636209482] 作者将 Rust 与热路径、稳定 CPU 占用关联，并把多 venue、多币种的脚本工程化。
- [INFERENCE] Rust/原生低延迟只能优化确定的 CPU/serialization/queueing 热点，不能修复错误的 price semantics、深度不足、oracle divergence、信用风险或不安全的 retry。
- [INFERENCE] 先用 profiling、p99/p999 latency、slippage-vs-age、fill probability 和 net PnL 证明瓶颈，再考虑迁移；不得把语言选择作为收益假设。

## Real-money proof gate（后续任务适用）

1. [INFERENCE] 完成静态/历史回放、费用/滑点/失败成本和 adversarial MEV 测试。
2. [INFERENCE] 完成 testnet/paper/shadow 的 quote-to-settlement 对账，并证明 unknown result 不会重复下单。
3. [INFERENCE] 建立 per-position/per-strategy notional、inventory、loss、gas、borrow/funding 和 counterparty limits。
4. [INFERENCE] 证明 kill switch、stale data halt、RPC fallback、nonce/replacement 和人工复核可用。
5. [INFERENCE] 通过小规模 forward test 的 out-of-sample 统计；任何数字门槛都要回到 H-CJ 假设，而不是直接写死。

## G3/G4 交付字段

`request_id`、`strategy_id`、`source_quote_id`、`quote_time/block`、`submit_time`、`ack_time`、`tx_hash/order_id`、`nonce`、`replacement_of`、`inclusion_block`、`finality_state`、`min_out/deadline`、`gas_estimate/actual`、`slippage`、`fill`、`failure_code`、`reconciliation_state`。

[INFERENCE] 任何缺失或相互矛盾的字段都应 fail closed；本任务只定义契约，不启用执行。
