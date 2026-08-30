# Binance 与 Bybit 双实盘交易设计

日期：2026-08-30

## 目标

在保留现有 Binance USDⓈ-M 实盘能力与所有安全门禁的前提下，增加 Bybit USDT 永续（V5 `linear`）的等价实盘能力。网页和 Telegram 均须在交易开始前明确选择交易所；选择结果绑定到策略、订单、保护单和通知，之后不可通过界面切换而改路由。

Bybit 仅用于中长线策略：策略与均线保护周期只允许 `1h`、`4h`、`1d`。Binance 保持现有 `5m`、`15m`、`1h`、`4h`、`1d` 可选范围。

## 不变量与非目标

- 新增 Bybit 覆盖既有“仅 Binance”的功能规格；其余最终确认、管理员身份、幂等、对账与不自动重试规则保持不变。
- 两个交易所的 API 凭据、网关 token、交易开关、账户状态和订单编号命名空间完全隔离；密钥绝不进入浏览器、Telegram、数据库或日志。
- 仅支持 USDT 永续：Binance USDⓈ-M 和 Bybit V5 `linear`。不支持现货、期权、反向合约、转账、提现、修改杠杆或保证金模式。
- 开发、测试、构建、部署、切换交易所和连接账户都不得发送真实订单。真实交易只能来自授权网页/Telegram 的单次最终确认，并同时受对应交易所开关约束。

## 架构

新增统一的 `LiveExchange` 枚举：`BINANCE | BYBIT`。策略与订单账本、保护策略、审计事件、归档和通知记录都持久化 `exchange`；已有记录在迁移中设为 `BINANCE`。

业务层只依赖受限的交易所适配器接口：

```text
instrument(symbol) / account() / position(symbol) / openOrders(symbol)
submitLimit(input) / submitReduceOnlyMarket(input) / cancel(input)
findByClientId(input) / closedCandles(symbol, timeframe)
```

`BinanceLiveAdapter` 封装现有 Binance Gateway；`BybitLiveAdapter` 封装新的 Bybit Gateway。适配器负责各自的符号规则、tick/step size、最小名义金额、持仓模式、订单状态和查询协议；策略提交器、保护执行器与 Telegram handler 不得直接拼接任一家交易所请求。

Bybit 下单使用 V5 `POST /v5/order/create`、`category=linear`、唯一 `orderLinkId`。限价入场和限价止盈均使用 `timeInForce=PostOnly`；止损/减仓使用受限的 `reduceOnly` 参数。Bybit 下单确认是异步受理，提交后必须以 `orderId`/`orderLinkId` 查询确认，未知结果进入 `RECONCILIATION_REQUIRED`，不得以新编号自动重发。

## 网关与凭据

保留 loopback-only 的 Binance Gateway，并新增独立 loopback-only Bybit Gateway。两者不共享端口、token、环境变量、API key、API secret 或交易开关：

```text
BINANCE_GATEWAY_*                 # 现有 Binance 网关
BYBIT_GATEWAY_BASE_URL
BYBIT_GATEWAY_TOKEN
BYBIT_GATEWAY_API_KEY
BYBIT_GATEWAY_API_SECRET
BYBIT_GATEWAY_TRADING=false
```

Bybit Gateway 只允许账户、持仓、合约规则、K 线、未成交单、按 `orderLinkId` 查询、精确创建订单和精确撤单等最小路径。所有其他 V5 路径默认拒绝。网关只监听 `127.0.0.1`，仅接受来自 Workbench 的 token；浏览器和 Telegram 都只能调用 Workbench API。

网页的“连接 Bybit 账户”是配置状态与连通性入口，不是将 key 输入浏览器。用户在 VPS 的 root-owned 环境文件中填写 Bybit 凭据后，网页只显示已连接/未配置、只读健康状态和交易开关状态。

## 网页交互

交易页顶部状态精简为一个可点击的 `实盘：可下单` / `实盘：未就绪` 状态，不再展示单独的系统止损/实盘开关方框。交易所入口紧邻该状态：`BINANCE`、`BYBIT`。

