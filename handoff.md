# Trade Workbench — 第三方审计交接文档

更新时间：2026-09-11（Asia/Shanghai）  
审计代码仓库：`https://github.com/alex43github/trade-workbench`（公开审计仓库）  
审计基线提交：`70977423ff6c463cb152010ad3f2e4ff369bd7ce`  
部署目标：VPS `root@139.59.99.126`，应用目录 `/opt/trade-workbench`

> 本文档记录用户提出的产品/交易需求、实现状态、已部署范围与已知风险。状态只能说明代码、测试或服务健康检查的证据；**不代表已经用真实订单完整验证，更不代表交易策略有效或安全。**

## 1. 审计范围与安全边界

### 当前架构

```text
浏览器 / Telegram
       │
       ▼
Trade Workbench（Vinext / React，127.0.0.1:3000）
       │
       ├─ Binance Gateway（127.0.0.1:8788）
       ├─ Bybit Gateway（127.0.0.1:8789）
       ├─ SQLite（/var/lib/trade-workbench/sqlite/d1.sqlite）
       └─ systemd 定时任务：保护策略、雷达维护
```

### 不在 Git 仓库中的敏感数据

- Binance、Bybit、Telegram、Bark、AI Provider 的密钥和 Token；保存在 VPS 环境文件或服务端密钥存储。
- 真实订单、持仓、策略状态和 SQLite 数据库。
- 本地 `.local/d1.sqlite`：已在 `.gitignore` 中排除，未上传 GitHub。
- `.env*`、私钥、证书、构建缓存和 `node_modules`：均不应上传。

### 2026-09-11 的 VPS 健康核验

以下均为只读核验，不代表真实下单验证：

| 项目 | 结果 |
|---|---|
| `trade-workbench.service` | `active` |
| `binance-gateway.service` | `active` |
| `bybit-gateway.service` | `active` |
| `trade-workbench-protection-strategy.timer` | `active` |
| `trade-workbench-maintenance.timer` | `active` |
| `GET /trade` | HTTP 200 |
| `GET /api/watchlist` | HTTP 200 |
| `GET /api/radar/atr-band` | HTTP 200 |

## 2. 用户提出的需求与现状

### A. 网站总体与交易终端

| 需求 | 当前实现状态 | 部署状态 / 审计备注 |
|---|---|---|
| 专业交易终端、K 线、多周期、MA/EMA/ATR、持仓和订单展示 | 已有实现 | 已部署；需要浏览器和真实只读账户数据做独立验收。 |
| Binance Futures 账户读取与交易网关 | 已实现网关和网站调用链 | 已部署，网关服务 active；审计应重点检查签名、权限、幂等、限额和错误处理。 |
| Bybit 实盘接入、页面显示和 Telegram 支持 | 已实现代码与独立网关 | 已部署，Bybit 网关 active；本轮未用真实 Bybit 委托进行端到端验收。 |
| 实盘操作必须可控、不能无确认下单 | 有多层开关、确认和策略链路 | 已部署；请审计所有 POST 路由、网关策略和开关默认值，不能仅相信 UI。 |
| Binance/Bybit 选择与实盘总开关点击分离 | 已实现 | 已部署；点击币安/Bybit 只切换交易所，开关区域才改变对应实盘开关。 |

### B. Telegram

| 需求 | 当前实现状态 | 部署状态 / 审计备注 |
|---|---|---|
| Telegram 下单和保护指令恢复 | 处理器、合约与策略桥接已在代码中 | 已部署；此前“无响应”经用户确认是 Telegram 端问题，而非本次代码修复结果。应实际发送测试消息验证 webhook、bot token 和回调。 |
| Telegram 手动保护比例：25/50/75/100，默认 100 | 已实现 | 已部署；Telegram 菜单/处理器有回归测试。 |
| Telegram 策略订单内部归属 `tele` | 已实现 | 已部署；仅为本站内部标识，不改交易所原始 clientOrderId。 |

### C. 手动持仓保护与止损（高风险）

#### 用户确认的业务规则

