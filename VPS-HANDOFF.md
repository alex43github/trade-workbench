# 当前 VPS 线上版 Trade Workbench：AI 升级交接文档

更新时间：2026-09-08  
适用项目：`trade-workbench`  
文档定位：当前 VPS 网站的维护、排障、升级和后续模型交接入口。

后续每一个修改、修复、升级或部署需求还必须遵守 [`PROJECT-MODIFICATION-PROMPT.md`](PROJECT-MODIFICATION-PROMPT.md)，并在 [`change-logs/INDEX.md`](change-logs/INDEX.md) 中创建或续写唯一需求日志。没有 VPS 实际验证证据时，不得声称已经上线成功。

多个对话并行开发时，必须再遵守 [`CONCURRENT-DEVELOPMENT-PROTOCOL.md`](CONCURRENT-DEVELOPMENT-PROTOCOL.md)：任务在独立 worktree/branch 中开发，先集成到最新 `main` 再测试，且只有单一发布者能从确定的主线 commit 发布到 VPS。

> 这份文档只针对当前 VPS 上的新版 Trade Workbench。旧的 `binance-ma-stoploss` 本地项目、旧模拟盘和旧网页工作台不属于本项目升级范围。
>
> 本文不保存任何 API Key、Secret、管理员 Token、Telegram Token、Bark Key 或 SSH 私钥。后续模型必须通过 VPS 上的受保护环境文件读取配置状态，不得把密钥打印到终端、日志、截图、Git 或聊天内容中。

## 0. 先看结论

当前网站的实际目标是一个私有的个人交易工作台，主线是：

```text
真实 Binance 行情 / OI / 账户只读数据
        ↓
雷达与结构筛选
        ↓
交易图表、计划、策略与风控检查
        ↓
人工确认后的实盘策略或保护动作
        ↓
订单归档、持仓同步、通知与复盘
```

当前生产部署的核心边界：

- 公网只有 Caddy 的 HTTPS 入口；网站本身监听 `127.0.0.1:3000`。
- Binance 网关监听 `127.0.0.1:8788`，只允许网站服务通过回环地址调用。
- Binance 私有 API 的出口应为 VPS 固定公网 IPv4；该 IP 用于 Binance API 白名单。
- SQLite 数据库和雷达状态在 `/var/lib/trade-workbench`，不在发布目录 `/opt/trade-workbench` 内。
- 管理员登录使用 `OPERATOR_ACCESS_TOKEN`，服务端换发短期 HttpOnly 会话 Cookie。
- 真实交易通道必须同时满足网关开关、网站实盘开关、账户/参数校验和用户最终确认；默认关闭。
- `PAPER` 模拟策略调度器在当前部署中已退役，timer 必须保持禁用。
- TradingView Screener sidecar 已从当前生产运行时移除；行情、雷达、MA/ATR、持仓和交易状态以 Binance 数据为准。

当前本地工作区的 `main` 分支存在大量未提交改动和删除/新增文件。不能把本地 `HEAD` 自动等同于 VPS 正在运行的版本，也不能使用 `git reset --hard`、`git checkout --` 或批量删除来“清理”工作区。

## 1. VPS 登录与网站登录

### 1.1 SSH 登录 VPS

项目历史部署记录中的当前目标主机是：

```text
root@139.59.99.126
```

使用本机已经配置好的 SSH Agent 或私钥登录：

```bash
ssh root@139.59.99.126
```

如果本机没有自动找到密钥，使用用户已有的 SSH 私钥路径显式登录；不要把私钥复制进项目目录或文档。登录后先确认主机和部署状态：

```bash
hostname
date -Is
systemctl status trade-workbench.service --no-pager
systemctl status binance-gateway.service --no-pager
systemctl list-timers --all | grep -E 'trade-workbench|protection|maintenance|paper'
ss -ltnp | grep -E ':(80|443|3000|8788|8790)'
```

注意：项目仓库里的 `workbench.example.com` 是 Caddy 配置占位符，不一定是当前真实域名。真实域名应以 VPS 上 `/etc/caddy/Caddyfile` 的当前配置和 DNS 为准，不要猜测。

### 1.2 浏览器登录网站

1. 用当前真实 HTTPS 域名打开网站；根路径 `/` 会跳转到 `/radar`。
2. 点击页面右下角的“安全登录”，或直接访问 `/signin`。
3. 输入 VPS 环境文件中的 `OPERATOR_ACCESS_TOKEN`。
4. 服务端验证成功后签发 HttpOnly、Secure、SameSite=Strict 会话 Cookie；令牌不会保存到 Local Storage、Session Storage、URL 或数据库。

生产环境密钥文件位置：

```text
/etc/trade-workbench/workbench.env
```