选择某交易所后，账户、持仓、挂单、策略和策略向导都仅显示该交易所数据；策略确认页醒目标明交易所。切换交易所不会取消、修改或隐藏另一家交易所的已存在策略，已存在策略在其所属交易所标签下可见。

Bybit 选中时，周期控件只渲染 `1h`、`4h`、`1d`，并在 API 和服务端 schema 再次校验。Binance 延续现有可选周期。所有策略、保护、Toast 和订单记录都显示交易所标签，防止同名合约混淆。

## Telegram 流程

在“默认下单”“完整策略”“挂止盈止损策略单”开始时，机器人先用 inline keyboard 询问：`在 Binance 操作` 或 `在 Bybit 操作`。服务器会话保存 `exchange`，回调只携带不透明 action token，绝不携带币种、价格、数量或凭据。

选 Bybit 后：

1. 仅展示/接受 `1h`、`4h`、`1d`。
2. 持仓、挂单和手动保护候选仅查询 Bybit。
3. 摘要、最终确认、策略管理和异步通知明确显示 `BYBIT`。
4. 所有创建、撤销、止盈和止损仅通过 Bybit Gateway 执行。

Binance 的现有 Telegram 行为保持不变。一个会话只能绑定一家交易所；取消或过期后必须重新选择。

## 数据、迁移与策略执行

在 live strategy、live order、attempt、protection strategy/order/event 和必要的归档表中新增非空 `exchange` 字段，并新增适当的 `(exchange, symbol, status)` 索引。迁移以事务执行，并将历史行写为 `BINANCE`；无法安全迁移时停止启动，禁止猜测。

订单客户标识保持全局可审计并加交易所前缀，例如 `webBN...`、`teleBN...`、`webBY...`、`teleBY...`。外部原生手动订单的来源保留原编号，但记录其所属交易所。

重锚、成交对账、默认止盈、均线止损、横向止损和取消操作均从策略的 `exchange` 解析适配器。每次保护性减仓前重新读取同一交易所的真实仓位，数量永远不超过来源账本剩余数量与交易所仓位的较小值。Bybit 策略只扫描三种允许的闭合 K 线周期。

## 错误处理

- 选中 Bybit 但未配置、连通性失败、未开启 `BYBIT_GATEWAY_TRADING` 或无权限：拒绝最终确认，不创建部分策略或订单。
- Bybit 合约规则、余额、持仓模式、价格/数量精度或最小名义金额校验失败：保留草稿并返回脱敏原因。
- 提交超时：先按稳定 `orderLinkId` 查询；查不到则标记 `UNKNOWN`/`RECONCILIATION_REQUIRED`，绝不重复下单。
- 任一策略或保护操作绝不跨交易所撤单、平仓或读取仓位。
- 任何网关/账户状态异常均显示为未就绪；不能因为 Binance 已开启而推断 Bybit 可下单，反之亦然。

## 测试与验收

- 迁移后所有历史 Binance 策略、订单与保护记录均带 `BINANCE`，且仍可查看、取消和对账。
- Fake Binance 与 Fake Bybit Gateway 分别验证允许路径、拒绝路径、独立 token、独立开关、签名和无真实网络请求。
- Bybit 仅接受 `1h`、`4h`、`1d`；网页、Telegram、API 与执行器任一层都拒绝其他周期。
- 同一 `BTCUSDT` 的 Binance 与 Bybit 策略可同时存在，查询、撤单、成交对账和保护操作完全隔离。
- Bybit 订单使用唯一 `orderLinkId`，异步受理后通过查询确认；超时不重复下单。
- Telegram 的交换所选择持久于短期会话，篡改/过期/重复 callback 被拒绝；最终确认仍一次性有效。
- 所有策略下达、成交、策略触发和保护状态变化的 Toast/Telegram 通知都带交易所标识。
- 完整回归、类型检查、生产构建与 `git diff --check` 通过；上线前先使用 fake gateway 与只读账户连通性验证，不下真实订单。
