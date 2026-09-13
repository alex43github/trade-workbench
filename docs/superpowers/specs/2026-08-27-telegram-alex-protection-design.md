# Telegram 实盘来源隔离与止盈止损策略设计

日期：2026-08-27

## 目标

Telegram 菜单只展示实盘内容，并增加“挂止盈止损策略单”入口。该入口只允许为用户手动创建、且已成交的币安原生来源持仓挂保护策略；Telegram 创建的策略使用 `tele` 来源，网站创建的策略使用 `web` 来源。每个币种/方向的原生手动来源合并为一个候选，同时保留币安返回的原始 `clientOrderId`；保护数量只覆盖手动部分，任何一个来源的出场条件都不能直接退出其他来源的仓位。

开发、测试、构建和部署阶段不发送真实 Binance 订单；真实下单只发生在用户通过已授权 Telegram 私聊完成最终确认后，并继续受网站实盘开关与 Binance 网关交易开关共同控制。

## 已确认规则

### 订单来源编号

| 来源 | 适用范围 | 新建 Binance `clientOrderId` |
| --- | --- | --- |
| `alex` | Workbench 手动市价/限价操作，以及 Workbench 手动保护流程产生的保护单 | `alex...` |
| `tele` | Telegram 创建的限价入场单及该入场单的止盈止损单 | `tele...` |
| `web` | 网站创建的策略单及该策略单的止盈止损单 | `web...` |

已在 Binance 手机、网页或 iPad 原生端创建的手动订单，其原始 `clientOrderId` 不能事后改写，也不需要再人为拼接前缀；服务端直接保存并展示该原始编号。只要订单带有原始 `clientOrderId`、不是 `alex`、`tele`、`web` 或 `tw` 项目前缀，且是已成交的非只减仓开仓订单，就可作为币安原生手动来源；其中现有 `ios_coin_*`、`ios_st_*` 编号会原样显示。没有原始 `clientOrderId` 的订单不会被猜测归类，也不会用 `binance-订单号` 伪造来源编号。历史项目订单编号不重命名，新功能产生的订单按上述前缀执行。

### 来源与仓位隔离

1. 可选持仓必须同时满足：当前非零持仓、存在带原始 `clientOrderId` 的已成交非只减仓开仓订单、该订单不以 `alex`、`tele`、`web` 或 `tw` 项目前缀开头，且方向与当前持仓方向一致。
2. 同一币种、方向和持仓模式的手动开仓订单合并为一个候选；候选显示手动数量/名义/估算保证金、其他来源数量/名义和当前总持仓，并保留全部原始 `clientOrderId`。
3. Telegram 创建的 `tele` 订单、网站创建的 `web` 订单、Workbench 手动创建的 `alex` 订单和 `tw` 历史项目订单不进入原生手动选择列表。
4. 保护策略绑定到来源订单集合与稳定成交批次，而不是只绑定 `symbol`。策略保存基准入场价、初始数量、剩余数量、方向、杠杆和规则快照。
4. 每次触发退出前重新读取当前仓位和该批次账本剩余数量，退出数量不得超过两者的较小值。若外部手动操作导致来源数量无法可靠对账，策略进入 `RECONCILIATION_REQUIRED`，不拿其他编号的仓位补齐。
5. Binance 单向持仓可能把同币种同方向仓位合并显示，因此交易所侧只能按数量执行，来源隔离由服务端账本和保护单数量保证；系统不得擅自切换 Hedge Mode。若账本与交易所仓位不一致，以暂停保护和人工对账为安全结果。

### 默认止盈

默认止盈使用 ROI/保证金收益率口径，基准为用户在选择时确认、最终提交前再次读取的当前持仓快照：

- ROI 达到 100%：退出该来源初始数量的 25%；
- ROI 达到 200%：退出该来源初始数量的 40%；
- 剩余数量继续由该来源自己的保护规则管理。

多头触发价为 `entryPrice × (1 + roi / leverage)`，空头触发价为 `entryPrice × (1 - roi / leverage)`。触发价按合约 tick size 处理，并在方向错误、无法形成正价格或不满足交易所过滤器时拒绝挂单。默认止盈保护单使用 Binance 原生 `TAKE_PROFIT_MARKET`、只减仓和来源专属数量。