生产文件应由 `root:root` 持有，权限 `0600`。网页设置页在 VPS 正式环境通常只读，页面提示“请通过 VPS 配置密钥”时，应 SSH 后编辑环境文件并重启服务，不要在网页输入框中反复尝试。

### 1.3 只读页面与受保护操作

`OperatorGate` 包裹全站，但公开行情页面可以显示未登录状态。登录后才允许：

- 读取 Binance 账户、持仓、活动委托和订单归档；
- 创建、取消或执行受保护的策略操作；
- 运行需要人工触发的雷达扫描；
- 运行 AI 计划复核和专家会诊；
- 切换服务端 AI 通道；
- 查看或请求部署 Webhook；
- 使用实盘相关的页面操作。

生产环境不要依赖本地开发的回环免登录逻辑。`hasLocalTestAccess` 只允许符合条件的本机回环请求，公网域名必须经过管理员会话。

## 2. 当前线上架构

```text
浏览器 / iPad
      │ HTTPS 443
      ▼
Caddy（公网唯一入口，自动 TLS）
      │ reverse_proxy 127.0.0.1:3000
      ▼
Trade Workbench（Next/Vinext，systemd）
      │
      ├── SQLite：/var/lib/trade-workbench/sqlite/d1.sqlite
      ├── 雷达/扫描状态：/var/lib/trade-workbench/...
      ├── 定时维护：内部 API + Binance 公开数据
      ├── 保护策略执行器：内部 API + 已收盘 K 线
      └── Binance Gateway：127.0.0.1:8788
             │ 固定 VPS 出口 IPv4
             ▼
          Binance Futures API
```

### 2.1 目录和端口

| 位置/端口 | 用途 | 公网要求 |
|---|---|---|
| `/opt/trade-workbench` | 网站发布代码、构建产物、部署脚本 | 不放密钥；服务账户不应可写发布目录 |
| `/var/lib/trade-workbench` | SQLite、备份、扫描状态、服务日志 | 只允许服务账户和 root 按需访问 |
| `/etc/trade-workbench/workbench.env` | 生产环境变量和所有服务端密钥 | `root:root`、`0600` |
| `/etc/caddy/Caddyfile` | HTTPS 域名与反向代理配置 | Caddy 唯一公网入口 |
| `127.0.0.1:3000` | 网站服务 | 不开放防火墙，不直接对外代理 |
| `127.0.0.1:8788` | Binance 固定 IP 网关 | 不开放防火墙，不使用公网 IP 调用 |
| `127.0.0.1:8790` | 可选结构雷达 sidecar | 不开放防火墙；未运行时页面应显示断开 |
| `80/443` | Caddy HTTP/HTTPS | 公网允许 |
| SSH | VPS 管理 | 最好再由云厂商防火墙限制来源 IP/VPN |

### 2.2 服务单元

| systemd 单元 | 作用 | 当前处理方式 |
|---|---|---|
| `trade-workbench.service` | 启动网站，执行 `npm run start -- --hostname 127.0.0.1 --port 3000` | 生产主服务 |
| `binance-gateway.service` | 在 `127.0.0.1:8788` 转发并签名 Binance 请求 | 生产主服务 |
| `trade-workbench-maintenance.timer` | 按北京时间收盘节奏触发雷达维护、快照、Bark 去重通知 | 应保持启用 |
| `trade-workbench-protection-strategy.timer` | 每分钟调用内部保护策略执行入口 | 默认有安全开关；是否产生真实退出由服务端配置决定 |
| `trade-workbench-paper-strategy.timer` | 旧 PAPER 策略调度器 | 当前部署必须保持禁用 |
| `caddy.service` | HTTPS 和反向代理 | 公网入口 |
| `structure-radar` 独立服务 | 强势结构雷达本机扫描 | 可选；先检查是否实际安装/运行 |

## 3. 网站页面模块与目的

以下以当前代码实际路由为准，而不是只以历史 README 的产品设想为准。

### `/radar`：主雷达和候选发现

这是当前首页的主工作区，负责把“市场上值得进一步研究的币”筛出来，而不是直接给出无条件买入信号。

主要职责：

- 汇总 Binance Futures 公开行情、成交量、波动率、OI、资金费率和多空数据；
- 在配置了 `SQUARE_MONITOR_BASE_URL` 时吸收 Binance Square 热度/喊空/套牢等外部线索；
- 展示热门币、短空拥挤、价格/OI 背离、筹码和链上数据槽位；
- 展示 MA30 × OI、多周期 MA30、Vegas、MA30 ± ATR 生命周期和破底翻/结构反转候选；
- 对数据不足、扫描失败、缓存过期和降级来源明确标记；
- 支持人工刷新/筛选，部分扫描由定时维护服务执行；
- 通过 Bark 对“新增候选/状态变化”做去重通知，不把重复扫描当成新机会。

