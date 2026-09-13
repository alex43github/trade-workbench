# Trade Workbench 交接文档

更新时间：2026-09-07

本文档用于把 `trade-workbench` 后续工作交给 Sol/Terra 模型。目标是让后续模型先阅读本文，再检查代码和测试，不重复破坏已有工作。

## 一、项目目标

建设一个私有的个人加密交易工作台，形成“知识库 → 行情扫描 → 条件分析 → 模拟验证 → 复盘 →（未来人工确认后）实盘”的闭环。

当前优先级是：

1. 先让网站在真实行情数据上稳定运行。
2. 优先完成币安广场热门币/妖币雷达和专业数据分析。
3. 建设 BTC、ETH、SOL、HYPE 等稳健币种的交易分析页面。
4. 使用街哥交易思想和 ICT 知识库生成条件式建议与交易评分。
5. 首版只做真实行情、真实持仓读取和模拟盘，禁止无人工确认的真实下单。
6. 以后再部署到固定 IP VPS，并视测试结果启用人工确认的实盘订单草案。

## 二、现有产品板块

### 1. 妖币雷达

需要统一为交易页面的深色/浅色专业风格，展示：

- Binance Square 热门币和短期高波动币。
- Binance Alpha 与 Binance Futures 的交集代币。
- 价格、成交额、波动率、量能加速。
- Binance Futures OI 变化、资金费率、价格/OI 四象限。
- OI 与价格背离、持仓集中/异常变化、低流动性风险。
- Aster 持仓/OI（接入条件具备后）、链上数据、聪明钱和异常警报。
- 每个上榜币的可解释原因、风险标记和数据时间戳。

广场热门是重要线索，但不能直接等于买入信号。尤其关注“很多人喊空、套牢、扛单”的情形，同时标记追涨、拥挤和可能诱空/诱多。

默认妖币过滤建议：正常交易的 U 本位永续、上市至少 7 天、24h 成交额至少 2,000 万 USDT；阈值应可配置，数据不足时必须显示“数据不完整”。

### 2. 交易页面

参考 aix.bot 的专业终端布局，但只实现自己的必要功能：

- TradingView Lightweight Charts 5.x。
- 深色/浅色主题。
- K 线、成交量和可配置指标：MA、EMA、Anchored VWAP、Fixed Range Volume Profile 等。
- 指标参数可编辑，指标计算由本项目数据源提供。
- 真实只读持仓、未实现盈亏、已实现盈亏和资金曲线。
- 可开关显示限价单、条件单、止盈止损单，默认提供清爽模式。
- 持仓为空时显示买入条件/策略构建器。
- 有持仓时显示卖出、止损、止盈和加仓策略构建器。
- 支持勾选条件，也支持自然语言生成“待审核策略”；不得让自然语言直接绕过风险校验下单。

### 3. 策略与复盘

用户曾提出的 30MA 策略只属于妖币高波动策略，不要把它误当作街哥稳健币种的完整体系：

- 多头趋势中，价格回撤至 15m/1h/4h/1D 的 30MA 上下约 1% 或触碰均线时分批买入。
- 最多围绕 30MA 买入 3 次。
- 按买入周期收盘价跌破 30MA，卖出 50%；第二根 K 线继续跌破，再卖出 50%。

当前阶段优先回测街哥技巧，不要先强行优化上述 30MA 规则。

每次模拟挂单/买入/卖空前：

- 根据知识库和结构化证据打分。
- 给出方向、触发条件、失效点、风险和不交易条件。
- 持仓完全退出后生成成功/失败复盘。
- 将结果追加到操作知识库，避免重复错误。

模拟盘风险外壳建议默认：单笔风险 0.5%、单日最大损失 2%、总并发风险 1.5%、最多 3 个持仓；全部可配置。

## 三、知识库来源与原则

街哥是当前最重要的主要依据，尤其要保证 Anchored VWAP、Volume Profile、裸 K 结构、箱体、突破/回踩、假突破、位置学、趋势和风险纪律有视频画面与时间戳证据。不能只依据自动转写推断图表含义。

其他来源包括：

- ICT 英文视频和 PDF，最终对用户输出中文。
- 静心体系材料（视频任务曾暂停，后续再处理）。
- 外汇市场知识、宏观和美股代币相关资料。
- `Toni-xie/Trading-skills`。
- OI/价格四象限、资金费率、筹码、诱空诱多和妖币分析资料。
- HertzFlow 作为储备工具，除非确有必要不要频繁调用；OKX Agent/公开数据优先。

