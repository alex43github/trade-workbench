# 13 · Implementation Checklist

## 本任务交付验收

- [x] [OBSERVATION] 固定公开仓库提交、文件 URL、blob/SHA-256 与抓取口径。
- [x] [OBSERVATION] 502 帖子完整索引，ID/URL 去重通过，正文未写入知识库。
- [x] [OBSERVATION] 28 手册课题完整索引，保留 `t-01`…`t-28` 锚点和精选原推 provenance。
- [x] [INFERENCE] JSON 9 标签与 HTML 28 课题明确分层，未伪造 28 个标签。
- [x] [INFERENCE] 机制、数字规则、外部协议事实和待测假设分开。
- [x] [INFERENCE] LP/CLMM、grid、funding/basis、lending/borrow、Pendle、event market、new-chain、MEV、风险和监控均有章节。
- [x] [OBSERVATION] coverage、ID、CSV、link、secret、diff 检查已设计为可重复脚本/命令。

## G1 Candidate Scanner

- [ ] 读取池/venue 的 canonical token ordering、price source、TVL/depth、fee/funding/borrow 和更新时间。
- [ ] 过滤税/限制/可撤流动性/权限/桥/协议风险。
- [ ] 输出 gross edge、all-in cost、capacity、inventory direction、regime、source IDs 和 hypothesis ID。
- [ ] 对边际收益和 edge half-life 做时间切片，禁止用重复提及替代统计证据。

## G2 Shadow Grid Engine

- [ ] 支持 static/adaptive、arithmetic/geometric、synthetic swap、CLMM/DLMM、basis multi-leg。
- [ ] 回放 partial fills、gap/trend、range break、fee/IL/HODL、gas/slippage/failed tx、borrow/funding 和退出。
- [ ] 对 10%/5%、3000%/1000%、固定 level 数等规则只以 hypothesis config 运行，不写死。
- [ ] 产出可重放的输入快照、版本、seed、PnL attribution 和审计结果。

## G3 Execution Engine（后续授权）

- [ ] 先做纸面/测试网对账；不以 timeout 推断未执行。
- [ ] quote freshness、min-output、amount-in-max、deadline、nonce/replacement/reorg/unknown 完整覆盖。
- [ ] 每腿 idempotency、partial fill、hedge reservation、reconciliation 通过 adversarial tests。
- [ ] 通过 G4 批准后才可能使用真实执行；本任务不实现。

## G4 Safety / Staging

- [ ] stale/ambiguous data、token ordering、oracle/index disagreement、inventory/liq/liq-distance、MEV/gas 和 counterparty 风险 fail closed。
- [ ] kill switch、manual approval、dry-run、halt/restart reason 和审计事件完整。
- [ ] 任何协议/资产/桥风险不能由高 APR 豁免。

## G5 Dashboard

- [ ] 显示 raw vs normalized、gross vs net、fee vs IL/HODL、inventory、capacity、execution quality、data age、evidence/hypothesis status。
- [ ] 告警去重但保留原始事件，restart 要引用 halt 和新快照。

## G6 Adaptive Grid

- [ ] 只有 walk-forward/out-of-sample 成功的 spacing/center/exit policy 才能候选接入。
- [ ] 对照组必须包含 no-action、static、rule-based 和无脑 rebalancing/迁移。
- [ ] 所有迁移动作先计算撤仓、换仓、gas、slippage、MEV 和库存风险。

## G7 Arbitrage Research / Execution

- [ ] 每个 playbook 具备 capital path、prerequisites、gross/net edge、costs、latency、inventory、liquidation/credit/smart-contract risk、unwind、failure、regime。
- [ ] funding、perp/spot、cross-venue、DEX/CEX、stable/lending、borrow loop、Pendle、event market 和 new-chain 分开回测。
- [ ] 官方协议规则与作者经验分开存证；活动/积分不按面值默认计入收益。

## 绝对 stop gate

- [ ] 不读取或提交 private keys、seed phrases、cookies、auth headers、钱包秘密。
- [ ] 不连接生产钱包、不签名、不发交易、不批准 token、不 swap。
- [ ] 不部署/重启 VPS，不修改 Binance/Bybit gateway，不开启 live trading。
- [ ] 不把本知识库数字阈值直接写成生产规则。