1. 设置固定价格、均线或 ATR 止损时，**不得立刻向交易所挂/发止损单**。
2. 必须等到未来某根指定周期 K 线**收盘**确认：多头收盘跌破；空头收盘突破。
3. 第一次确认失效：退出受保护数量的 50%。
4. 之后只要任意再次满足失效条件（中间可恢复、间隔不限制）：退出该保护策略剩余数量的 100%。
5. 手动保护可选保护 25%、50%、75%、100%，默认 100%。
6. 用户在 Binance 网页/iOS/macOS/iPad 手动开的仓，在本站显示/归属为 `ios`，不应改写交易所原始 clientOrderId。

#### 当前代码状态

| 项目 | 状态 | 证据 / 限制 |
|---|---|---|
| 固定价 `LEVEL_SL` 不在创建时提交 native STOP_MARKET | 已实现 | `protection-strategies.ts`；回归测试覆盖“保持本地等待闭 K”。 |
| 首次失效减半、任意后续再次失效清余仓 | 已实现 | `protection-executor.ts`；`tests/protection-executor.test.mjs` 有固定价两阶段测试。 |
| MA/ATR 保护同样按已收盘 K 执行 | 已实现 | 保护策略定时器每分钟运行；测试覆盖 MA 两阶段。 |
| 保护比例 | 已实现 | 网页 API、终端 UI 和 Telegram 均有路径。 |
| 订单归属别名 | 已实现 | 手动来源使用 `ios`；网页策略使用 `str`；Telegram 使用 `tele`。 |
| 手动原始订单识别 | 已修复已知候选为空问题 | 已部署；应以真实、不同来源/部分成交订单进行回归。 |

#### 必须审计/尚未完全满足的点

- **“下一根 K 线开盘时”不是交易所级精确保证。** 当前执行器由每分钟 systemd 轮询，在识别到上一根已收盘 K 后发送市价减仓。因此它是“闭 K 后尽快执行”，可能晚于下一根 K 的精确开盘价。若业务必须精确到开盘，需要改为交易所 WebSocket/K 线收盘事件驱动，并定义失败重试与滑点上限。
- 保护数量是**创建时绑定的来源数量**。例如为原始 10U 建保护后再自行加 100U，旧保护只管理原 10U（第一次约 5U，第二次余下约 5U），不会自动覆盖 110U。用户已询问并确认这一现状；“新增仓位自动合并至既有保护”尚未实现。
- 策略执行仍需要逐交易所、单向/双向持仓、部分成交、撤单、订单查询失败、重复 K 线、重启恢复、并发执行和极端波动场景的真实或沙盒验收。

### D. 自选币四分组与来源清理

#### 用户确认的分组规则

1. **主流币**：永久保留。
2. **持仓币**：任何 Binance 或 Bybit 当前持仓都必须显示。
3. **手动自选**：只能由用户自行添加/取消。
4. **机器自选**：由每小时筛选结果维护；符合保留，不符合自动移除。
5. 分组间必须有实线分隔。

#### 当前实现与数据状态

| 项目 | 状态 | 备注 |
|---|---|---|
| 来源表和优先级（PINNED / POSITION / MANUAL / ATR_STRONG_1H） | 已实现并部署 | 同一币种只显示一次，优先级为主流、持仓、手动、机器。 |
| Binance + Bybit 持仓来源同步 | 已实现 | 代码与回归测试覆盖；当前 VPS 数据只看到 Binance 持仓来源 3 条，是否没有 Bybit 持仓须以交易所实时数据为准。 |
| 终端四分组 UI 与实线 | 已实现 | 已部署；需浏览器视觉验收。 |
| 2026-09-09 来源重置 | 已执行于 VPS 数据库 | 主流来源 5 个、持仓来源 3 个保留；全部机器来源清空；手动只保留 `KOMAUSDT`。执行前创建 SQLite 在线备份。 |
| KOMA 同时有持仓和手动来源时的显示 | 已知行为 | 因优先级会显示在“持仓”；平仓后仍保留手动来源，显示在“手动”。 |

### E. 机器自选：MA30 ± ATR 强势扫描

#### 用户确认的筛选规则

- 自北京时间每日 08:00 起，每小时执行一次全盘 1H 扫描（实际任务安排在收盘后约 08:05 起）。
- 连续 3 根**已收盘 1H K**高于 `MA30 + 1 ATR` 或低于 `MA30 - 1 ATR` 的币进入机器自选。
- 强度排序：在 ±1ATR 外维持越久越靠前；稳定在 +2ATR / +3ATR 或 -2ATR / -3ATR 的优先级更高。
- 北京时间 00/04/08/12/16/20 的 4H 收盘点：不做第二次全市场扫描，只对已通过 1H 的强势池做 4H 确认并提高排序。
- 扫描不追求即时展示结果，应降低频率，避免触发 Binance 风控。

