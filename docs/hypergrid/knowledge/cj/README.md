# CJ Arbitrage / LP Knowledge Base

本目录是 HyperGrid 的研究输入，不是交易信号、投资建议或生产执行规则。它把 CJ 公开归档中的机制、经验、失败模式和工程线索转成可追溯、可证伪的研究对象。

## 语料边界

- [OBSERVATION | archive] 原始公开仓库为 [`suoha888/Trader-Archives`](https://github.com/suoha888/Trader-Archives)，本次固定到提交 `ea2bd6849a9f12efafce13bfd0a49996f2475a76`。
- [OBSERVATION | archive] JSON 数据文件含 502 条帖子，CSV 含 502 条数据行；两者的帖子 ID 与 URL 均为 502 个且无重复。
- [OBSERVATION | archive] JSON 的帖子标签为 9 个；HTML 手册目录为 28 个核心课题。两者是不同层级的 taxonomy，不能混为 28 个 JSON 标签。
- [OBSERVATION | archive] 帖子日期范围为 2022-11-12 至 2026-09-05；公共数据不提供每条帖子的标题，因此 `source-index.json` 的 `title` 保留为 `null`，不人为编造标题。
- [INFERENCE | scope] “502/28 全量”在本任务中分别表示 502 个结构化帖子对象和 28 个手册课题均已索引/处理；课题页只为部分帖子提供精选关联 ID，不声称每条帖子都被手册正文逐条引用。

## 证据标签

每个机制性判断都应带以下标签之一：

- `AUTHOR_CLAIM`：作者表达的规则、偏好、经验或收益叙述；重复出现也不会升级为事实。
- `OBSERVATION`：归档中可直接观察到的事件、数字、代码/工具描述或时间变化。
- `INFERENCE`：本知识库根据来源做出的抽象、工程化或待验证推断。
- `VERIFIED_EXTERNAL_FACT`：由协议/官方文档独立核验的机制事实；只用于事实边界，不用于证明收益。

所有 APR、区间宽度、层数、止损/退出阈值和收益数字都默认需要回测或前测，除非明确标为协议常数并给出官方来源。

## 文件地图

| 文件 | 用途 |
| --- | --- |
| `00_SOURCE_MANIFEST.md` | 原始仓库、提交、文件哈希、覆盖口径与 provenance |
| `source-index.json` | 502 个帖子的一行/对象级索引；不含全文 |
| `topic-index.json` | 28 个手册课题、卷、锚点及精选原推 ID |
| `01_EXECUTIVE_MODEL.md` | 总体机制模型、状态机、证据边界和时间变化 |
| `02_LP_MARKET_MAKING.md` | LP/CLMM、主动/被动做市和头寸管理 |
| `03_GRID_AND_POSITION_SIZING.md` | 静态/自适应/合成网格与仓位分配 |
| `04_FEE_VS_IL_MATH.md` | Fee、IL、库存、滑点、gas 与 break-even |
| `05_ARBITRAGE_PLAYBOOKS.md` | 资金费、基差、跨场所、借贷、Pendle、预测市场、新链 |
| `06_EXECUTION_AND_MEV.md` | 延迟、区块、MEV、RPC、报价和失败交易 |
| `07_RISK_FAILURE_MODES.md` | 风险登记表、失效条件和停机原则 |
| `08_MONITORING_AND_ALERTS.md` | 可观测字段、告警和审计事件 |
| `09_ENGINEERING_ARCHITECTURE.md` | 研究、影子、执行隔离和数据契约 |
| `10_PRODUCT_REQUIREMENTS_FOR_HYPERGRID.md` | G1–G7 产品/工程映射 |
| `11_HYPOTHESES_TO_BACKTEST.md` | 可证伪假设注册表 |
| `12_CLAIMS_EVIDENCE_MATRIX.csv` | 规范化 claims/evidence 矩阵 |
| `13_IMPLEMENTATION_CHECKLIST.md` | 后续实现前的 checklist；本任务不实现 live execution |
| `DRIVE_SYNC_PENDING.md` | GitHub 为 canonical；Drive 安全写入不可用时的待同步说明 |

## 生成与校验

在拥有公开归档临时 clone 的环境中，可以这样重新生成无全文的帖子索引：

```sh
node scripts/hypergrid-cj-build-index.mjs \
  --source-json /path/to/Trader-Archives/cj/data/cj_arbitrage_lp_tweets.json \
  --source-commit ea2bd6849a9f12efafce13bfd0a49996f2475a76
node scripts/hypergrid-cj-coverage.mjs
```

脚本只把 ID、日期、URL、标签、精选课题 ID 和媒体数量写入索引，不复制帖子正文。

## 安全边界

- [INFERENCE | safety] 本目录只供 G1–G7 的研究、影子模拟、告警和安全 staging 使用；任何盈利叙述都不能直接转成生产参数。
- [OBSERVATION | task gate] 本任务未连接钱包、未读取密钥、未签名/发送交易、未改动网关、未部署服务、未启用 live trading。
- [INFERENCE | copyright] 不保存完整推文、完整 HTML 或图片；只保留公开稳定 ID/URL、必要的短标签和原创归纳。