知识库必须分层保存：原始来源、逐条归纳、可执行规则、统计验证、冲突和待验证问题。每条规则应包含适用市场/周期、背景、触发、确认、入场、失效、止损、止盈、禁做条件、风险、来源时间戳和可信度。

## 四、推荐部署架构

正式运行建议：

```text
浏览器
  ↓
网站（Cloudflare 或 VPS）
  ↓
固定公网 IP 的 Binance Gateway VPS
  ├─ Binance Futures 私有 API 签名与只读/模拟接口
  ├─ OI、资金费率、行情扫描定时任务
  ├─ 模拟盘和复盘数据库
  ├─ OpenAI API 调用
  └─ Bark 上下线/异常通知
```

网页不需要放置 API secret。Binance 和 OpenAI 密钥只放服务端环境变量或加密密钥存储。原始视频/PDF保留在本地；VPS只同步结构化知识库和网站所需摘要。

推荐系统：Ubuntu 24.04 LTS。最低可用 2 vCPU/2GB RAM/40GB SSD；正式更推荐 2 vCPU/4GB RAM。Oracle Cloud Ampere A1 免费额度（2 OCPU/12GB 左右）可尝试，但免费资源容量和持续性有风险；AWS Lightsail 4GB 或 DigitalOcean/Vultr 2–4GB 更容易维护。VPS不需要 GUI。

## 五、Binance Gateway 与 Bark

目录：`binance-gateway/`。

已实现：

- 固定 IP Node 网关。
- `/health`、`/api/status`、Binance Futures 转发/签名。
- 默认关闭真实交易路径，`BINANCE_GATEWAY_TRADING=false`。
- `notify.sh`：服务启动/停止时 Bark 推送。
- `watchdog.sh`：每 5 分钟健康检查，状态翻转时推送。
- `install.sh` 会写 systemd 服务、watchdog timer 和 `.env` 模板。

整机断电时本机无法发出下线通知；恢复后 watchdog 可推送上线。要实现断电告警，需要外部监控。

用户需要在 VPS `.env` 填入：

```env
BINANCE_GATEWAY_API_KEY=...
BINANCE_GATEWAY_API_SECRET=...
BARK_API_KEY=...
BARK_BASE_URL=https://api.day.app
```

Binance API 必须禁止提现，先只读；开放交易前设置固定 IP 白名单、最大仓位、单日熔断、紧急停止和幂等订单。

## 六、当前已完成/已有代码线索

- 网站项目根目录：`/Users/niangao/Downloads/交易文档/trade-workbench`
- 本地 Next/Vinext/React 项目，使用 `lightweight-charts` 和 Drizzle 相关代码。
- 已有 settings、credentials、AI advisory、paper trading、local secrets 等改动。
- `binance-gateway` 的 Bark 通知和 watchdog 已实现并通过网关测试。
- 工作区存在大量未提交改动，属于前序工作；后续模型不得使用 `git reset --hard`、`git checkout --` 或删除未审查文件。
- 目前没有授权自动提交或推送；除非用户明确要求，保持不提交。

先运行：

```bash
npm test
node --test binance-gateway/test.mjs
```

若测试因沙箱端口权限失败，记录原因并在允许时重新运行；不要把环境限制误判为代码失败。

## 七、下一阶段执行顺序

1. 检查当前代码、路由和启动方式，修复 API 返回空响应导致的 `Response.json()` 错误。
2. 加入真实行情数据的可重复缓存和陈旧数据提示。
3. 打通 Binance Gateway 的 `/health`、`/api/status` 和只读账户/持仓接口。
4. 修复并验证雷达的 Binance Futures OI 扫描，明确 403 是出口/IP/区域问题还是接口限制。
5. 用模拟盘接入真实 K 线，先不开放真实下单。
6. 完成交易页指标、持仓、资金曲线、挂单开关和策略构建器。
7. 将街哥规则转成结构化规则，优先实现 AVWAP/VP/结构规则的回测和信号解释。
8. 建立回测数据接口：至少 BTC/ETH/SOL/HYPE 多周期 OHLCV、成交量、OI、资金费率，保存原始数据和时间范围。
9. 回测至少覆盖不同趋势/震荡/高波动阶段，并报告手续费、滑点、资金费、最大回撤、胜率、盈亏比、收益波动和样本数；不得只报告收益率。
10. 通过至少 50 笔模拟交易验证后，再讨论订单草案和人工确认实盘。

