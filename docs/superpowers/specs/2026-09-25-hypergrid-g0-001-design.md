# HyperGrid G0 Design

## Goal

建立 HyperEVM 上 PRJX V3 的只读研究与诊断基础层。G0 只负责链与池发现、代币元数据、可复现的整数价格计算、快照 JSON、健康状态和安全 CLI；不包含签名、交易、授权、执行器或生产部署。

## Scope and safety boundary

- 只允许通过注入的 JSON-RPC transport 读取 `eth_chainId`、`eth_blockNumber`、`eth_getBlockByNumber`、`eth_gasPrice`、`eth_call` 和 `eth_getCode`。
- `CapabilityGuard` 在 RPC 请求入口拒绝不在只读 allowlist 中的方法，因此模块没有 signer、账户、密钥、交易构造或发送路径。
- 所有地址、链 ID、区块号和价格方向都必须显式记录；未知信息返回 `UNKNOWN`，不通过 symbol、decimals 或协议名称猜测。
- 价格使用 `bigint` 有理数计算并格式化为十进制字符串；不使用浮点数参与报价、PnL 或网格决策。
- CLI 默认输出 JSON，提供 `discover --pool` 和 `health` 两个只读命令；未知参数失败关闭。
- 实现位于独立 worktree，G0 不部署、不连接或修改 VPS，不触碰现有 Binance/Bybit 执行链路。

## Components

### ChainClientReadOnly

`ChainClientReadOnly` 接收 `fetch`、RPC URL、超时和 `CapabilityGuard`。它负责 JSON-RPC envelope、请求 ID、超时、RPC error 归一化、十六进制解析和区块单调性检查。transport 是依赖注入的，测试无需网络，真实 CLI 使用官方 HyperEVM RPC。

### TokenMetadataReader

调用 ERC-20 的 `decimals()`、`symbol()`、`name()` selector，支持 ABI 动态字符串和 bytes32 兼容解码。单项失败不生成猜测值；返回 `null` 与 `UNKNOWN` 证据。decimals 超出 `0..255` 或 malformed ABI 时报告结构化错误。

### PRJXV3PoolReader / PoolDiscoveryReader

`PoolDiscoveryReader` 使用 PRJX factory 的 `getPool(tokenA, tokenB, fee)` 做只读发现。`PRJXV3PoolReader` 读取 `factory()`、`token0()`、`token1()`、`fee()`、`tickSpacing()`、`slot0()`、`liquidity()` 和 code existence，并在地址、代码或 ABI 不满足时阻断。

快照以最新区块号和 hash 作为来源；读取前后区块变化时最多重试一次，无法得到一致窗口则返回 stale 错误。零流动性是可观测状态，不伪造价格或转为执行信号。

### PriceMath

Uniswap V3/PRJX V3 的 raw ratio 为：

```text
raw_token1_per_token0 = sqrtPriceX96^2 / 2^192
human_token1_per_token0 = raw * 10^decimals0 / 10^decimals1
```

模块同时返回 `token1_per_token0` 和倒数 `token0_per_token1`，每个 quote 带 `base_token`、`quote_token`、`orientation`、`source_block` 和 `verification_status`。所有中间量为 `bigint`；十进制展示采用明确的最大位数和整数舍入。

### CapabilityGuard and health

Capability guard 是不可绕过的读取能力边界。健康状态由 chain ID、最新区块、RPC 延迟、错误和 stale window 推导为 `HEALTHY`、`DEGRADED`、`STALE` 或 `BLOCKED`，不等价于交易可用。

## Data contracts

版本化 JSON 合约位于 `docs/hypergrid`，实现类型位于 `lib/hypergrid/types.ts`：

- `TokenIdentity`：地址、symbol/name/decimals、验证状态和证据。
- `PoolIdentity`：factory、pool、token0/token1、fee、tickSpacing、接口版本。
- `PriceQuote`：显式 base/quote、精确字符串价格、方向、区块和来源。
- `PoolSnapshot`：快照区块、slot0、liquidity、代币身份、双向价格、健康和错误。
- `ProtocolFact`：带来源 URL、链上证据、时间和 `VERIFIED/OBSERVED/INFERRED/UNKNOWN` 标签的事实。

字段使用 snake_case，未知值使用 `null`，不使用未声明的隐式字段。

## Error handling

- malformed JSON-RPC、HTTP 非 2xx、RPC error、超时和无 code 地址分别归一为稳定错误类。
- stale block、zero address、非 hex、错误 ABI、非法 pool 和不支持的接口必须在 CLI 层返回非零退出码或 `BLOCKED` 健康状态。
- 代币元数据缺少时保留地址和错误证据；价格因 decimals 不可得而为 `null`，绝不填 18 或依据名称推断。
- 不实现自动重连或无限重试；未来可在 market-data 层加入有上限的 429/5xx backoff，不能改变 G0 的只读边界。

## Research decisions

- HyperEVM 官方 EVM RPC 为 `https://rpc.hyperliquid.xyz/evm`，chain ID 为 999；官方文档说明默认 RPC 不提供 EVM JSON-RPC WebSocket，Hyperliquid 的 `wss://api.hyperliquid.xyz/ws` 是另一套 WebSocket API。
- HYPE 是原生 gas 资产，18 decimals；WHYPE 合约地址和 ERC-20 元数据由链上读取确认。
- PRJX factory/pool 是 HyperEVM 上源码验证的 Uniswap V3-family 部署；PerpMe 文档列出 PRJX 地址，但不把 PerpMe 当作 PRJX 官方身份。部署专属 router/quoter/position manager 的行为在 G0 只记录为事实，不接入执行。
- 示例池选用通过 factory `getPool(PERPME, WHYPE, 10000)` 实际发现的 `0x89510e6631c103746a4afb80fda30b5ee747f21c`，不从 token 地址或外部 analytics 猜地址。

## Acceptance

1. 至少 18 个专项测试覆盖链 ID、RPC malformed/timeout、地址/code、decimals、方向、sqrt math、zero liquidity、unknown token、invalid pool、unsupported interface、stale block、guard、JSON、CLI 安全边界。
2. `npm run build` 通过；HyperGrid 专项测试全绿；全仓 baseline failure 单独记录，不隐藏或修复无关功能。
3. 真实官方 RPC 只执行读取调用并生成 PERPME/WHYPE 快照；没有发送、授权、签名或部署调用。
4. 静态审计显示新生产实现没有交易能力；文档和负向测试中出现的禁用词必须标记为安全审计材料。
