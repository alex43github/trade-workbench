# Strong Coin Structure Radar（TradingView 免费版）

这是收到 Bark 后用于图形复核的单一 Pine Script 指标，同时显示：

- 长期平台、假跌破收回候选与确认；
- 自动下降趋势线、1.5 倍中位量突破候选与确认；
- 结构失效；
- 手动输入 Bark 给出的入场、止损、目标一、目标二。

## 安装

1. 在 TradingView 打开任意 Binance 永续合约图表。
2. 打开 Pine Editor，把 `strong-coin-structure-radar.pine` 全部内容粘贴进去。
3. 点击“保存”与“添加到图表”。免费版只占一个指标槽。
4. 周期切换到 Bark 指定的 15m、1h 或 4h；默认优先看 1h。
5. 若 Bark 有研究计划价，在指标设置的“Bark 计划线”中手动填写。

本指标只扫描当前图表，不负责全市场推送；全 Binance USDT 永续扫描与 Bark 由本机守护进程完成。Pine 的分位数与 pivot 语义和本地 TypeScript 实现存在细小浮点差异时，以本地保存的触发快照为准。所有提示均为研究预警，不会自动下单。
