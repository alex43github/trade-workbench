# 02 · LP / Concentrated Liquidity Market Making

## 概念边界

- [VERIFIED_EXTERNAL_FACT | EX-UNI-CL](https://developers.uniswap.org/docs/liquidity/overview) Uniswap v3/v4 的 concentrated liquidity 允许 LP 选择价格区间；价格离开区间后该头寸停止赚取交易费，且头寸逐渐偏向单一资产。
- [VERIFIED_EXTERNAL_FACT | EX-MET-DLMM](https://github.com/MeteoraAg/docs/blob/main/developer-guides/dlmm/index.mdx) Meteora DLMM 是 Solana 上的集中流动性产品，开发者可通过 bin、position、oracle、fee 等账户/接口读取状态；实现细节必须以具体协议版本为准。
- [AUTHOR_CLAIM | CJ:1881635465683767355; CJ:1948733203566789056] 作者把 Meteora/DLMM 视为比完全被动 LP 更适合主动交易的工具；这是个人经验，不是所有 CLMM/DLMM 的收益证明。

## 机制分类

### 1. 区间选择与 active vs passive LP

- [AUTHOR_CLAIM | CJ:1930592265342525690; CJ:1934241999819038740] 进场前先问预计存续时间内 fee 是否足以覆盖价格偏离带来的损失；脱离区间后若没有足够安全垫，应撤出而不是等待反弹。
- [INFERENCE] passive LP 只描述不频繁改变区间，并不等于风险低；active LP 把区间、方向、退出、再入场作为一组策略变量，必须支付操作、gas、滑点和错过反弹的成本。
- [VERIFIED_EXTERNAL_FACT | EX-UNI-RANGE](https://developers.uniswap.org/docs/get-started/concepts/liquidity-providers/range-orders) 单边、区间外的集中流动性可近似 range order，但它与有订单簿的限价单不同，成交沿 AMM 曲线发生并会收取/承担相应状态变化。

### 2. Fee、adverse selection 与 inventory skew

- [AUTHOR_CLAIM | CJ:1930592265342525690; CJ:1895048082884305066] 作者反复把 fee 与无常损失/本金变化放在同一张账上，而不是只看界面 APR。
- [INFERENCE] 费收入是交易流量对 LP 提供库存/价格风险的补偿；若价格单边移动、信息交易者先于 LP 成交，LP 可能收到 fee 的同时留下更差的库存，这属于 adverse selection，不应只用静态 IL 名称覆盖。
- [INFERENCE] 当价格靠近区间下沿，资产组合更偏 token0；靠近上沿则更偏 token1（具体 token0/token1 方向必须由池的 canonical ordering 校验）。库存偏斜是风险状态，不是收益。
- [VERIFIED_EXTERNAL_FACT | EX-UNI-TICK](https://developers.uniswap.org/docs/sdks/v3/guides/managing-liquidity/getting-started) Uniswap 位置由 liquidity、lower tick、upper tick 定义，tick spacing 受池配置约束；因此 UI 显示的价格范围不能脱离 token ordering 和 tick spacing 解读。

### 3. 范围宽度、换手率和退出

- [AUTHOR_CLAIM | CJ:2094571978401423557; CJ:1894241348527743216] 窄/有效区间在短时高换手中可能产生大量 fee，但作者也记录过大范围、分批加仓和手动多次添加的工程限制。
- [INFERENCE] 窄区间提高单位资本的潜在流量暴露，也提高出界、库存单边化和再部署次数；宽区间降低管理频率，但可能降低 active capital efficiency。
- [AUTHOR_CLAIM | CJ:1934241999819038740] “脱离区间立刻撤池”是作者的硬规则表述；本库把它变成 H-CJ-003，需比较立即退出、延迟退出和被动等待的净结果。
- [INFERENCE] 退出触发至少需要 price/tick 出界、fee accrual rate、预估恢复概率、清算/退出滑点、gas 和剩余库存一起判断；单一价格阈值不足以执行。

### 4. 方向性 LP 与新/高波动 token

- [AUTHOR_CLAIM | CJ:1969964672825909560; CJ:1899347899970154794] 作者描述上方单边 token 区间可表达看空/收割，下方稳定币区间可表达计划内接货；跌破后可按计划持有或赎回。
- [INFERENCE] 这不是 delta-neutral LP，而是带有预设入场价的库存获取策略；必须把最坏 token inventory、退出流动性、合约风险和尾部跳空纳入仓位上限。
- [AUTHOR_CLAIM | CJ:1914933717157777419] 选品偏好热门、DEX 首发、具有盘前期货/OTC 参考的大项目；这是作者的对手盘/定价锚经验，不是安全性保证。
- [INFERENCE] 新链/土狗候选的 scanner 需要把 token tax、transfer restriction、池子 ownership、可撤流动性、持仓集中度和价格锚可用性列为硬拒绝项。

### 5. APR/APY 与复利陷阱

- [AUTHOR_CLAIM | CJ:1987051719541547037; CJ:1987074761948864662] 归档手册把 APR > 3000% 和 < 1000% 作为短线经验门槛；来源是作者规则/整理者命题，未被独立验证。
- [INFERENCE] APR 是把当前短时流量外推到一年，不能表示未来流量、可持续价格、退出容量或实际净收益；APY 还隐含再投资和手续费/滑点假设。
- [INFERENCE] fee compounding 只有在收取、换币、再部署成本低且本金风险可控时才改善结果；复投会增加交易次数、MEV 暴露和错误操作面。

## HyperGrid 观测/模拟/执行映射

| 机制 | 可观测 | 可模拟 | 未来可执行（仅设计） |
| --- | --- | --- | --- |
| 区间活动 | pool、tick/bin、price、lower/upper、active liquidity | 历史 tick/swap 回放、in/out-of-range 状态 | G3 按安全检查创建/退出 position |
| Fee vs IL | feeGrowth/claim、库存、参考 HODL、价格路径 | path-dependent PnL attribution | G4 先限额；G3 仅执行已批准策略 |
| Inventory skew | token0/token1 amounts、净 delta、USD exposure | stress/gap、再入场和退出滑点 | G6 re-center 或 G4 halt |
| 流动性/对手盘 | TVL、active liquidity、swap volume、price impact、holder concentration | adverse-selection proxy、capacity curve | G1 过滤；G3 设 min-output/deadline |
| 退出 | range break、fee velocity、gas、withdraw/close quote | immediate vs delayed exit | G4 fail-closed；禁止自动追涨杀跌 |
| 协议/资产风险 | token code/metadata、tax、pause、admin、oracle | exploit/depeg/bridge scenario | G4 kill switch；不自动批准未知 token |

## 不做的推断

- [INFERENCE] “作者曾经某小时赚到很多 fee”不能推导为可复制的期望收益。
- [INFERENCE] “LP 容错率高于交易”不能推导为低风险；它只是将点时机风险换成路径、库存和退出风险。
- [INFERENCE] “自动再平衡有害”不能泛化到所有策略；应比较明确的 rule-based re-centering 与无脑高频迁移的成本/选择偏差。
