# 街灯终端

一个将妖币发现、条件式策略和操作复盘分层处理的私有交易工作台。第一阶段从币安广场的热门、高波动币中发现候选，再用 Binance Futures OI、资金费率、主动买卖比、Aster 持仓变化、筹码集中度和链上异常进行条件式确认。

## 当前能力

- 币安广场热度、喊空、套牢与扛单语义的标准接入字段
- Binance U本位永续合约公开行情和 OI 降级数据源
- “喊空但抗跌、OI增加”的逼空重点池
- 筹码集中、Quiet 钱包、CEX 占比和生命周期展示
- Aster OI、大户持仓变化、链上异常的独立数据槽位
- 硬性风险闸门与逐币解释
- 与交易工作台统一的专业深浅色终端界面，雷达候选可直接带币种跳转到K线页

页面对实时、部分、待接入和演示数据做明确标记。缺失数据不会被估算后冒充真实值，也不会参与对应因子的评分。

## 强势币结构雷达

`/structure-radar` 是独立的本机实时扫描页，扫描 Binance 全部 `TRADING` 状态的 USDT 本位永续合约：

- 15m、1h、4h 三周期，1h 为主预警周期；只使用已收盘 K 线。
- 自动识别“长期平台假跌破后最多 3 根快速收回”和“下降趋势线 1.5 倍中位量突破”。
- 候选、确认、加仓候选、止盈观察、失效状态带版本去重。
- ICT、街哥、静心、bit浪浪执行 R1 独立分析、R2 匿名质询、R3 最终意见，再由纯规则 R4 仲裁。
- bit浪浪在强势币同向有效时优先提供执行主案，但投票权与其他专家相同；只在浮盈和新结构确认后讨论加仓。
- Binance 账户仅通过具名 GET 接口读取持仓；项目没有真实下单、撤单、修改杠杆、转账或提现路径。
- Bark 可推送候选与确认；少于三份有效 R3、2v2 或关键反对时不提供统一点位。
- TradingView 免费版只挂载 `tradingview/strong-coin-structure-radar.pine` 一个指标，收到 Bark 后切图复核。

### 本机观察模式

复制 `.env.example` 中需要的变量到未提交的本地环境。最低配置：

```text
STRUCTURE_RADAR_BASE_URL=http://127.0.0.1:8790
RADAR_DATA_DIRECTORY=.data/structure-radar
RADAR_NOTIFY_ENABLED=false
RADAR_LOCAL_TOKEN=请生成一个本机随机值
```

运行：

```bash
npm run radar:check
npm run radar:start
```

另一个终端运行网站后访问 `http://localhost:3000/structure-radar`。第一次启动需要为全部合约回补 15m、1h、4h K 线，耗时取决于 Binance 网络和限频；失败品种会标记为 degraded，不能产生计划。

推荐先保持 `RADAR_NOTIFY_ENABLED=false` 观察。确认 `/health` 的 `bootstrapFailures=0`、收盘时间与图表一致、专家 Skill 可读后，再把 Bark 配置为以下任一方式并显式改为 `true`：

```text
BARK_BASE_URL=https://api.day.app/你的设备Key
# 或复用现有配置
RADAR_BARK_CONFIG_PATH=/Users/你的用户名/Downloads/交易文档/binance-square-monitor/macos/config/mobile_push.json
RADAR_NOTIFY_ENABLED=true
```

Bark 地址仅由守护进程读取，不返回浏览器。失败最多重试三次；同一 `signal_id + state_version + bark` 成功后不会重发。失效通知不会附旧计划。

若希望登录后常驻运行，可执行 `services/structure-radar/install-local.sh` 生成 LaunchAgent。脚本不会自动加载服务、复制密钥或开启 Bark；生成后按终端提示手动 `launchctl bootstrap`。

### 四专家与持仓配置

默认从 `~/.codex/skills/{ict,street,jingxin,bitlanglang}-trading` 读取 Skill。每次会诊先对完整 Skill 文件集计算哈希；Skill 不可用时返回 `unavailable`，不会用规则模板冒充专家。bit浪浪体系仍按研究版/未视觉核验处理，具体点位来自当前结构而不是历史视频样例。

可选只读持仓变量：

```text
BINANCE_FUTURES_API_KEY=只读Key
BINANCE_FUTURES_API_SECRET=只读Secret
```

务必关闭交易、提现和转账权限，并设置 IP 白名单。私有接口失败不影响公共扫描，但持仓显示为未知，并禁止加仓建议。

TradingView 安装说明见 `tradingview/README.md`。完整规则、验收标准与已知限制见 `docs/superpowers/specs/2026-08-13-strong-coin-structure-radar-design.md`。

## 外部采集连接

币安广场采集服务通过服务端运行变量 `SQUARE_MONITOR_BASE_URL` 接入，网站读取其 `/api/leaderboard`。采集器可逐步补充以下字段：

