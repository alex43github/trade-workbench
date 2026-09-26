# 05 · Arbitrage Playbooks

本章把“套利”拆成资本路径，而不是把所有价差都称为无风险。每个 playbook 都必须先进入 G7 research/shadow，随后才可能由 G4 staging 评审；本任务不实现真实执行。

## 统一净边界

- [INFERENCE] 对任一 playbook，预期净收益应写成 `gross_edge - fees - slippage - gas - funding/borrow - latency_loss - failure_reserve - credit/smart_contract/risk_capital_charge`。
- [INFERENCE] 同一符号在不同 venue 的“价格”可能是 mark、index、oracle、last trade、mid 或 executable quote；没有 price semantics 就没有可比较的 edge。
- [AUTHOR_CLAIM | CJ:1908175169929302313; CJ:1910629234047139928] 作者把“预期收益 + 滑点控制”作为开/平仓的核心条件；本库扩展为完整 all-in cost 和 stale/unknown state。

## 1. Funding arbitrage

- [AUTHOR_CLAIM | CJ:1913110637544448479; CJ:2081272253535436978] 资本路径是一个 venue 持有 spot/现货暴露，另一个 venue 持相反方向 perp，通过资金费率获取现金流；作者同时提醒跨所平仓不能像现货一样直接搬仓。
- [VERIFIED_EXTERNAL_FACT | EX-HL-FUNDING](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/funding) Hyperliquid 的 funding 是多空之间的周期性支付，官方文档说明其按小时结算并以 `position_size × oracle_price × funding_rate` 计算；具体 venue 规则仍需分别读取。
- [INFERENCE] 前置条件：两腿可开、保证金/借币可用、方向和数量可对齐、资金费规则/结算时间已确认、可在同一风险窗口平仓。
- [INFERENCE] gross edge 是预测 funding cashflow；成本包括 maker/taker fee、现货借贷、转账/桥、价差、滑点、保证金占用和无法同步平仓的风险资本。
- [INFERENCE] latency 对开仓窗口和 funding snapshot 很重要，但持仓期风险通常来自 basis、借贷率、交易所信用、强平和腿错配；它不是无风险套利。
- [INFERENCE] unwind：先确认两腿成交/可用保证金，再逐腿减仓或对冲；若一腿挂起，进入 G4 partial-hedge 状态，禁止盲目补仓。
- [FAILURE | CJ:1913110637544448479; CJ:2002222238624592254] 失败模式包括 venue 暂停充提、资金费反转、滑点/市价失败、API 延迟、杠杆清算和退出流动性不足。

## 2. Perp/spot basis

- [INFERENCE] 资本路径是买 spot、卖 perp（或相反）并管理 basis convergence；与 funding arb 不同，收益来源可包含 basis 收敛、funding 和积分，但 basis 可能扩大。
- [AUTHOR_CLAIM | CJ:1758731597875126778; CJ:1906238617724625229] 归档中出现 Backpack 现货/合约循环和 Hyperliquid 对冲的案例；收益数字是作者叙述，不能视为可复现报价。
- [INFERENCE] 先定义 basis：`perp_mark - executable_spot_reference`，再定义持仓期限、结算、现货借贷、手续费和最坏 basis widening。
- [INFERENCE] 风险包括现货/合约标的不是同一资产、oracle/index divergence、交叉保证金、perp funding spike、现货无法卖出或合约强平。
- [INFERENCE] unwind 需要先验证 spot 可卖数量、perp 可减数量和保证金 headroom；若任意一个未知，G4 fail closed。

## 3. Cross-venue basis / funding

- [AUTHOR_CLAIM | CJ:1913110637544448479; CJ:1913575205576007986] 作者跨 venue 比较 spot/contract price、funding 和异常波动，并逐步扩展 venue 监控。
- [INFERENCE] 资本路径可为 venue A long + venue B short，也可为现货跨所低买高卖；前者通常不能把持仓“搬到另一所”平仓，后者受充提路径影响。
- [INFERENCE] gross edge 必须是同一时间窗可执行的 bid/ask depth，而不是两张屏幕的 last price；成本含两边 fee、transfer/bridge、资金占用、限频和失败腿 reserve。
- [INFERENCE] latency/availability 依赖强；应记录每一腿 quote age、submit-to-ack、fill-to-hedge 和 hedge slippage。
- [FAILURE | CJ:1913110637544448479; CJ:1908918455224709189] 充提关闭、单腿成交、深度不足、滑点估算错误和 API 失联是首要失败模式。

## 4. Cross-DEX/CEX divergence

- [AUTHOR_CLAIM | CJ:1911498758875189715; CJ:1980461247830323367] 归档记录过 CEX/DEX 或 Hyperliquid spot 的短时插针/价差路径，但也明确窗口短、池子小或公开后不再继续。
- [INFERENCE] 资本路径：在便宜市场买入、在贵市场卖出/对冲；必须先确认 token identity、链、可转移性、池子/订单簿深度、借币和交易权限。
- [INFERENCE] gross edge 只有在两侧同时 executable 后才成立；成本包含 AMM price impact、CEX fee、gas、bridge/transfer、withdrawal delay、MEV、税和失败交易。
- [INFERENCE] 新 token 还要把 token tax、blacklist、pause、非标准 transfer、admin upgrade 和 oracle 操纵作为硬风险，而非把价格差当免费钱。
- [INFERENCE] unwind：保留两侧库存或稳定币 buffer；不能把跨链转账完成时间当作即时对冲。