重要语义：

- `上榜`、`候选`、`高分` 都只代表研究优先级，不等于买入或做空指令；
- `2/4 同向`可以形成条件机会，分歧应保留，不应被 UI 强行压成单一结论；
- 没有真实数据时必须显示 `pending`、`degraded` 或 `demo` 等真实状态，不能用样例数据冒充实时数据。

相关代码：

- 页面：`app/radar/page.tsx`
- 主接口：`app/api/radar/route.ts`
- 细筛：`app/api/radar/multitimeframe/route.ts`
- MA30 × OI：`app/api/radar/ma30-oi/route.ts`、`lib/radar/ma30-oi.ts`
- 结构反转：`app/api/radar/reversal/route.ts`、`lib/radar/reversal*.ts`
- ATR 生命周期：`app/api/radar/atr-band/route.ts`、`lib/radar/atr-band*.ts`
- 综合排序：`app/api/radar/composite/route.ts`、`lib/radar/composite-ranking.ts`
- Bark/候选去重：`lib/radar/bark-notifications.ts`、`lib/radar/alert-diff.ts`

### `/trade`：图表、账户、策略和受控执行

这是交易操作主页面，不是简单行情图。

主要职责：

- 显示 Binance Futures K 线、成交量和 TradingView Lightweight Charts 风格指标；
- 支持 MA、EMA、Anchored VWAP、Fixed Range Volume Profile、Vegas 和 ATR 通道等指标开关/参数；
- 读取真实账户摘要、持仓、挂单、条件单和活动策略；
- 没有持仓时展示建仓计划；有持仓时切换为加仓、减仓、止损、止盈和退出管理；
- 将自然语言计划解析为结构化草案，先做触发、失效、止损、止盈、仓位和禁做条件检查；
- 显示实盘策略状态、策略腿、订单生命周期、成交与保护线；
- 允许在人工确认后进入受控的真实订单链路；
- 读取账户从有持仓到无持仓的变化，归档订单并生成复盘候选；
- 所有金额、价格、数量都必须服从交易所精度、最小名义价值和仓位模式约束。

相关代码：

- 页面容器：`app/trade/page.tsx`、`app/trade/TradingTerminal.tsx`
- 图表：`app/trade/TradeChart.tsx`
- 策略构建：`app/trade/StrategyWizard.tsx`、`AdaptiveStrategyPanel.tsx`
- 快捷实盘策略：`QuickLiveStrategyPanel.tsx`、`lib/trade/quick-live*.ts`
- 实盘策略：`lib/trade/live-*.ts`
- 保护策略：`lib/trade/protection-*.ts`
- 订单归档/来源：`lib/trade/order-archive*.ts`、`order-source.ts`
- 复盘：`app/trade/TradeReviewDashboard.tsx`、`lib/trade/review-*.ts`

### `/settings`：服务端连接诊断和受控配置

设置页的目的不是把密钥交给浏览器，而是让用户看到服务端依赖是否正常。

显示/管理内容：

- Binance 公开行情、固定 IP 网关和只读账户状态；
- 当前 AI 供应商、模型、可用通道和告警；
- Square 采集器状态；
- Bark 是否配置；
- 部署 Webhook 是否配置、版本/构建状态；
- 在本地可写环境中对凭据做受控保存；在正式 VPS 上凭据区域应是只读提示；
- AI 通道连通性测试、手动激活和任务路由摘要。

相关代码：`app/settings/page.tsx`、`app/settings/ConnectionSettings.tsx`、`app/api/connections/route.ts`、`app/api/credentials/route.ts`、`app/api/deployment/route.ts`。

### `/reviews`：操作复盘和知识沉淀

展示判断、执行、结果三类信息，用于分析：

- 计划是否按规则执行；
- 成交/退出是否能和来源策略对应；
- 结果是否为精确成交结果还是只读持仓变化推算；
- 哪些错误、信号和规则值得写入操作知识库。

相关代码：`app/reviews/page.tsx`、`app/trade/TradeReviewDashboard.tsx`、`app/api/trade/review/*`、`lib/trade/review-*`。

### `/structure-radar`：本机结构雷达

该页面连接可选的本机 `structure-radar` 服务，面向全部 Binance USDT 永续合约扫描：

- 平台假跌破后收回；
- 下降趋势线突破；
- 15m/1h/4h 已收盘结构；
- ICT、街哥、静心、bit浪浪四专家的 R1/R2/R3 独立判断和 R4 规则共识；
- 候选、确认、加仓候选、止盈观察和失效状态。

它不是 Binance 下单服务。sidecar 不可用时，页面必须显示断开或降级，不应制造假候选。

相关代码：`app/structure-radar/*`、`app/api/structure-radar/*`、`services/structure-radar/*`、`lib/structure-radar/*`。