- `crowd_mood`、`short_call_ratio`、`trapped_ratio`、`resilience_score`
- `oi_change_15m`、`oi_change_1h`、`oi_change_4h`
- `aster.oi_change_1h`、`aster.whale_delta`
- `chip.top10_pct`、`chip.top1_pct`、`chip.cex_pct`、`chip.quiet_wallet_pct`、`chip.stage`
- `chain.anomaly_score`、`chain.signal`

当前版本没有真实交易接口。

## 第二板块：交易工作台

`/trade` 提供独立的模拟策略实验室与只读账户终端：

- 深色、浅色、跟随系统三种主题，布局参考专业合约终端的信息层级
- TradingView Lightweight Charts 5.2 K线、成交量、MA/EMA、Anchored VWAP、Fixed Range Volume Profile
- 每个指标可独立启停并修改周期、锚定区间、价格源、行数与颜色
- Binance U本位公开K线，连接失败时切换为明确标记的演示行情
- Binance U本位真实账户只读摘要、持仓、限价单和条件单；未连接时不注入演示持仓
- 仓位线、限价单、条件单、止盈止损线可以在图表工具栏独立显示或隐藏
- 资金曲线按5分钟保存一份本机快照；后续可升级为服务端长期快照
- 无当前持仓时显示建仓条件、做多/做空方向、仓位、止损与止盈配置
- 检测到当前币种持仓后自动切换为加仓、减仓、止损与止盈条件
- 15m、1h、4h、1d多周期选择，固定USDT或可用资金比例配置
- 自然语言先转换成结构化规则并回填到可检查表单，绝不直接发送订单
- 每份操作计划在提交前按触发、失效、止损、止盈、仓位、禁做条件和雷达证据评分
- 操作前评分与清仓复盘写入D1操作知识库，聚合重复错误和历史评分
- 只读持仓从有到无时生成“估算复盘”；当前采用退出前最后一份未实现盈亏，必须等后续接入成交与收益流水后才能升级为精确实现盈亏
- 页面内模拟观察与决策日志；没有真实订单路由
- 系统风险外壳：单笔0.5%、单日2%、并发1.5%、最多3个持仓

### 可运行模拟盘

- 初始虚拟资金 10,000 USDT，默认3倍模拟杠杆
- 只用 Binance Futures 公开标记价格撮合，不需要账户密钥
- 托管服务端被 Binance 限制时，自动由浏览器直连 Binance 公共K线；浏览器报价只允许进入模拟盘，不能进入真实订单
- 单笔计入0.04%模拟 taker 手续费，资金曲线和记录保存在D1
- 纪律评分至少70分，并且具备两个触发条件、止损、止盈、禁做规则，才能提交模拟订单
- 同一仓位最多3次买入；支持模拟减仓50%或完全退出
- 填写固定止损/止盈价格时创建模拟条件单，由页面每15秒轮询检查触发
- 模拟成交不等于真实可成交，当前不模拟订单簿深度、网络延迟和完整滑点
- 完全退出后自动将净结果与纪律复盘写入操作知识库

“AI复核计划”在没有 OpenAI 服务密钥时使用可解释纪律引擎；配置 `OPENAI_API_KEY` 后使用 Responses API 的结构化输出叠加复核。无论哪种模式，AI结果都不能绕过服务端风险闸门，也不能发送真实订单。

`/settings` 提供服务端连接诊断：公开行情连通性、Binance 只读账户、OpenAI 计划复核和广场采集器状态。该页面只返回“是否配置/是否连通”，永远不返回密钥值，也不提供浏览器端密钥输入框。

当前街哥资料库中尚无完成来源核验的规则，因此页面会如实显示“街哥核验规则 0 条”。现阶段评分来自条件式交易计划模板与系统风险外壳，不会冒充街哥本人观点；视频知识库完成后再以带时间戳的规则版本升级评分器。

### 连接币安只读账户

只在网站的服务端运行环境配置：

```text
BINANCE_FUTURES_API_KEY=...
BINANCE_FUTURES_API_SECRET=...
```

首个密钥只开放读取账户与订单状态所需权限，保持交易和提现权限关闭。密钥不会返回浏览器，也不会写入本地存储；浏览器只接收已经标准化的余额、持仓和活动委托。真实下单仍不存在于本版本。

推荐使用一组专门的只读密钥，并在 Binance API 管理中关闭交易和提现权限。不要把密钥写进网页代码或发在聊天消息中；本地开发写入未提交的环境配置，私有站点使用托管环境的加密变量。

开源参考采用“按需吸收”方式：图表直接使用 Lightweight Charts；实时刷新与日志结构参考 polyrec；回测、Dry Run和实盘隔离参考 Freqtrade。fredapi 与 prediction-market-backtesting 当前不进入依赖树。
