# tvscreener 只读市场信息源设计规格

日期：2026-08-27
状态：已实现并部署到 VPS（2026-08-28）。实现位于 `services/tvscreener/`、`lib/radar/tvscreener.ts`、`app/api/radar/tvscreener/route.ts` 与雷达页面；sidecar 只提供只读研究数据。
产品性质：市场筛选与 AI 研究辅助；不改变交易执行链路

## 1. 目标

在现有 `trade-workbench` 中增加一个隔离的 TradingView Screener 只读适配器，用于补充全市场候选币筛选和技术指标上下文。它服务于市场雷达和 AI 分析，不负责账户、持仓、挂单、风控、条件单或任何真实/模拟订单执行。

第一阶段只验证并展示以下信息：

- 候选交易对、交易所标识和 Binance 标准化符号；
- 价格、涨跌幅、成交量、相对成交量、波动率等市场概览；
- RSI、MACD、SMA/EMA、ATR 等可用技术指标；
- 5m、15m、1h、4h、1d 等多周期字段及数据时间；
- 数据源、抓取时间、数据年龄、字段缺失和映射警告。

## 2. 已确认边界

### 2.1 必须保持不变

- Binance Futures 仍是当前 K 线、收盘状态、持仓、挂单和动态 MA/ATR 条件判断的唯一执行依据。
- tvscreener 的结果不能直接触发下单、撤单、止盈、止损、加仓、减仓、杠杆修改或保证金模式修改。
- AI 只能把 tvscreener 当作带来源和时间戳的辅助证据，不能因为该数据源单独改变订单状态。
- tvscreener 不接触 Binance API Key、Secret、Bark Token、管理员令牌或 Telegram Token。
- 适配器不可用时，现有 Binance 雷达和交易页面继续工作，只显示“TradingView 补充源不可用”。
- 第一阶段不把 tvscreener 指标混入现有雷达评分、风险否决或条件单状态机，避免改变已有行为。

### 2.2 不在本阶段实现

- 用 TradingView 数据替代 Binance WebSocket/REST K 线。
- 用 TradingView 数据作为止损触发、成交确认、标记价格或账户盈亏依据。
- 浏览器直接调用 TradingView Screener 或让用户提交任意原始筛选 JSON。
- 高频轮询、逐笔行情、订单簿、历史逐笔成交、资金费率和 Binance 账户数据。
- 根据 tvscreener 自动生成或自动执行交易建议。
- 直接跟随 GitHub `main` 分支；依赖必须在验证后固定到明确版本。

## 3. 方案与选择

### 3.1 方案 A：Node 进程内调用 Python

不采用。当前网站为 Node/TypeScript，直接在请求中启动 Python 会导致冷启动、进程回收、错误隔离和超时控制复杂化，也容易把外部数据源故障传递到网页请求。

### 3.2 方案 B：本机回环 Python 只读 sidecar（采用）

部署一个仅监听 `127.0.0.1` 的 Python sidecar。Node 端通过一个很小的 TypeScript client 调用固定 JSON 接口；sidecar 内部使用 tvscreener，负责筛选、字段选择、结果规范化和 TradingView 请求错误分类。这样可以把 Python 依赖和外部接口变化隔离在一个边界内，也方便单独停止或替换。

数据流：

```text
浏览器 → Node API → tvscreener client → 127.0.0.1 Python sidecar → TradingView Screener
                  └→ Binance gateway / public API（执行和交易状态仍走这里）
```

### 3.3 方案 C：只做离线脚本，不接网站

可用于一次性探测，但无法持续为雷达和 AI 提供可追溯的补充字段，因此只作为第一阶段的验证工具，不作为最终集成形态。

## 4. 服务接口

sidecar 只提供两个回环接口：

### `GET /healthz`

返回服务版本、依赖版本、最近一次成功请求时间和当前熔断状态；不返回任何环境变量。

### `POST /v1/screen`

Node 端只允许提交结构化白名单参数：

```json
{
  "assetType": "crypto",
  "symbols": ["BINANCE:BTCUSDT", "BINANCE:ETHUSDT"],
  "intervals": ["15", "60", "240", "1D"],
  "fields": ["PRICE", "CHANGE_PERCENT", "VOLUME", "RSI", "SMA_30", "EMA_30", "ATR_14"],
  "sortBy": "VOLUME",
  "limit": 25
}
```

sidecar 必须拒绝未支持的 `assetType`、字段、周期、排序字段和超过上限的数量；不得把浏览器输入直接拼接成 TradingView 请求字段。需要广泛筛选时，由服务端选择固定的预设查询，例如“高成交量”“动量”“超卖”“低波动”，而不是开放任意查询。

规范化响应：

```ts
type TvScreenerCoverage = "live" | "partial" | "stale" | "unavailable";

type TvScreenerRow = {
  tvSymbol: string;
  exchange: string | null;
  rawSymbol: string | null;
  binanceSymbol: string | null;
  values: Record<string, number | string | null>;
  intervalValues: Record<string, Record<string, number | null>>;
  warnings: string[];
};

type TvScreenerResponse = {
  source: "tradingview-screener";
  requestId: string;
  fetchedAt: string;
  coverage: TvScreenerCoverage;
  rows: TvScreenerRow[];
  warnings: string[];
};
```

字段不存在、结果为 NaN、Ticker 无法映射或某周期不支持时保留行并写入 `null` 和警告，不能用 0 冒充真实值。

## 5. 数据和符号策略

