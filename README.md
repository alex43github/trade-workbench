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