### 固定点位止盈

用户手动输入一个价格，服务端按当前方向校验价格必须位于盈利方向，按 tick size 规范化，并为该来源当前剩余数量创建一个 `TAKE_PROFIT_MARKET` 只减仓保护单。提交前重新读取仓位，数量不足或仓位消失时不提交。

### 均线止损

用户选择均线止损后选择周期，默认 `1h`；默认参数为 `SMA30 + ATR14 + 1 ATR`。执行器只使用已收盘 K 线：

- 多头收盘跌破 `MA - ATR × 1`，或空头收盘突破 `MA + ATR × 1`，计为一根失效 K 线；
- 第一根连续失效 K 线，提交该来源剩余数量的 50% 的 `MARKET` 只减仓单；
- 第二根连续失效 K 线，提交该来源剩余仓位；
- K 线恢复安全侧时，连续失效计数归零；
- 每次执行前重新读取来源剩余数量，仓位消失则关闭策略。

均线止损不在创建时伪造一个 Binance 挂单，而是持久化为 VPS 执行器任务；执行器必须使用稳定的 `alexSL...`、`teleSL...` 或 `webSL...` client ID 并支持重启恢复。

### 支撑阻力止损

用户手动输入一个价格，服务端按当前方向校验多头价格低于当前参考价、空头价格高于当前参考价，按 tick size 处理，并创建该来源当前剩余数量的 `STOP_MARKET` 只减仓保护单。它只绑定当前来源策略，不监听同币种其他来源。

## Telegram 交互

首页不再出现 `PAPER`、`模拟`、`纸面` 或模拟入口，固定菜单为：

```text
建立实盘策略 | 实盘持仓
实盘挂单     | 实盘策略管理
挂止盈止损策略单
```

原有 PAPER 后端表、网页兼容接口和历史数据不删除，但 Telegram 不读取、不展示、不提供进入按钮。

保护策略流程如下：

1. 点击“挂止盈止损策略单”。服务端读取当前非零仓位，按币种/方向合并符合手动来源条件的订单，并为每个分组生成短期会话候选项。
2. 用 inline keyboard 展示币名、方向、手动数量、手动名义和其他来源数量。callback 只携带不可推断的短 token，例如 `alex_asset_a1`，不携带 symbol、价格、数量或订单编号；真实候选映射只保存在服务端会话。
3. 点击币种后选择“止盈策略”或“止损策略”。
4. 止盈选择“默认止盈”或“固定点位止盈”；固定点位进入数字输入步骤。
5. 止损选择“均线止损”或“支撑阻力线止损”；均线止损进入周期选择，支撑阻力线止损进入数字输入步骤。
6. 展示来源订单、当前数量、规则和预计保护数量的最终摘要；只有“确认挂策略单”按钮会执行。确认 nonce 单次有效，重复回调不重复下单。
7. 提交成功、部分成功、拒绝或待对账均展示每个保护单的来源前缀、策略编号、Binance 订单编号和安全状态，但不展示密钥、签名或未脱敏异常。

Telegram 新建入场策略也移除模式选择并固定为实盘。其新入场单以及后续保护单统一使用 `tele` 前缀；网站入口的新策略及保护单统一使用 `web` 前缀。

## 数据与状态

新增通用保护策略账本，支持三种来源但默认由 Telegram `alex` 流程使用：

```text
trade_protection_strategies
  id, origin, source_order_id, source_fill_id, symbol, side,
  strategy_type, status, config_json, initial_quantity,
  remaining_quantity, entry_price, leverage, revision,
  created_at, updated_at

trade_protection_orders
  id, strategy_id, origin, stage, client_order_id,
  exchange_order_id, symbol, side, type, quantity, stop_price,
  status, executed_quantity, error, revision, created_at, updated_at

trade_protection_events
  id, strategy_id, type, payload_json, created_at
```

策略状态为：

