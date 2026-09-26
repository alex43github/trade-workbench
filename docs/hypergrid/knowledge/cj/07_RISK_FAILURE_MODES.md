# 07 · Risk / Failure Modes

以下登记表把来源中的经验和 HyperGrid 的可执行防线分开。`AUTHOR_CLAIM` 不是风险概率证明；`INFERENCE` 是产品应验证的安全假设。

| 风险/失败模式 | 证据与机制 | 可观测信号 | 处理/归属 |
| --- | --- | --- | --- |
| fee < IL / adverse selection | [AUTHOR_CLAIM | CJ:1930592265342525690; CJ:1889323782663446990] 有“跑不赢无常”的退出描述；[INFERENCE] fee 可能只是 toxic flow 补偿 | fee velocity、HODL delta、post-fill price move | G2 attribution；G4 halt；H-CJ-001 |
| 退出流动性消失 | [AUTHOR_CLAIM | CJ:1913110637544448479] 充提关闭会破坏跨所平仓；[INFERENCE] LP/DEX 也会失去 exit depth | depth、TVL、price impact、withdraw quote | G1/G5 capacity gate |
| 单边库存累积 | [AUTHOR_CLAIM | CJ:1899347899970154794] 计划内跌破后赎回现货；[INFERENCE] 这是方向暴露 | token balances、delta、margin headroom | G2/G6 inventory cap |
| range break | [VERIFIED_EXTERNAL_FACT | EX-UNI-CL](https://developers.uniswap.org/docs/liquidity/overview) 出界停止赚费；[AUTHOR_CLAIM | CJ:1934241999819038740] 倾向撤池 | tick/bin distance、active flag | G4 exit/research |
| gap/jump | [INFERENCE] 价格可跨越多个 levels，逐级成交假设失效 | jump size、block gap、slippage | G2 stress; G4 kill |
| depeg | [INFERENCE] stablecoin/LST/accounting asset 不是同一风险；循环贷和 PT 都依赖锚 | peg deviation、oracle spread、borrow LTV | G1 reject; G4 repay/de-risk |
| protocol exploit | [INFERENCE] LP、lending、Pendle、bridge 任一合约失效都可吞噬本金 | paused/admin/upgrade/oracle/events | G4 denylist; no auto approval |
| oracle/index divergence | [VERIFIED_EXTERNAL_FACT | EX-HL-FUNDING](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding) funding 使用 oracle price；[INFERENCE] mark/index/oracle 差异会影响两腿 | mark/index/oracle/last spread | G1/G7 reject; G4 hedge |
| RPC/indexer outage | [AUTHOR_CLAIM | CJ:1931626940806598927] 公共节点暴露与执行风险；[INFERENCE] stale read 不能当作空状态 | block age、slot lag、response quorum | G4 stale halt |
| stale quote | [INFERENCE] 价格/深度/fee 在提交前变化即可反转 edge | quote age、price drift | G3 re-quote or abort |
| chain congestion | [VERIFIED_EXTERNAL_FACT | EX-ETH-GAS](https://ethereum.org/developers/docs/gas/) gas/priority fee 随拥堵变化且失败可能有成本 | base/priority fee、mempool age | G1 cost gate; G4 pause |
| MEV extraction | [AUTHOR_CLAIM | CJ:1931626940806598927] 夹子风险；[VERIFIED_EXTERNAL_FACT | EX-FLASHBOTS](https://docs.flashbots.net/flashbots-protect/overview) 私有流可降低部分暴露 | route impact、sandwich signature、private/public path | G3 min-output/private path |
| borrow-rate spike | [INFERENCE] 循环贷净利差可被浮动 borrow rate 吞掉 | supply/borrow APR、utilization | G7 sensitivity; G4 unwind |
| liquidation | [INFERENCE] leveraged perp/borrow/PT loop 的抵押率跨过阈值会强平 | health factor、margin ratio、liq distance | G4 buffer/kill |
| exchange/account/counterparty | [AUTHOR_CLAIM | CJ:2000566478199050383; CJ:2086612620136874076] 平台限制/口碑/接口差异影响策略；[INFERENCE] 非链上也有账户冻结和信用风险 | venue status、withdrawal、account limits | G7 exposure cap |
| token tax/transfer restriction | [INFERENCE] 新 token 可限制转账/收税/黑名单，导致 CEX/DEX 价差无法收敛 | transfer simulation、code/admin flags、actual received | G1 hard reject |
| chain bridge risk | [INFERENCE] 跨链转移时间和桥合约风险使“跨链对冲”不即时 | bridge status、pending age、proof/finality | G7 separate capital; G4 no assumption |
| new-chain edge decay | [AUTHOR_CLAIM | CJ:2092322901647372641; CJ:2095407005544685712] 早期收益会因专业资金进入而下滑 | edge half-life、participant mix、volume/TVL | G1 expiry/re-score |
| operational key/security | [INFERENCE] 任何签名/权限/密钥泄露都可超过策略损失 | key scope, signer health, audit log | G4 isolated staging; no secrets in KB |

## 统一安全不变量

- [INFERENCE] 任意单腿成交、unknown result、状态冲突、旧 quote、过期 block、负/NaN 数值或无法确认 ownership 都必须 fail closed。
- [INFERENCE] 任何“可回撤收益”不得抵扣未实现的 tail risk；风险限额以 worst-case inventory、liquidation、exit depth 和 correlation stress 计算。
- [INFERENCE] 每次 halt 必须有可审计原因，restart 必须重新获取数据、重算成本和得到策略/人工批准。
- [OBSERVATION | task gate] 本任务不读取、保存或使用 private keys、seed phrases、cookies、auth headers，不连接生产钱包，不发送交易。

## 风险优先级

P0：可能导致无界损失、重复执行、无法退出、错误方向或安全边界绕过；P1：可控但影响收益/可用性；P2：展示/研究质量问题。

[INFERENCE] G4 在任何 P0 事件下停机；G5 必须保留事件和证据；G7 先用历史/纸面数据证明恢复路径，不能用 live 资金验证安全假设。