### `/signin`：管理员会话入口

`app/signin/page.tsx` 复用 `OperatorGate`，只负责建立服务端会话。令牌不进入前端持久化。

### 当前不应当当作独立成品的路由

当前源码中：

- `/` 会重定向到 `/radar`；
- `/consultations`、`/arena`、`/replay` 当前页面直接重定向到 `/radar`，不要把历史 README 中的“独立完整页面”当作已上线能力；
- `/api/paper` 已通过 `paperSimulationRetired()` 明确返回 PAPER 已退役；
- TradingView Screener 相关生产路由和 sidecar 已移除。

## 4. 后端模块职责

### 4.1 `app/api/*`：HTTP 边界

API Route 负责鉴权、参数校验、调用领域服务和返回结构化状态。大多数写操作使用 `requireOperatorMutation`，会检查管理员会话和同源请求；定时器使用 `Authorization: Bearer MAINTENANCE_JOB_TOKEN` 通过 `requireScheduler`。

按领域划分：

| 路由组 | 目的 |
|---|---|
| `/api/account` | 只读账户摘要、持仓、风险和活动状态；私有请求优先走固定 IP 网关 |
| `/api/connections` | 汇总 Binance、网关、AI、Square、Bark 和安全开关状态 |
| `/api/market/*` | 公开币种搜索和 K 线；显示真实/降级来源 |
| `/api/radar/*` | 雷达主数据、细筛、MA30 × OI、反转、ATR 生命周期、综合排序、导出和通知 |
| `/api/structure-radar/*` | 访问可选的本机结构雷达服务 |
| `/api/advisory/*` | AI 供应商、会诊、维护、恢复、专家/账户摘要和管理员会话 |
| `/api/ai/plan-review` | 对结构化交易计划进行 AI 或规则复核；不能直接下单 |
| `/api/strategy/parse` | 将自然语言转换为待审结构化计划 |
| `/api/trade/*` | 指标设置、账户监控、策略、订单/持仓、保护执行、Telegram 通知、复盘和状态 |
| `/api/watchlist` | 观察列表持久化与持仓来源优先级同步 |
| `/api/telegram/webhook/*` | 受 secret path、secret header 和用户 ID 约束的私有 Telegram 入口 |
| `/api/deployment` | 只向固定部署 Webhook 请求既定部署动作，不执行 SSH 或任意 shell |

### 4.2 Binance 数据链路

- `lib/binance-gateway.ts`：网站侧网关客户端，只允许预先列出的 Binance 路径和方法，并要求回环 HTTP 地址与至少 16 位 token。
- `lib/binance-public.ts`：公开行情访问层，配置网关时优先通过网关，网关不可用时必须保持明确的失败/降级语义；私有请求不得绕过网关偷偷直连。
- `binance-gateway/server.mjs`：固定 IP 网关，负责 token 鉴权、请求限速、Binance HMAC 签名、服务器时间同步、路由白名单和订单策略校验。
- `binance-gateway/order-policy.mjs`：限制只允许已批准的市价减仓、保护性条件单、Post Only 限价单和受控入场格式；不要为了“临时测试”放开任意 Binance 路径。

网关默认：

```text
BINANCE_GATEWAY_TRADING=false
```

网站判断真实订单路径是否启用的核心条件：

```text
gateway.configured
&& BINANCE_GATEWAY_TRADING === true
&& WORKBENCH_LIVE_TRADING_ENABLED === true
```

这只是“通道允许”的必要条件，不等于每个页面都可以跳过人工确认、仓位校验或策略来源校验。

### 4.3 `lib/trade/*`：交易领域逻辑

这个目录是当前网站升级的高风险区域，主要包括：

- `live-submit.ts`、`live-strategies.ts`、`live-three-leg.ts`：实盘策略、腿和提交前校验；
- `live-account.ts`、`live-contracts.ts`、`position-mode.ts`：账户、合约和单向/双向持仓模式；
- `live-entry-protection.ts`、`live-entry-reanchor.ts`：入场成交后的保护、均线跟随和重挂；
- `protection-executor.ts`、`protection-scheduler.ts`、`protection-strategies.ts`：保护策略扫描和执行；
- `conditional-orders.ts`：价格条件单和条件状态；
- `quick-live-*`：有限模板的快捷实盘策略；
- `order-archive*.ts`、`realized-pnl.ts`、`review-*.ts`：订单归档、成交归因、收益和复盘；
- `indicator-settings.ts`、`position-analysis.ts`、`strategies.ts`：图表/计划/持仓分析。

实盘改动必须先读对应的 `docs/superpowers/specs/` 和 `docs/superpowers/plans/`，再写失败测试，最后才改实现。不要把显示层的“计划”“等待”“候选”直接命名成交易所已挂单。

