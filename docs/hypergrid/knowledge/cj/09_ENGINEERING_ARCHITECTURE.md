# 09 · Engineering Architecture

## 目标

- [INFERENCE] 把“研究素材”变成可回放的数据、可审计的状态机和可否决的风险门，而不是把作者规则直接写进交易代码。
- [OBSERVATION | CJ:1999368017130738171; CJ:2030179652636209482] 归档体现了从单个脚本、监控、网格、套利到综合系统的演进；本库保留这种模块化线索，但不复制具体实现或凭经验启用 live path。

## 分层

```text
Public archive / official docs
        ↓
Source manifest + evidence registry
        ↓
Market / protocol adapters (read-only first)
        ↓
Canonical event + price + position model
        ↓
Replay / shadow grid / PnL attribution
        ↓
Risk engine + hypothesis evaluator
        ↓
G4 staging / manual approval / kill switch
        ↓
G3 execution adapter (future task only)
        ↓
Reconciliation + audit + dashboard
```

## 数据契约

### `SourceRecord`

`source_id`, `date_utc`, `url`, `topic_tags`, `handbook_topic_ids`, `evidence_class`, `source_commit`, `content_policy`。不包含正文、cookie、auth header、私钥或钱包信息。

### `MarketSnapshot`

`chain/venue`, `instrument_id`, `token0/token1`, `canonical_price`, `mark/index/oracle`, `bid/ask/depth`, `tick/bin/range`, `fee`, `funding/borrow`, `block/slot`, `observed_at`, `source_age`, `schema_version`。

### `PositionSnapshot`

`strategy_id`, `generation`, `venue`, `asset`, `quantity`, `avg_price`, `delta`, `reserved`, `margin/LTV`, `liquidation_distance`, `fee_accrued`, `benchmark_value`, `pnl_components`, `as_of`。

### `ExecutionEvent`

`request_id`, `logical_event_id`, `quote_id`, `client_order/tx_id`, `nonce`, `replacement_of`, `min_out`, `deadline`, `submitted_at`, `ack_at`, `included_at`, `fill`, `failure_code`, `reconciliation_state`。

[INFERENCE] 这些契约支持 CEX、perp、CLMM、DLMM、lending 和 event market，但适配器必须声明哪些字段不可用；用 `null + reason` 代替臆造。

## 状态与故障

- [INFERENCE] 读取层使用 quorum/freshness 校验；source disagreement、schema drift 或 stale read 进入 `UNKNOWN`。
- [INFERENCE] shadow engine 以历史 block/order-book/swap 流重放，生成 fill/slippage/gas/funding/borrow/MEV sensitivity；它不签名交易。
- [INFERENCE] risk engine 独立于策略 engine，拥有最终 halt 权；策略不能绕过 inventory、notional、loss、counterparty、protocol 或 data freshness limits。
- [INFERENCE] execution adapter 的每次请求先过 deterministic risk check，再使用 idempotency key；timeout 后先 reconcile，不能无条件重提。
- [INFERENCE] reconciliation 以 authoritative venue/on-chain state 为准，保存 replacement/reorg/partial-fill/unknown 证据。

## 适配器规则

- [VERIFIED_EXTERNAL_FACT | EX-MET-DLMM](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/index.mdx) Meteora 开发者集成应依赖官方 IDL、SDK、链上账户和 Data API；不能把网页 APR 当作协议状态。
- [VERIFIED_EXTERNAL_FACT | EX-HL-API](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals) Hyperliquid API 区分 perp metadata、asset context、funding history、account state 等查询；适配器必须保留 endpoint semantics。
- [INFERENCE] 每个 venue 适配器都要有 `readOnly`、`shadow`、`staged` 三种能力声明；没有测试和安全审查的 adapter 只能 read-only。

## 语言与性能

- [AUTHOR_CLAIM | CJ:2092322901647372641] 作者偏好 Rust 热路径；[INFERENCE] 采用与否由 profiling、p99/p999、slippage-vs-age 和维护成本决定。
- [INFERENCE] 低延迟模块和风险模块解耦：优化不能绕过 stale quote、min-output、deadline、risk check 或 reconciliation。
- [INFERENCE] 先用现有栈构建可回放 reference implementation，只有 measured bottleneck 才迁移单个热路径；避免为“微秒”引入不可审计的复杂度。

## 安全隔离

- [INFERENCE] 研究数据、影子数据、staging 配置与生产凭证物理/逻辑分离；本知识库不存任何秘密。
- [INFERENCE] 真正的 signer、RPC auth、exchange key、wallet address allowlist 和 approval scope 只能在后续明确授权任务中接入，并默认最小权限。
- [OBSERVATION | task gate] 本任务没有修改 Binance/Bybit gateway，没有连接生产账户，没有部署或重启服务。
