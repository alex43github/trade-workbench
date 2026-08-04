# 街灯雷达

街灯雷达的第一阶段产品：从币安广场的热门、高波动币中发现候选，再用 Binance Futures OI、资金费率、主动买卖比、Aster 持仓变化、筹码集中度和链上异常进行条件式确认。

## 当前能力

- 币安广场热度、喊空、套牢与扛单语义的标准接入字段
- Binance U本位永续合约公开行情和 OI 降级数据源
- “喊空但抗跌、OI增加”的逼空重点池
- 筹码集中、Quiet 钱包、CEX 占比和生命周期展示
- Aster OI、大户持仓变化、链上异常的独立数据槽位
- 硬性风险闸门与逐币解释

页面对实时、部分、待接入和演示数据做明确标记。缺失数据不会被估算后冒充真实值，也不会参与对应因子的评分。

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
- 15m、1h、4h、1d多周期选择，固定USDT或可用资金比例配置
- 最多买入3次、连续收盘跌破MA后的分两段退出状态机
- 自然语言先解析为结构化规则，再写入可检查表单
- 页面内模拟观察与决策日志；没有真实订单路由
- 系统风险外壳：单笔0.5%、单日2%、并发1.5%、最多3个持仓

### 连接币安只读账户

只在网站的服务端运行环境配置：

```text
BINANCE_FUTURES_API_KEY=...
BINANCE_FUTURES_API_SECRET=...
```

首个密钥只开放读取账户与订单状态所需权限，保持交易和提现权限关闭。密钥不会返回浏览器，也不会写入本地存储；浏览器只接收已经标准化的余额、持仓和活动委托。真实下单仍不存在于本版本。

开源参考采用“按需吸收”方式：图表直接使用 Lightweight Charts；实时刷新与日志结构参考 polyrec；回测、Dry Run和实盘隔离参考 Freqtrade。fredapi 与 prediction-market-backtesting 当前不进入依赖树。