### 4.4 `lib/radar/*`：扫描、排序、快照和通知

该目录把 Binance 公开数据和可选的外部线索变成可解释候选：

- `ma30-oi*`：MA30 位置与 OI 扩张；
- `multitimeframe.ts`：15m/1h/4h 已收盘多周期筛选；
- `reversal*`：破底翻/结构反转扫描、归档和结果追踪；
- `atr-band*`：MA30 ± ATR 强度与生命周期；
- `composite-ranking.ts`：多因子综合优先级；
- `short-crowding.ts`、`chip-concentration.ts`、`aster-*`、`onchain-holders.ts`：可选因子槽位；
- `bark-notifications.ts`、`alerts.ts`、`alert-diff.ts`：候选变化检测和通知去重；
- `scan-progress.ts`、`scan-diagnostic.ts`、`scan-transport.ts`：长扫描进度、可诊断失败和网络降级。

雷达代码的核心不变量是“缺数据不补假数据”“已收盘 K 线优先”“扫描失败可诊断”“通知幂等”。

### 4.5 `lib/advisory/*`：AI 会诊和模型路由

该目录负责：

- 专家指南与来源命名空间；
- R1 独立判断、R2 匿名质询、R3 最终意见和共识；
- OpenAI、Claude、DeepSeek、OpenCode Go/CCSwitch 等服务端通道；
- 模型测试、手动启用、任务路由和额度/限流告警；
- 会诊快照、失败恢复、通知和专家账户摘要。

AI 只能生成分析、条件机会和结构化计划，不能绕过服务端风险闸门直接发送订单。分析日期由 Binance 最新已收日线推导，不能由浏览器伪造。

### 4.6 `lib/telegram/*`：私有 Telegram 控制面

Telegram 只作为受限操作入口，不是公开机器人：

- webhook 路径和 secret header 必须由服务端环境变量控制；
- 只接受 `TELEGRAM_ALLOWED_USER_ID` 对应的用户；
- 会话、nonce、版本和审计记录持久化；
- 菜单只暴露已批准的实盘流程；
- 每个真实动作仍需网站/服务端开关和最终确认。

### 4.7 `db/*` 和 `drizzle/*`：持久化

`db/index.ts`、`db/ensure.ts`、`lib/local-d1.ts` 负责本地 SQLite/D1 兼容层和启动时 schema 保证；`drizzle/*.sql` 是历史迁移记录。

主要数据类别：

- `trade_knowledge`：交易知识与操作经验；
- `market_snapshots`：行情/会诊快照；
- `consultations`、`expert_opinions`、`consensus_decisions`：四专家会诊；
- `experts`、`expert_accounts`、`expert_positions`、`expert_orders`、`expert_trades`：专家账户摘要；
- `review_tasks`、`review_reports`：复盘任务和报告；
- `notification_deliveries`、`system_alerts`、`job_runs`：通知、告警和定时任务状态；
- `advisory_settings`、`strategy_versions`、`pending_paper_plans`：服务设置、规则版本和历史计划；
- 当前 PAPER 执行已退役，不能重新把旧 PAPER 表/接口误当作生产交易链路。

除数据库外，维护调度器会写：

```text
/var/lib/trade-workbench/maintenance-state.json
/var/lib/trade-workbench/wrangler.log
/var/lib/trade-workbench/structure-radar/
/var/lib/trade-workbench/backups/
```

## 5. 生产环境变量与安全边界

生产模板见 `deploy/workbench.env.example`。实际值只存在 VPS 的 `/etc/trade-workbench/workbench.env`。

### 5.1 必须理解的变量

| 变量 | 目的 | 规则 |
|---|---|---|
| `OPERATOR_ACCESS_TOKEN` | 网站管理员登录令牌 | 独立随机值；不进浏览器存储、Git、日志 |
| `OPERATOR_SESSION_SECRET` | 会话签名/验证 | 与访问令牌分离 |
| `MAINTENANCE_JOB_TOKEN` | systemd 调用内部维护/保护 API | 与管理员令牌、网关令牌分离 |
| `BINANCE_GATEWAY_BASE_URL` | 网站访问网关 | 生产必须是 `http://127.0.0.1:8788` |
| `BINANCE_GATEWAY_TOKEN` | 网站与网关之间的共享鉴权 | 至少 16 位，不能与其他 token 复用 |
| `BINANCE_GATEWAY_API_KEY/SECRET` | 网关访问 Binance 私有接口 | 只开放必要权限、关闭提现/转账、绑定 VPS 出口 IP |
| `BINANCE_GATEWAY_TRADING` | 网关是否允许下单路径 | 默认 `false`；改动前需用户明确确认 |
| `WORKBENCH_LIVE_TRADING_ENABLED` | 网站实盘总开关 | 默认 `false`；与网关开关双重关闭 |
| `STREETLIGHT_LOCAL_D1` | SQLite 路径 | 生产指向 `/var/lib/trade-workbench/sqlite/d1.sqlite` |
| `WORKBENCH_BASE_URL` | 定时器调用网站地址 | 生产定时器建议为 `http://127.0.0.1:3000` |
| `BARK_BASE_URL` / `BARK_API_KEY` | 服务端手机通知 | 二选一，永不返回给浏览器 |
| `OPENAI_API_KEY` 等 | 服务端 AI 通道 | 只由服务端使用；不具备自动下单权限 |
| `SQUARE_MONITOR_BASE_URL` | 可选广场采集服务 | 不配置时雷达要显示数据缺失/降级 |
| `STRUCTURE_RADAR_BASE_URL` | 可选结构雷达 | 生产一般为 `http://127.0.0.1:8790` |
| `TELEGRAM_*` | 私有 Telegram webhook 和用户限制 | Token/path/secret 只在环境文件中 |
| `DEPLOY_WEBHOOK_URL/TOKEN` | 受限部署触发器 | 未配置时网页升级按钮必须禁用 |

