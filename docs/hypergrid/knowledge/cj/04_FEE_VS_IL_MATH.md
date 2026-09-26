# 04 · Fee vs IL / Adverse Selection Math

## 变量与记账边界

设 `P` 为 token1 per token0 的 canonical price，`P0` 为入场价格，`Pa/Pb` 为 lower/upper price，`L` 为 CL liquidity，`F` 为已实现/可领取 fee，`C` 为 gas、交易费、借贷/资金费、滑点和失败交易成本总和。

- [VERIFIED_EXTERNAL_FACT | EX-UNI-WP](https://app.uniswap.org/whitepaper-v3.pdf) Uniswap v3 用有界价格区间和 virtual reserves 表示集中流动性；小区间在价格穿越后会转换成单一资产并保留已累积费用。
- [VERIFIED_EXTERNAL_FACT | EX-UNI-TICK](https://developers.uniswap.org/docs/sdks/v3/guides/managing-liquidity/getting-started) 位置由 liquidity、tickLower、tickUpper 定义，tick spacing 约束可使用的边界。
- [INFERENCE] HyperGrid 的 PnL 必须拆为 mark-to-market inventory、fee、realized execution PnL、IL/HODL benchmark、gas/fee/borrow/slippage 和 residual/unpriced risk；只看钱包余额或 APR 会丢失路径风险。

## 头寸数量（方向必须先校验）

在常见的 Uniswap v3 归一化公式下，令 `s = sqrt(P)`、`sa = sqrt(Pa)`、`sb = sqrt(Pb)`：

```text
in range: amount0 = L * (sb - s) / (s * sb)
           amount1 = L * (s - sa)
below Pa: amount0 = L * (sb - sa) / (sa * sb), amount1 = 0
above Pb: amount0 = 0,                         amount1 = L * (sb - sa)
```

- [VERIFIED_EXTERNAL_FACT | EX-UNI-WP](https://app.uniswap.org/whitepaper-v3.pdf) 该类 sqrt-price/virtual-reserve 关系是 v3 头寸计算的基础。
- [INFERENCE] 公式落地前必须通过池的 token0/token1 canonical addresses、decimals、UI price convention 和 tick-to-price conversion 做单元测试；把“token0 price”误读成 token1 per token0 会反转区间、库存和 IL 方向。
- [INFERENCE] 任何来自 Meteora/DLMM 的 bin price、active bin、X/Y 方向不能直接套 Uniswap tick 公式，应以具体 SDK/IDL 和账户字段为准。

## 费用与价格损失

- [AUTHOR_CLAIM | CJ:1930592265342525690] “Fee 跑赢无常损失”是作者的入场准则表述。
- [INFERENCE] 研究上的净 break-even 应写成：

```text
net_edge = fee_realized + incentive_realized
           - adverse_selection_loss
           - (inventory_mark - HODL_benchmark)
           - gas - trading_fees - borrow_or_funding - slippage - failure_reserve
```

- [INFERENCE] `Fee > IL` 不是充分条件：HODL benchmark 选择、价格路径、库存价值、退出滑点、奖励可兑现性和 tail risk 都会改变结论；因此 H-CJ-001 必须做 path-dependent attribution。
- [AUTHOR_CLAIM | CJ:1930623777962139695] “单边 10% 区间跌穿静态亏损 5%”是作者/手册的数字命题；它依赖区间定义、资产方向、比较基准和价格路径，本库不把它当通用定律。
- [INFERENCE] IL/adverse selection 应按 realized path 分桶，而不是用单一最终价格；相同终点、不同穿越顺序可能产生不同 fee、inventory 和 gas。

## APR/APY 与复利

- [AUTHOR_CLAIM | CJ:1987051719541547037; CJ:1987074761948864662] 3000%/1000% 是作者归档中的短线经验阈值。
- [INFERENCE] 若当前窗口 fee 为 `f_window`、窗口时长为 `h`，年化只是 `f_window × year/h` 的外推；它不应被展示为预测收益，除非同时显示样本窗口、置信区间、流量/TVL、价格波动和退出容量。
- [INFERENCE] APY 的复投项应显式写出 `reinvest_cost` 和 `compounding_frequency`；若复投需要 swap/withdraw/deposit，频繁复投可能增加成本和 MEV 风险。

## 价格方向与数据校验

在进入模拟器前必须通过以下不变量：

1. [INFERENCE] `token0 < token1` 的 canonical ordering 与 UI symbol 显示分离记录。
2. [INFERENCE] 以一个已知池状态重算 `P`, `sqrtP`, amounts，并与官方 SDK/链上读取对照。
3. [INFERENCE] 对 lower/upper 互换、decimals 错位、负/零价格、溢出和 tick spacing 不匹配做 fail-closed。
4. [INFERENCE] 每个 PnL 输出同时展示 token units、USD mark、benchmark、timestamp/block 和价格来源。

## 最小回测输出

| 输出 | 解释 |
| --- | --- |
| fee APR / fee per active hour | 只表示现金流，不表示净收益 |
| IL/HODL path attribution | 以同一价格路径重建 benchmark |
| adverse-selection proxy | toxic flow、价格跳跃、成交后价格变化 |
| inventory delta | token0/token1、USD、净 delta、单边状态 |
| all-in cost | swap fee、gas、borrow/funding、failed tx、退出滑点 |
| range uptime | active/inactive 时间比例 |
| exit survival | 在预定窗口内是否可退出、退出冲击 |

## 安全结论

- [INFERENCE] 任何“Fee > IL”或 APR 门槛只有在上述输出上通过 out-of-sample、不同波动/流动性 regime 和成本敏感性分析后，才可成为 G6 的候选参数。
- [OBSERVATION | task gate] 本任务只新增研究/模拟要求，没有把公式或阈值接入现有执行器。