## 八、模型与插件使用建议

- 代码实现、测试、部署：Terra high/medium 通常足够。
- 复杂故障定位和最终关键规则复核：Sol high。
- 不要为了普通文件修改浪费最高模型额度。
- 可用 skill：Binance、lightweight-charts、websearch、PDF/文档、街哥交易、ICT、Jingxin；HertzFlow按需使用。
- 网站建站能力若可用可继续使用，但不要因 Sites 连接器不可用而阻塞本地/VPS部署。

## 九、开源项目整合优先级

新增需求时，先阅读 [`docs/open-source-integrations.md`](docs/open-source-integrations.md)，并优先查询以下 GitHub 项目是否已有可整合能力：

- [Dune Skills](https://github.com/duneanalytics/skills)：链上数据、钱包、Token、Holder、DeFi Position 与 Query 管理。
- [CCXT](https://github.com/ccxt/ccxt)：多交易所行情、K线、订单簿、成交、Funding、账户和价差研究。
- [web3.py](https://github.com/ApeWorX/web3.py)：EVM RPC、合约读取、Event、Receipt、余额与链上交互。
- [Hummingbot](https://github.com/hummingbot/hummingbot)：DEX、做市、套利和 Gateway 场景。
- [Freqtrade](https://github.com/freqtrade/freqtrade)：CEX 策略、回测、Dry Run、仓位管理和运行控制。
- [NautilusTrader](https://github.com/nautechsystems/nautilus_trader)：重型事件驱动、多市场和回测/实盘一致性场景。
- [Prometheus](https://github.com/prometheus/prometheus)：WebSocket、RPC、API、扫描、Signal、订单失败、余额和 PnL 的长期监控。

评估时必须记录仓库当前文档、许可证、维护状态、版本/提交、密钥边界、部署影响、失败降级和验收方式。优先采用服务端只读适配、缓存、测试网或 dry-run；不要让上述项目绕过 Binance Gateway、模拟盘、风险闸门、人工确认或审计链。Hummingbot、Freqtrade 和 NautilusTrader 默认作为独立旁路服务评估，除非 feature spec 明确批准进入核心交易链路。

## 十、安全红线

- 未经用户明确确认，不创建真实 Binance 订单。
- API secret、OpenAI key、Bark key不得进入浏览器、日志、Git、截图或回答内容。
- 所有价格/数量用精确十进制，按 Binance tickSize、stepSize、minNotional 校验。
- AI只能提出结构化计划和评分；订单执行必须经过规则引擎和人工确认。
- 数据缺失、403、延迟、时间偏移、接口限流时，必须明确告警并停止产生“确定性”建议。
- 任何“上榜”只表示候选机会，不等于买入信号。

## 十一、交接验收标准

后续模型在声称“完成”前，必须提供：

- 修改文件清单和每项原因。
- 测试命令及真实结果。
- 当前网站启动地址和健康检查结果。
- Binance API 是否只读、网关出口 IP、OI 数据是否实时。
- 模拟盘是否仍完全隔离真实订单。
- 已知限制、待用户提供的配置和下一步操作。

## 十二、用户待修改清单

- [ ] 明确区分“待最终确认”“策略已保存”“模拟策略已检查”“交易所实盘已挂单”四种状态，页面不得用 `WAITING/未成交` 让人误以为 Binance 已经存在真实限价单。
- [ ] 修复并可视化 PAPER 策略调度链路：策略卡片显示实际计算出的限价、最后检查时间、调度器最近运行结果和失败原因；排查 VPS 定时器、`WORKBENCH_BASE_URL`、`MAINTENANCE_JOB_TOKEN` 与公开行情请求，避免长期显示“尚未检查”。
- [ ] 在用户明确授权且默认保持关闭的前提下，补齐实盘限价单链路：最终确认后由服务端复核参数并通过 Binance Gateway 提交 Post Only 限价单，保存网站订单号、交易所订单号、价格、数量和状态，并在“真实活动委托”与策略详情中可追踪；PAPER 策略永不发送真实订单。