### 5.2 Binance 权限原则

默认升级、排障、构建和扫描不需要真实下单。账户只读时使用专用 API Key：

- 开启账户读取所需权限；
- 关闭提现、转账和不必要的资产权限；
- 绑定 VPS 实际固定出口 IPv4；
- 先通过网关 `/api/status` 的 `outboundIp` 确认白名单 IP；
- 不要在网站设置页、聊天、命令历史或 Git 中粘贴密钥。

### 5.3 订单安全原则

- 不新增任意 Binance API 代理路径；先更新路由白名单和测试；
- 不默认打开 `BINANCE_GATEWAY_TRADING`；
- 不能因为 AI 建议、雷达候选、Telegram 消息或定时器运行就自动入场；
- 保护性减仓策略必须校验策略来源、原始仓位数量、当前账户数量和幂等状态；
- 网关返回未知/部分结果时记录为需对账，不要无条件自动重试；
- 价格、数量按交易所 tickSize、stepSize、minNotional 和持仓模式校验；
- 任何真实订单改动都要在测试、构建、人工审阅和部署后验证。

## 6. VPS 日常运维

### 6.1 健康检查

```bash
sudo systemctl is-active trade-workbench.service binance-gateway.service caddy.service
sudo systemctl status trade-workbench.service --no-pager
sudo systemctl status binance-gateway.service --no-pager
sudo systemctl list-timers --all | grep -E 'trade-workbench|protection|maintenance|paper'
sudo ss -ltnp | grep -E ':(80|443|3000|8788|8790)'
curl --fail --silent http://127.0.0.1:3000/ >/dev/null && echo app-ok
curl --fail --silent http://127.0.0.1:8788/health && echo
curl --fail --silent https://真实域名/ >/dev/null && echo public-ok
```

期望：3000、8788、8790（若启用）都只显示 `127.0.0.1`；公网只看到 Caddy 的 80/443。

### 6.2 查看日志

```bash
sudo journalctl -u trade-workbench.service -n 200 --no-pager
sudo journalctl -u binance-gateway.service -n 200 --no-pager
sudo journalctl -u trade-workbench-maintenance.service -n 100 --no-pager
sudo journalctl -u trade-workbench-protection-strategy.service -n 100 --no-pager
sudo tail -n 100 /var/log/caddy/trade-workbench-access.log
```

日志中不应出现 API Secret、管理员 Token、Bark Key、Telegram Token 或完整的 Authorization header。发现密钥泄露时先停止传播，再轮换密钥。

### 6.3 重启边界

只改网站代码：

```bash
sudo systemctl restart trade-workbench.service
```

只改网关代码或网关环境：

```bash
sudo systemctl restart binance-gateway.service
```