- 使用 `CryptoScreener` 作为交易对筛选的首选探测入口；`CoinScreener` 仅用于市场规模、供应量等币种层信息，不能当作 Binance 交易对行情。
- `FuturesScreener` 仅在实际验证出能稳定映射到目标合约时启用；文档中的传统期货示例不能推断其已经覆盖 Binance USDⓈ-M 永续。
- Binance 映射以当前 Binance `exchangeInfo` 为准；必须同时满足 `TRADING`、`PERPETUAL` 和 `quoteAsset=USDT` 才能生成 `binanceSymbol`。
- 无法确认交易所、合约类型或报价资产时，结果可以展示为研究候选，但不能进入现有 Binance 合约雷达的执行候选集合。
- 保存 `tvSymbol`、`binanceSymbol`、来源时间、周期和字段名，方便发现 TradingView 与 Binance 的交易对、价格类型或合约状态差异。

## 6. Node 集成位置

- 新增 `lib/radar/tvscreener.ts`：定义响应类型、回环 client、超时、请求白名单、标准化和错误分类。
- 新增 `services/tvscreener/`：Python sidecar、固定版本依赖、配置、HTTP 入口和本地测试。
- 新增 `/api/radar/tvscreener`：只读页面接口，返回缓存结果和明确的来源状态；浏览器不直接接触 sidecar。
- 修改 `app/api/radar/route.ts`：并列返回可选 `tvScreener` 补充证据，不改变现有 `score`、`participation`、风险否决和候选生命周期。
- 修改 `app/radar/page.tsx`：新增独立的“TradingView 补充信息”区域，展示候选列表、字段、周期、时间戳、映射状态和警告。
- 修改 `app/trade/AdaptiveStrategyPanel.tsx` 或其 AI 输入构造处：只把经过规范化的少量补充字段作为 `research_evidence` 传给 AI，并标注 `advisory_only`；不把它传给订单执行器。
- 新增 `tests/tvscreener-adapter.test.mjs`、`tests/tvscreener-api.test.mjs` 和 sidecar 的 Python 单元测试。
- 新增部署示例和运行说明；sidecar 不增加 Caddy 公网路由。

## 7. 缓存、限流和故障处理

- Node 端按查询指纹缓存 30 秒；同一查询在进行中只能有一个请求，其他请求复用进行中的 Promise 或最近缓存。
- sidecar 请求超时为 10 秒；连续失败后短暂熔断，页面保留最近一次结果并标记 `stale`，不伪造实时状态。
- 适配器只做低频筛选刷新，不参与 1m 行情流和动态止损循环；初始刷新间隔不低于 30 秒。
- 每次响应记录 `requestId`、HTTP 状态类别、耗时、字段缺失、映射失败数量和数据年龄；日志不得包含密钥或完整请求头。
- TradingView 返回异常、接口结构变化、限流或 sidecar 退出时，Node API 返回结构化 `coverage` 和警告，现有 Binance 数据照常返回。
- 只有 `coverage=live` 或 `partial` 的补充信息可以展示为当前数据；`stale` 和 `unavailable` 必须显式显示。

## 8. AI 使用规则

AI 输入中增加独立字段：

```json
{
  "research_evidence": {
    "source": "tradingview-screener",
    "advisory_only": true,
    "fetched_at": "2026-08-27T00:00:00.000Z",
    "rows": [],
    "warnings": []
  }
}
```

提示词必须说明：该证据不是 Binance 成交行情，不可用于证明订单已成交或触发止损；如与 Binance K 线、价格或合约状态冲突，以 Binance 为准并记录冲突。AI 不能通过该字段调用 sidecar、改写筛选条件或发起任何交易动作。

## 9. 验收标准

### 9.1 只读探测

- sidecar 在本地回环启动，健康检查成功；BTCUSDT、ETHUSDT 和至少一个可用小币种完成查询。
- 至少验证 15m、1h、4h、1d 中的价格、成交量、RSI、SMA/EMA 和 ATR 字段；不支持的字段必须是 `null + warning`。
- Binance 符号映射只接受已确认的 USDT 永续；映射失败不会进入交易执行数据。
- 对同一时间窗口记录 TradingView 与 Binance 的数据差异，不把差异静默覆盖；验证报告明确哪些字段适合展示、哪些字段只能参考。

### 9.2 网站回归

- `/api/radar/tvscreener` 能返回 `live`、`stale`、`unavailable` 三类可测试状态。
- sidecar 停止时 `/api/radar`、交易页、币种下拉框、持仓和挂单查询仍可用。
- tvscreener 数据不会改变既有雷达评分、风险否决、策略状态、模拟成交或实盘开关。
- 浏览器不会获得 sidecar 内部地址、环境变量或任何交易密钥。

### 9.3 部署安全

- Python 依赖固定到经过验证的稳定版本，并与 Node 依赖隔离。
- VPS sidecar 仅监听 `127.0.0.1`，systemd 失败自动重启但不会影响主网站启动。
- 部署后确认 `BINANCE_GATEWAY_TRADING=false`，没有新增真实下单或撤单路径。

## 10. 风险与后续决策

- TradingView Screener 是非官方公开接口，可能出现条款、限流、字段或响应结构变化；适配器必须可独立关闭。
- tvscreener 当前 README 与 `pyproject.toml` 的版本描述存在不一致，实施时以实际发布包和源码版本核验结果为准，不盲信 README。
- 第一阶段只展示补充信息并提供给 AI 研究上下文；是否将某些字段纳入雷达评分，必须在完成对照样本和前向观察后另行确认。
- 如未来需要把 tvscreener 作为候选筛选器，仍需先经过 Binance 合约清单过滤、数据新鲜度门控和审计日志，不能直接把 TradingView 行作为条件单触发源。