```text
DRAFT -> ACTIVE -> PARTIALLY_PROTECTED -> TRIGGERING -> CLOSED
                    |                     |
                    +-> RECONCILIATION_REQUIRED
                    +-> CANCELED
```

策略订单保存网站归属编号、稳定 client ID、Binance order ID、规则快照、实际成交数量和错误状态。提交超时必须先按 client ID 查询，再决定是否进入待对账；不得盲目重试。

## 服务端组件

### 来源识别

新增 `getAlexManualPositions()` 服务：先读取 `positionRisk`，再按非零持仓 symbol 查询 `allOrders`，筛选带原始 `clientOrderId`、已成交、非只减仓、排除 `alex`/`tele`/`web`/`tw` 项目前缀且方向匹配的开仓订单，按币种/方向合并，并计算手动/其他来源金额。服务不改写原始 Binance 编号，也不在读取候选时创建 `alex` 别名。

### 网关

只增加最小必要的只读路径 `GET /fapi/v1/allOrders` 和行情读取路径 `GET /fapi/v1/klines`，以及已批准的 `STOP_MARKET`、`TAKE_PROFIT_MARKET`、`MARKET` 只减仓下单参数校验。继续拒绝提现、转账、资金划转、杠杆修改、保证金模式修改和其他未列出的路径。

### 保护策略提交

新增共享服务接收 `origin: "TELEGRAM" | "WEB"`、来源订单归属和保护规则。它负责最终读取仓位、exchangeInfo、杠杆和精度，生成策略账本、稳定的前缀订单编号、原生保护单并保存回执。Telegram handler 只负责身份、会话和一次性确认；不得直接拼接 Binance 请求。

### 均线执行器

新增 systemd 可运行的 VPS 保护调度器，按策略周期扫描已收盘 K 线，使用账本 revision/lease 防止多实例重复退出。每个来源策略分别计算连续失效状态；同一币种不同来源不共享计数、止损目标或剩余数量。

## 错误处理与安全

- 没有符合条件的手动持仓：只回复没有可挂保护策略的手动持仓，不创建订单。
- 实盘开关、Telegram 身份、账户、网关或 Binance 权限未满足：不创建策略单。
- 固定价格方向、tick size、step size、最小名义金额或来源数量校验失败：保留会话并要求重新输入，不提交。
- 同一个来源已有同类型活动保护策略：拒绝重复创建，避免双重保护；不自动覆盖。
- 多个默认止盈或保护单部分成功：保存已接受订单，停止后续猜测，状态设为 `RECONCILIATION_REQUIRED`。
- Binance 网络超时：按稳定 client ID 查询；查询不到明确结果时保留待对账，不重试产生新 ID。
- 保护单的数量永远不超过当前交易所持仓和该来源账本剩余数量的较小值。

## 测试与验收

- Telegram 首页及所有回复文本不包含 PAPER/模拟/纸面入口。
- callback 不包含 symbol、价格、数量、订单编号或敏感字段；篡改候选 token、过期会话和重复确认均被拒绝。
- 按币种/方向合并带原始 `clientOrderId` 的已成交手动开仓订单，排除 `alex`、`tele`、`web`、`tw` 项目订单、无原始客户编号、只减仓保护单和未成交订单，并正确计算手动/其他来源金额。
- ROI 100%/200% 触发价按杠杆和多空方向正确计算，数量为 25%/40% 的来源初始数量。
- 固定止盈与支撑阻力止损生成正确原生类型、触发价、只减仓标记和来源前缀。
- 均线止损只处理闭合 K 线，首根减半、第二根清仓，恢复安全侧重置计数，并在重启/重复扫描时不重复下单。
- 两个来源同币种持仓的保护规则相互独立；一个来源数量不足时进入待对账，不从另一个来源借量。
- 网关默认关闭交易；假网关验证允许/拒绝路由、超时查单和幂等，不访问真实 Binance。
- 运行 Telegram、保护策略、网关、数据库迁移和既有交易回归测试，之后执行类型检查、生产构建和 `git diff --check`。
- 部署只同步应用代码，不覆盖 `/etc/trade-workbench/workbench.env`、数据库或密钥；部署期间不调用下单接口。
