# 00 · Source Manifest

## 固定来源

| 层 | 来源 | 固定版本/哈希 | 作用 |
| --- | --- | --- | --- |
| 原始仓库 | [`suoha888/Trader-Archives`](https://github.com/suoha888/Trader-Archives) | `ea2bd6849a9f12efafce13bfd0a49996f2475a76` | public raw repository |
| 帖子 JSON | [`cj/data/cj_arbitrage_lp_tweets.json`](https://github.com/suoha888/Trader-Archives/blob/ea2bd6849a9f12efafce13bfd0a49996f2475a76/cj/data/cj_arbitrage_lp_tweets.json) | Git blob `a235487c3856f3fdfec0a043f92c8001963f21ea`; SHA-256 `2c332a598002274784250bea5e23c21498e25018524d8768852cf43e2972aafd` | canonical structured posts |
| 帖子 CSV | [`cj/data/cj_arbitrage_lp_tweets.csv`](https://github.com/suoha888/Trader-Archives/blob/ea2bd6849a9f12efafce13bfd0a49996f2475a76/cj/data/cj_arbitrage_lp_tweets.csv) | Git blob `1d87a73b332657c0f0ee817c2b7a367555cb5ec4`; SHA-256 `13ff6f348d44b7127dfb0b858a682d3bf5b4c01f8372478e971587649f922063` | cross-check and human-readable export |
| 手册索引 | [`cj/index.html`](https://github.com/suoha888/Trader-Archives/blob/ea2bd6849a9f12efafce13bfd0a49996f2475a76/cj/index.html) | Git blob `ba00d8af55a58b7632a2062a4cf4a21b4bfb381e`; 714,910 bytes | 28 课题标题、锚点与精选来源 ID |
| 方法论页 | [`cj/docs/CJ_LP_Arbitrage_Methodology.md`](https://github.com/suoha888/Trader-Archives/blob/ea2bd6849a9f12efafce13bfd0a4990becd39/cj/docs/CJ_LP_Arbitrage_Methodology.md) | Git blob `d41af028c14915df0fe410cf62ccca4990becd39`; SHA-256 `862a38c0e233ae2d6f2f0e98d2281047b43d0fa30e75df53b1bea9e1c9d37b62` | 研究者整理的 14 个机制标题；不是作者原文 |

## 覆盖证明

| 指标 | 观察值 | 口径 |
| --- | ---: | --- |
| `DISCOVERED_POSTS` | 502 | JSON 数组长度；CSV 为 503 行（含 1 行 header） |
| `PROCESSED_POSTS` | 502 | `source-index.json` 一对象对应一个 JSON 记录 |
| 唯一帖子 ID | 502 | JSON ID 去重后仍为 502 |
| 唯一帖子 URL | 502 | URL 去重后仍为 502 |
| `DISCOVERED_TOPICS` | 28 | HTML 导航 `t-01`…`t-28`；排除免责声明 |
| `PROCESSED_TOPICS` | 28 | `topic-index.json` 一对象对应一个锚点课题 |
| JSON 标签数 | 9 | `交易心智`、`衍生品套利`、`收益与费率`、`挂单算法`、`方向性战法`、`无常对冲`、`选品标准`、`风控与防守`、`Robin链` |
| 媒体帖子/媒体总数 | 111 / 123 | 仅作为来源元数据，不复制图片 |
| 日期范围 | 2022-11-12…2026-09-05 | 按 JSON `date` 解析为 UTC |

[OBSERVATION | archive] 用户给出的 502 帖子 / 28 主题目标均被实际观察到；差异只在“28 主题不是 28 个帖子标签”。

## 单项 provenance

`source-index.json` 是逐项 manifest：每个对象至少包含 `source_id`、`date_raw`、`date_utc`、`title=null`、`topic_tags`、`handbook_topic_ids`、`url`、原始文件名和 `media_count`。`topic-index.json` 是逐课题 manifest，保留公开 HTML 锚点和该课题精选的原推 ID。

[INFERENCE | provenance] 课题页的精选关联只覆盖 54 个有课题链接的帖子对象，不能据此声称其余 448 个帖子没有相关机制；其余帖子的完整处理以 JSON/CSV 元数据索引和关键词/标签审查为准。

## 去重、冲突与时间变化

- [OBSERVATION | archive] JSON/CSV 的稳定 ID 与 URL 无重复；相同机制在不同帖子中重复出现时，claims 只保留一个规范化 claim，并在 `source_ids` 中合并 provenance。
- [INFERENCE | synthesis] 同一机制的重复频率只表示作者反复谈及，不表示收益概率或统计显著性。
- [OBSERVATION | archive] 早期归档主要出现 Meteora/LP、Backpack/资金费和脚本构建；后期出现跨多个 perp、预测市场和 Robin 新链的切换。
- [AUTHOR_CLAIM | CJ:2095097321096970650; CJ:2095407005544685712] 作者在后期明确表示 LP 已从“捡钱模式”进入专业玩家模式，且公开后收益会下滑；这是时间变化记录，不是全市场事实。
- [AUTHOR_CLAIM | CJ:1933013337576780181; CJ:2080291927170400660] 作者反对 LP 自动再平衡，但同时讨论过 perp 的移动网格/动态参数；本库把它们分成 LP 头寸迁移与衍生品报价策略，避免把两个语境合并。