#### 当前实现

| 项目 | 状态 | 备注 |
|---|---|---|
| 1H 连续 3 根、MA30±1ATR 条件 | 已实现 | ATR 生命周期扫描以 `multiplier: 1` 调用。 |
| 强度排序 | 已实现 | 持续根数、ATR 延伸距离、4H 确认共同影响排序。 |
| 4H 只确认 1H 强势池 | 已实现并有单测 | 不扩大 1H 候选集合。 |
| 每小时运行窗口 | 已实现 | 维护计划限定北京时间 08:05–23:05；与早期“全天每小时”描述不同，以用户后续确认的“每天早上 8 点开始”为准。 |
| 维护请求过慢导致超时 | 已修复设计 | ATR 扫描独立派发，维护请求用 header 跳过重复 ATR 全盘扫描。 |

#### 仍需验证

- 没有留存“重置后完整生产扫描成功、机器来源写入/淘汰正确”的端到端证据。服务和 `/api/radar/atr-band` 均健康，但第三方应检查定时器日志、Binance API 限流、实际扫描耗时、数据库 scan bucket 与自选增删结果。
- 4H 的确认时刻以扫描运行时的北京时间小时判断；需要审计是否严格对应“已闭合 4H K”且时钟漂移可控。
- 当前代码里一些旧页面文案/历史策略可能仍写 `±3ATR`，而机器自选正式规则是 `±1ATR`；需做产品文案和代码路径审计，避免用户理解混淆。

## 3. 用户多次要求但没有“真实验收完成”的事项

以下不是指功能一定不存在，而是用户多次要求推进/修复后，当前缺乏足够的端到端证据，不能宣称已完成：

1. **Telegram 新保护单“未全部受理/认不到单”**：候选发现和别名逻辑已修改并有单元测试；没有用用户当日 KOMA/MARSCOIN 真实订单重现并验收。
2. **精确在下一根 K 开盘执行的闭 K 止损**：当前是分钟轮询后的市价执行，尚非精确事件驱动实现。
3. **所有固定价止损相关代码的完整覆盖性**：已修改主要 `LEVEL_SL` 和执行器路径；第三方应全局搜索 native stop、conditional order、strategy executor、Telegram handler 和 API route，确认不存在旧的“设置即下单”旁路。
4. **新增手动仓位自动纳入既有保护**：未实现，且现有行为明确是不自动合并。
5. **机器自选从零开始后的真实小时扫描效果**：代码、定时器和接口已部署，但没有生产扫描结果的验收记录。
6. **Telegram 传输稳定性**：用户确认某次故障来自 Telegram 端；代码层没有证明可以抵御第三方平台故障。

## 4. 已部署到 VPS 的本轮改动

部署日期：2026-09-08；随后 2026-09-09 进行了仅数据库来源清理。

### 已同步并构建的主要模块

- 手动保护：`app/api/trade/manual-protection/route.ts`、`lib/trade/alex-positions.ts`、`lib/trade/protection-*`。
- 订单归属：`lib/trade/order-alias.ts`、`lib/trade/order-source.ts`。
- Telegram：`lib/telegram/contracts.ts`、`lib/telegram/handler.ts`。
- 自选：`lib/watchlist.ts`、`app/api/watchlist/route.ts`、`app/watchlist/useWatchlist.ts`、终端 UI/CSS。
- 机器扫描：`app/api/radar/atr-band/route.ts`、`lib/radar/atr-band-lifecycle*`、`lib/radar/binance-public.ts`、维护调度文件。
- 交易终端开关：`app/trade/TradingTerminal.tsx`、`app/trade/trade.module.css`。
- 数据库迁移/兼容：`db/ensure.ts`。

### 已执行的验证

- 本地聚焦回归测试：47/47 通过（保护、Telegram、归属、自选、扫描、维护和开关相关测试）。
- 本地生产构建：通过。
- VPS 生产构建：通过。
- 重启后服务/定时器/关键 HTTP 端点健康：见第 1 节。

### 未部署或不能断言已部署的内容

