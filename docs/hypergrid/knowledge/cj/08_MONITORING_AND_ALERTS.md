# 08 · Monitoring / Alerts

## 监控原则

- [AUTHOR_CLAIM | CJ:1913575205576007986] 作者早期监控现货价、合约价、资金费、价格/交易量异常和现货合约价差，并用报警驱动下一步策略。
- [INFERENCE] HyperGrid 的监控必须把“发现机会”和“证明不能执行”同等重要；每个指标需要 value、source、timestamp/block、freshness、confidence、threshold version。
- [INFERENCE] 告警不是下单命令；所有告警先进入 G5 dashboard / G4 staging，除非经过独立安全策略批准。

## 最小 telemetry schema

| 域 | 必测字段 | 典型用途 |
| --- | --- | --- |
| Pool/CLMM | chain、pool、TVL、active liquidity、tick/bin、price、lower/upper、range state、fee tier | G1/G2 候选与 active/inactive |
| Fee | fee growth、claimed fee、unclaimed fee、fee velocity、incentive/emission | Fee vs IL、APY 解构 |
| Price/vol | canonical price、UI price、mark/index/oracle、realized vol、jump、VWAP/TWAP | 方向/价差、price orientation |
| Flow | swap/order count、buy/sell imbalance、trade size、toxic-flow proxy、depth | adverse selection、capacity |
| Execution | quote age、submit/ack/inclusion/fill times、slippage、min_out、deadline、gas、failed tx | G3 execution quality |
| Venue | bid/ask、order-book depth、funding、basis、OI、borrow/supply APR、limits/status | G7 playbooks |
| Inventory | per token/venue/strategy、USD mark、delta、reserved qty、margin/LTV、liq distance | G4 risk limits |
| PnL | realized/unrealized、fee、IL/HODL、gas、funding/borrow、slippage、counterparty charge | net attribution |
| Infrastructure | RPC latency/quorum、indexer lag、block/slot age、reorg/replacement、error code | stale/unknown state |
| Operations | strategy state、halt reason、restart reason、operator approval、config version | audit/recovery |

## 告警类别

### 数据新鲜度

- [INFERENCE] `DATA_STALE`：source age 超过 strategy-specific TTL、RPC quorum 不一致或 block/slot 不能推进。
- [INFERENCE] `PRICE_DISAGREE`：canonical/mark/index/oracle/venue executable price 超过当前 regime 的允许差异。
- [INFERENCE] `SCHEMA_DRIFT`：API 字段、symbol、asset ID、decimals 或 token ordering 变化。

### LP/grid

- [INFERENCE] `RANGE_NEAR_EDGE`：tick/bin 接近边界，提示库存和退出模拟，不直接 re-center。
- [INFERENCE] `RANGE_OUT`：position inactive；自动策略进入 shadow/exit review。
- [INFERENCE] `FEE_BELOW_COST`：预测 fee velocity 无法覆盖 all-in cost；停止新增库存。
- [INFERENCE] `INVENTORY_SKEW`：净 delta、单 token concentration 或 reserve usage 超过 strategy limit。
- [INFERENCE] `LIQUIDITY_WITHDRAWAL`：TVL/active depth 变化导致 exit impact 超过上限。

### Arbitrage

- [INFERENCE] `EDGE_AFTER_COST`：只有 gross edge 扣除 fee/slippage/gas/funding/borrow/failure reserve 后仍为正，才进入 G7 candidate；数字阈值由假设注册表控制。
- [INFERENCE] `FUNDING/BASIS_SHIFT`：funding、basis、borrow rate 或 oracle spread 快速变化。
- [INFERENCE] `LEG_MISMATCH`：一腿成交、另一腿 unknown/unfilled 或对冲延迟超限。
- [INFERENCE] `LIQUIDATION_DISTANCE`：health factor/margin ratio 接近策略缓冲。

### MEV/执行

- [INFERENCE] `QUOTE_EXPIRED`、`SLIPPAGE_BREACH`、`GAS_UNECONOMIC`、`PRIVATE_ROUTE_DOWN`、`REPLACEMENT_REQUIRED`、`REORG_SUSPECTED`。
- [AUTHOR_CLAIM | CJ:1995702534275825960; CJ:2002222238624592254] 市价失败、滑点太高又亏钱、失败不返结果等场景必须产生结构化事件，而非无限重试。

## PnL / Fee / IL dashboard

[INFERENCE] 每个 position、strategy、venue 和 run 都应显示：

1. `gross_fee` 与 `net_fee`；
2. inventory mark 与 HODL benchmark；
3. realized IL/adverse-selection proxy；
4. gas/trading/borrow/funding/failure reserve；
5. active range uptime、swap/order flow、quote age；
6. realized/unrealized PnL、max drawdown、tail scenario loss；
7. last valid observation block/time 和 evidence/source version。

## Halt / restart reason taxonomy

`STALE_DATA`, `PRICE_ORACLE_DIVERGENCE`, `RANGE_BREAK`, `FEE_BELOW_COST`, `INVENTORY_LIMIT`, `LIQUIDITY_LIMIT`, `SLIPPAGE_LIMIT`, `GAS_LIMIT`, `MEV_RISK`, `LEG_MISMATCH`, `RPC_OUTAGE`, `INDEXER_LAG`, `BORROW_SPIKE`, `LIQUIDATION_RISK`, `VENUE_STATUS`, `TOKEN_RESTRICTION`, `BRIDGE_RISK`, `PROTOCOL_ALERT`, `MANUAL_REVIEW`, `UNKNOWN_STATE`。

[INFERENCE] restart 事件必须引用最近一次 halt、重新验证的数据快照和新的配置版本；“服务恢复”不等于“策略恢复”。

## G5 验收

- [INFERENCE] 每条告警可定位到 source、strategy、position、config version 和 evidence class。
- [INFERENCE] 告警去重使用事件键和时间窗口；重复告警不能隐藏真实 count，也不能触发重复执行。
- [INFERENCE] dashboard 同时展示 raw value、normalized value、threshold 和 backtest/hypothesis status，避免把研究阈值误看成协议常数。