改 Caddy 域名/证书/反代：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy.service
```

改环境文件后，根据变量所属服务重启对应服务；不要为了网站前端改动同时重启网关、保护执行器或清空数据库。

### 6.4 SQLite 备份与恢复

在线备份：

```bash
sudo -u trade-workbench /opt/trade-workbench/deploy/backup-sqlite.sh
sudo find /var/lib/trade-workbench/backups -type f -name 'd1-*.sqlite' -mtime +14 -delete
```

恢复前必须停网站，备份文件必须通过完整性检查：

```bash
sudo systemctl stop trade-workbench.service
sudo /opt/trade-workbench/deploy/restore-sqlite.sh /var/lib/trade-workbench/backups/d1-YYYYMMDDTHHMMSSZ.sqlite
sudo systemctl start trade-workbench.service
```

恢复前先保存现有数据库副本；恢复脚本只应针对明确指定的备份文件运行。

## 7. 安全升级流程

### 7.1 本地修改前

1. 先读本文、`handoff.md`、相关 feature spec 和 plan。
2. 查看 `git status`、`git log`，确认哪些改动是用户已有工作。
3. 明确此次改动是展示层、行情层、只读账户层、策略层还是实盘执行层。
4. 实盘/风控/订单相关改动优先采用 TDD：先写会失败的测试，再做最小实现。
5. 不要把本地 `.env`、`.env.local`、`data`、SQLite、构建缓存或私钥同步到 VPS。

### 7.2 部署代码

推荐只同步已审阅的源文件和部署所需文件到 `/opt/trade-workbench`，使用项目记录中的 SSH 目标：

```bash
rsync -az --relative <已审阅文件列表> root@139.59.99.126:/opt/trade-workbench/
```

同步时必须排除：

```text
.env
.env.local
.git/
node_modules/
.next/
dist/
/var/lib/trade-workbench
/etc/trade-workbench/workbench.env
```

不要使用没有核对范围的 `rsync --delete`，不要覆盖环境文件、数据库和用户状态。部署前确认目标文件列表，部署后在 VPS 上构建：

```bash
cd /opt/trade-workbench
npm run build
sudo systemctl restart trade-workbench.service
sudo systemctl status trade-workbench.service --no-pager
curl --fail --silent http://127.0.0.1:3000/ >/dev/null
```

当前 `package.json` 的 `start` 使用 `vinext`，而 `vinext` 位于 `devDependencies`；后续模型在 VPS 上重新安装依赖前必须核对实际生产依赖方式，不要机械执行 `npm ci --omit=dev` 后再假设服务一定能启动。优先保留已验证的 `node_modules` 或按当前部署约定安装完整锁定依赖。

### 7.3 部署后验收

至少检查：

```bash
sudo systemctl is-active trade-workbench.service binance-gateway.service
sudo systemctl list-timers --all | grep -E 'trade-workbench|protection|paper'
curl --fail --silent http://127.0.0.1:3000/ >/dev/null
curl --fail --silent http://127.0.0.1:8788/health
```

浏览器侧检查：

- `/signin` 可以打开；
- 登录后 `/radar` 能明确显示数据状态和更新时间；
- `/trade` 能加载 K 线并保持当前 symbol/interval；
- `/settings` 能显示网关/账户/AI 状态，但不显示密钥；
- `/structure-radar` 在 sidecar 未启用时明确显示断开，而非假装 live；
- 实盘开关保持关闭，未经用户明确确认不得测试真实订单；
- 旧 PAPER timer 仍为 disabled。

## 8. 故障排查速查

### 登录后仍然 401

依次检查：

1. 浏览器访问的是 HTTPS 公网域名，不是混合 HTTP；
2. `OPERATOR_ACCESS_TOKEN` 和 `OPERATOR_SESSION_SECRET` 是否存在且为当前值；
3. `trade-workbench.service` 是否在修改环境后重启；
4. Caddy 是否保留 Cookie 转发；
5. 服务端时间是否正常。

不要把真实 token 复制到日志中排查。

### 网关 health 正常但账户未连接

`/health` 只说明网关进程活着，不代表 Binance 私有 API 成功。继续检查：

```bash
curl --fail --silent -H 'Authorization: Bearer <不要在共享日志中显示的网关 token>' http://127.0.0.1:8788/api/status
```

实际操作时应在安全终端中从受保护环境读取 token，避免把它写进 shell history。重点核对：API 权限、VPS 出口 IP 白名单、服务器时间偏移、网关与网站 token 是否一致。

### Binance `-2015` / `-1021` / 签名错误

- `-2015`：API Key、权限或 IP 白名单错误；测试网/实盘 Key 不要混用。
- `-1021`：服务器时间偏移；网关有时间同步和重试逻辑，先检查 VPS NTP。
- 签名错误：不要在网站侧自行拼签名；POST 参数、query/body 和网关签名逻辑必须一起审查。

### 雷达数据 stale/pending/degraded

先分辨是主数据、Square 外部采集、OI、结构雷达还是定时器问题：

```bash
systemctl status trade-workbench-maintenance.timer --no-pager
systemctl status trade-workbench-maintenance.service --no-pager
cat /var/lib/trade-workbench/maintenance-state.json
```

数据不足时的正确修复是展示真实原因或修复数据链路，不是填充默认样例数值。

### 网站服务启动失败

```bash
sudo journalctl -u trade-workbench.service -n 200 --no-pager
cd /opt/trade-workbench
npm run build
```

常见原因：Node 版本不满足 `>=22.13.0`、依赖未安装完整、构建产物缺失、环境变量路径错误、SQLite 目录权限错误。不要先删除数据库或重建环境文件。

## 9. 当前已知状态和后续模型必须注意的差异

1. `handoff.md` 是历史交接材料，仍有早期“以后部署 VPS”“PAPER 模拟盘优先”等叙述；本文件优先描述当前 VPS 线上边界。
2. 当前本地工作区有大量未提交改动，部分文件已删除或新增；升级前必须确认目标 VPS 的实际版本，不能盲目覆盖。
3. `/consultations`、`/arena`、`/replay` 当前源码重定向到 `/radar`；如果要恢复独立页面，先写需求和验收，不要仅按旧 README 补回页面。
4. PAPER API/调度器已退役；任何重新启用 PAPER 的需求都必须得到明确确认，并重新审查它与真实网关的隔离。
5. TradingView Screener 已移除；新增第三方筛选器前要说明数据源、许可证、服务端边界、失败降级和是否会影响 Binance 事实源。
6. 结构雷达是可选 sidecar，不要因为页面存在就假设 VPS 一定运行 `127.0.0.1:8790`。
7. 实盘保护策略执行器已经存在代码和 systemd 入口，但默认开关关闭；不能把“代码存在”说成“生产已开放实盘”。
8. `README.md`、历史 specs/plans 和当前代码可能有时间差。行为判断以当前代码、测试、VPS 服务状态和实际接口响应为准。
9. 本文记录了项目代码中的 VPS 目标 IP，但没有记录真实域名、SSH 私钥或任何 Secret；域名和配置必须登录 VPS 后现场确认。

## 10. 后续模型的标准工作协议

接到新需求后，模型应按以下顺序工作：

1. 先说明需求影响的模块和风险级别；与实盘、账户、定时执行、密钥或订单有关的需求视为高风险。
2. 读本文、当前 `git status`、相关页面/API/领域模块和对应 spec/plan。
3. 先确认当前部署版本与本地代码是否一致；不要默认本地最新。
4. 形成最小修改计划。跨模块或高风险需求先给出计划和验收标准，再动代码。
5. 采用现有风格和数据契约，不随意新增依赖、第三方服务、端口或环境变量。
6. 不改变以下不变量：
   - secrets 只在服务端；
   - Binance 私有请求经过固定 IP 网关；
   - 交易默认关闭；
   - AI 和雷达不直接等同于订单；
   - 缺数据必须降级并标注；
   - 订单必须可归因、可对账、可复盘；
   - 维护和保护执行器不得因为页面刷新而重复执行。
7. 先运行与改动相关的最小测试；实盘/网关改动再运行完整相关测试。
8. 部署前列出同步文件，明确不会覆盖环境、数据库和其他用户状态。
9. 部署后检查 systemd、loopback 端口、HTTPS、页面和 API；没有验证就不能声称“线上完成”。
10. 最终交付必须包含：改动文件、测试结果、部署版本、服务状态、已知限制和下一步。

## 11. 重要参考文件

按用途阅读，不要一次把全部历史 plan 当作当前实现：

- `README.md`：产品概览和运行模式；部分早期描述需与本文校对。
- `handoff.md`：历史交接、设计背景和旧待办；本文件对当前 VPS 状态优先。
- `deploy/README.md`：VPS 安装、服务单元、防火墙、备份恢复。
- `deploy/workbench.env.example`：环境变量模板，不能替代真实生产文件。
- `deploy/Caddyfile`：公网域名与反向代理模板。
- `binance-gateway/README.md`：固定 IP 网关、出口 IP、Binance 白名单和接口边界。
- `docs/open-source-integrations.md`：新增外部开源项目时的评估规则。
- `docs/superpowers/specs/`：已确认的需求和安全边界。
- `docs/superpowers/plans/`：实施步骤和历史部署记录；其中部分计划已被后续代码取代。

## 12. 完成前 Checklist

- [ ] 已确认修改针对 `trade-workbench`，没有混入旧 `binance-ma-stoploss`。
- [ ] 已确认本地工作区未提交改动，不会被覆盖或回滚。
- [ ] 已确认目标 VPS、部署目录、运行中的服务和当前版本。
- [ ] 已确认没有读取、打印或提交任何 Secret。
- [ ] 已确认 Binance 私有流量仍经过 `127.0.0.1:8788`。
- [ ] 已确认 3000/8788/8790 没有被公网暴露。
- [ ] 已确认 `BINANCE_GATEWAY_TRADING` 和 `WORKBENCH_LIVE_TRADING_ENABLED` 的实际值，再决定是否允许实盘相关验证。
- [ ] 已确认 PAPER timer 没有被误启用。
- [ ] 已运行相关测试并记录真实结果。
- [ ] 已完成部署后健康检查、页面检查和风险边界检查。
- [ ] 已说明剩余风险、降级状态和下一步，而不是只报告“代码改好了”。