- `/Users/niangao/Downloads/交易文档/trade-workbench` 目录中存在更广泛、未与 VPS 部署基线逐文件核对的改动。**不要把它自动视为线上版本，也不要直接覆盖 VPS。**
- 本 GitHub 审计快照基于当时的已部署工作区 `/private/tmp/trade-workbench-vps-stream.Qul4vC`，不包含数据库、环境文件和未验证的本地改动。
- 第三方若要审计“当前 VPS 的精确字节级源码”，应通过只读 SSH 比对 `/opt/trade-workbench` 的提交哈希/文件校验和；当前 VPS 非 Git 工作区时，使用 `sha256sum` 对关键文件比对。

## 5. 面向第三方审计的重点清单

### P0：真实资金与订单安全

- 检查所有下单路径：网页 API、Telegram webhook、保护执行器、Binance Gateway、Bybit Gateway。
- 确认开关在**服务端**强制执行；UI 状态不得作为唯一防线。
- 验证 `reduceOnly`、side、position side、quantity、tickSize、stepSize、minNotional、重复 clientOrderId 和超时重试。
- 验证保护策略不会在创建时提前下 native stop；验证每次市价退出不会超出策略剩余数量。
- 审查部分成交、撤单、订单查询失败、重复 K 线、重启恢复、并发执行和极端波动时的状态机。
- 审查 Binance/Bybit API key 最小权限、IP 白名单、禁止提现和日志脱敏。

### P1：权限与数据安全

- 检查所有环境变量、错误日志、前端 bundle、Git 历史，确认不泄露密钥或持仓数据。
- 检查 operator/scheduler 鉴权、Telegram webhook path/secret、CORS/CSRF 和本地回环网关暴露面。
- 审计 SQLite 迁移的幂等性、备份/恢复流程与并发写入。

### P2：策略/调度正确性

- 验证 K 线“已收盘”定义、时区、scan bucket 和 1H/4H 对齐。
- 验证 MA30/ATR 的计算、缺失数据、零 ATR、历史回放、排序和自动移除机器来源。
- 检查一分钟轮询与用户期望的“下一根 K 开盘”之间的偏差；提出事件驱动替代方案。
- 审查持仓来源同步：Binance/Bybit 失败时不能错误移除持仓自选。

### P3：可维护性和审计性

- 旧规格、旧测试和页面文案中存在历史策略/参数，确认它们没有仍在生产路径生效。
- 所有新改动应有最小回归测试；审查测试是否只做静态字符串匹配而缺乏行为验证。
- 将部署流程改为可复现发布：不可变构建、版本号、数据库迁移记录、回滚包、健康检查和发布记录。

## 6. 后续维护规则

1. 以当前 GitHub `main` 的审计提交和 VPS `/opt/trade-workbench` 为基线；先比较，后修改。
2. 交易/保护逻辑的任何改动必须先补失败测试，再实现，再做本地构建和 VPS 健康检查。
3. 未经用户明确确认，不执行真实下单、撤单、平仓、调整杠杆或更改实盘开关。
4. 不要上传 `.env`、SQLite、Token、私钥、订单/持仓导出。
5. 生产问题必须给出：复现证据、受影响订单/策略、修复提交、测试结果和部署后验证；不得仅回复“正在进行”。

## 7. 关键路径索引

| 领域 | 代码位置 |
|---|---|
| 手动保护创建与策略持久化 | `lib/trade/protection-strategies.ts` |
| 闭 K 保护执行器 | `lib/trade/protection-executor.ts` |
| 保护策略定时任务 | `services/workbench/protection-strategy-scheduler.mjs` |
| Telegram 交互 | `lib/telegram/handler.ts`、`lib/telegram/contracts.ts` |
| 订单来源/别名 | `lib/trade/order-source.ts`、`lib/trade/order-alias.ts` |
| 自选来源与同步 | `lib/watchlist.ts`、`lib/trade/watchlist-position-sync.ts` |
| MA30/ATR 生命周期扫描 | `lib/radar/atr-band-lifecycle-snapshot.ts` |
| 扫描 API | `app/api/radar/atr-band/route.ts` |
| 维护调度 | `services/workbench/maintenance-schedule.mjs`、`services/workbench/maintenance-scheduler.mjs` |
| 交易终端 UI | `app/trade/TradingTerminal.tsx` |
| 数据库 schema/兼容迁移 | `db/ensure.ts` |
| 部署与 systemd 模板 | `deploy/` |