## 5. Stablecoin / lending-rate arbitrage

- [AUTHOR_CLAIM | CJ:1953005005335560201; CJ:1971711369511862528] 归档出现稳定币存款、借出另一资产、换成 LST/LP，以及稳定币循环贷和活动利差路径。
- [INFERENCE] 资本路径：存入高收益资产 → 借入低成本资产/另一稳定币 → 兑换或再存入 → 维持抵押率；gross edge 是利差 + 可兑现激励，不能把积分按面值计入。
- [INFERENCE] 前置条件：借贷协议健康、抵押品/借款资产深度足够、LTV/清算阈值、利率模型和活动截止时间可读。
- [INFERENCE] 风险包括 depeg、borrow rate spike、oracle lag、清算、协议 exploit、利率活动结束和退出流动性消失。
- [INFERENCE] unwind：先降杠杆/偿还借款，再取回抵押品；若资产 depeg 或市场冻结，应按照预置 LTV buffer 触发 halt，而不是追加风险。

## 6. Borrow/lend loops

- [AUTHOR_CLAIM | CJ:1960401224773328941] 多账户/子账户被作者描述为提高额度利用率的操作方式；这不是协议无风险额度，也可能触发平台风控或合规限制。
- [INFERENCE] 循环的 gross edge 是激励/存款收益减借款利率；净收益必须对每一循环层记录本金、抵押品、borrow APR、liquidation price、gas/操作成本。
- [INFERENCE] 层数越多，利率、oracle、清算和操作故障的联合概率越高；G7 应比较一层、两层和 capped loop，而非默认拉满。
- [FAILURE] 抵押品价格下跌、借款利率跳升、stablecoin depeg、协议暂停、价格源异常或偿还路径失效都要求 fail closed。

## 7. Pendle / PT-style fixed-rate and rate-spread

- [VERIFIED_EXTERNAL_FACT | EX-PENDLE-PT](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/PT) Pendle 官方定义 PT 表示生息资产本金部分、到期可按规则赎回；YT 承接到期前的浮动收益/积分。具体市场的 accounting asset、到期和风险仍需读取。
- [AUTHOR_CLAIM | CJ:1969731767352660075; CJ:1967786496104206735] 作者讨论 PT/YT 对冲、不同池对冲、杠杆循环和监控巨鲸交易造成的溢价/价差。
- [INFERENCE] 资本路径：买折价 PT 锁定到期本金，或持有 YT/现货/另一池的相反收益暴露；gross edge 可能来自 implied yield 与 realized yield 的差、PT 溢价或跨池价格差。
- [INFERENCE] 成本/风险：swap fee、AMM price impact、提前退出 discount、underlying yield 变化、smart-contract/oracle/underlying protocol 风险、maturity liquidity 和 points 估值不确定性。
- [INFERENCE] unwind：到期赎回、二级卖出或用相反腿对冲；必须将“持有到期”与“中途退出”分开回测。

## 8. Prediction market / perp / event-market paths

- [AUTHOR_CLAIM | CJ:2034189833032331265; CJ:1981030639077114198] 归档讨论 5/15 分钟 up/down、事件临近的扫尾盘和需要脚本处理的提前退出/回测陷阱。
- [AUTHOR_CLAIM | CJ:2095540867306283493] 归档还记录 Polymarket 开 perp 后可能产生新的跨产品路径；这是当时观察，不是当前产品状态保证。
- [INFERENCE] 资本路径：事件 outcome/短周期合约与 perp/现货或另一市场建立概率/价格/方向对冲；gross edge 是概率与可执行价格的差，必须扣取结算规则、手续费、流动性和时间风险。
- [INFERENCE] 失败模式：事件定义/结算 oracle 不同、价格在到期前无法兑现、尾盘流动性消失、模型回测使用未来信息、单边 outcome exposure。
- [INFERENCE] G7 只允许 shadow，直到结算规则、历史 order book、fill model 和 out-of-sample 结果齐全。

## 9. New-chain / launch-phase structural edge

- [AUTHOR_CLAIM | CJ:2094582598022664265; CJ:2093977225943232670] 作者把新链/早期生态的流动性割裂和散户流量视为 LP/套利机会，并从成熟 perp 利润下降转向新场景。
- [INFERENCE] 这是 edge 生命周期模型：上线初期 volume/dispersion/fee 可能高，随后专业资金和规则变化会压低 edge；必须观测 half-life、参与者变化和退出容量。
- [INFERENCE] 前置条件：链稳定、桥/充提可用、池/市场列表可信、协议权限/升级风险可接受、监控和 emergency exit 可用。
- [FAILURE] 新链拥堵、RPC/indexer 不一致、桥风险、合约漏洞、流动性撤走、规则/积分改变和 edge decay 都可能把 gross edge 变成无法退出的库存。

## Playbook 统一验收表

每个 G7 研究结果至少包含：`capital_path`、`prerequisites`、`gross_edge`、`all_in_costs`、`latency_dependency`、`inventory_exposure`、`liquidation_credit_contract_risk`、`unwind_path`、`failure_modes`、`regime`、`source_ids`、`hypothesis_id`。

[INFERENCE] 未填写任一字段的候选只能进入 research backlog，不得进入 G3/G4。
