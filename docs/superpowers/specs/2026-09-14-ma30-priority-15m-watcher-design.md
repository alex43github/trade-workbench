# MA30 Priority 15m Watcher Design

## Goal

在现有 1H MA30 全市场发现器之后增加一个完全独立的“重点观察 + 15m 时机层”。1H 继续负责找币；15m 只跟踪少量候选，识别回调后的二次点火，以及用户明确要求的 15m / 1H K 线实体穿越 MA30 收盘事件，并通过 Bark 立即通知。该功能先开发和测试，不接入生产 timer；待现有 MA30 夜间验收完成后再部署。

## Safety / isolation

- 不改变现有 A/B/C/SHORT/AI 的排名、阈值、生命周期或 1H production cycle。
- 不进行任何真实下单，不调用交易接口。
- 新 watcher 只使用 Binance 公共已收盘 K 线和现有 Bark 基础设施。
- 生产上线前单独验收，默认不启用 timer。
- 重点观察池可承载未来的 OI/Funding/Taker squeeze enrichment，但本次 V1 不把这些数据写回 MA30 主排名。

## Priority watchlist

每次 1H MA30 scan 完成后，从扫描结果生成/刷新重点观察候选：

- LONG：C 组全部；AI LONG；A/B 中 stage 属于 `STEADY_UPTREND` / `EARLY_ACCELERATION` / `PERSISTENT_ACCELERATION` 的币。
- SHORT：现有 `shorts`；AI SHORT。
- 排除 `LATE_EXTENSION` 和 `NOT_CANDIDATE` 的 A/B-only LONG。
- 同一 symbol+direction 合并来源，保留 A/B/C/AI/SHORT 来源标签与排名。
- 观察池采用 sticky TTL：最后一次满足 1H 入池条件后继续保留 8 小时，允许“入池 → 调整数小时 → 二次点火”仍被 15m watcher 捕获。
- 如果同一 symbol 同时出现相反方向，优先 AI direction；否则以明确 C/SHORT 方向消除同轮多空冲突，避免同一个币同一轮同时发多空提醒。

## Closed-bar timing

计划生产 timer 在北京时间每小时 `:04 / :19 / :34 / :49` 运行。只读取完整收盘 K：

- 15m：每轮读取最新闭合 15m。
- 1H：每轮也检查最新闭合 1H，但以 `symbol + interval + closeTime + direction` 去重，因此每根 1H 只会提醒一次。
- `:04` 留出整点 1H 扫描 `:02` 完成并刷新重点观察池的时间。

## MA30 body-cross signal

用户明确要求的独立提醒，和“二次点火”信号分开。

对某一根已经完整收盘的 K，先以该根收盘后得到的 SMA30 作为该 candle 的 MA30 值：

- LONG cross：`open < MA30 && close > MA30`。
- SHORT cross：`open > MA30 && close < MA30`。
- 等于 MA30 不算穿越，避免边界抖动。
- 只对当前重点观察池里的币判断。
- 同一根 K 同一方向只提醒一次。
- 15m 和 1H 分开聚合 Bark；一个币就列一行，多个币同一条消息逐行列出全部名单。

示例：

```text
重点观察｜MA30上穿｜15m
1.KOMA，实体上穿MA30，+0.6%，初加速
2.REZ，实体上穿MA30，+0.2%，稳步上涨
```

空头反向显示“实体下穿MA30”。

## Re-ignition V1

二次点火是另一类事件，必须先出现调整，再出现重新突破；MA30 body-cross 不等于二次点火。

LONG V1：

1. 1H 大方向仍有效：最新 1H MA30 的 20-bar log slope > 0。
2. 观察期内出现真实 pullback：最近 32 根 15m（最多约 8 小时）中，至少一根 close <= 15m MA30，或从这段窗口内的 close 路径回撤至少 `0.75 * ATR14`。这样可以覆盖用户描述的“调整几个小时后重新点火”，而不是只记最近 2 小时。
3. 点火 bar 为完整收盘 15m：close > MA30、close > 前 3 根 15m high 的最高值、close > open。
4. 防止追晚：点火 close 距 15m MA30 不得超过 `2.0 * ATR14`。

SHORT 完全镜像：1H slope20 < 0；最近 32 根 15m 中至少一根 close >= MA30 或从窗口低位反弹至少 0.75 ATR；点火 bar close < MA30、跌破前 3 根 low、close < open；距离 MA30 不超过 2 ATR。

上述参数均作为常量集中定义，后续可以用真实事件结果做 replay / 调参，不在运行时偷偷改变。

## State and dedupe

逻辑状态按 `symbol + direction` 维护。实现以时间戳表达 `WATCHING → PULLBACK_SEEN → IGNITED`：

- `lastPullbackAt`
- `lastIgnitedPullbackAt`
- `lastIgnitedAt`

只有出现比上次 ignition 更新的 pullback，才允许下一次二次点火提醒。

事件键：

- MA cross：`ma30-cross:{symbol}:{interval}:{closeTime}:{direction}`
- re-ignition：`ma30-reignite:{symbol}:15m:{closeTime}:{direction}`

生产 persistence 保存 watchlist snapshot、状态、运行记录与事件；Bark 仍使用现有 delivery dedupe。小时发现源只读取最新 `FULL` MA30 run，`PARTIAL` 不刷新重点池。

## Bark policy

- MA30 cross 和二次点火分开通知，避免语义混淆。
- 一个 interval+direction+eventType 在同一轮尽量聚合为一条 Bark；每个币一行。
- 不因为普通排名变化每 15m 重复 Bark。
- 02:00–08:00 BJT 是否允许这些“时机型”提醒绕过主 MA30 静默窗，生产上线前必须明确决定；当前准备好的 service 为 DRY_RUN，不擅自选择任何 live 夜间策略。

## Acceptance before production enable

1. 纯函数测试覆盖：入池合并、8h TTL、15m/1H 上下穿、边界不触发、重复事件键、LONG/SHORT 二次点火镜像、数小时后仍可识别的 pullback。
2. watcher cycle 测试：只扫描 priority symbols，不扫全市场；只用 closed bars；同一 1H candle 在 4 次 15m run 中只产生一次事件。
3. MA30 现有测试保持 green；整个新 watcher 专项测试 green。
4. VPS dry-run 用真实 priority pool 跑至少 4 个连续 15m bucket，确认无下单、无重复 Bark。
5. 现有 MA30 夜间验收完成后才安装/enable `:04/:19/:34/:49` timer。