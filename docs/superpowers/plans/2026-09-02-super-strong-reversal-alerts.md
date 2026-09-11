# 超级强势破底翻／破顶翻 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不触发交易执行的前提下，统一生成结构反转的收盘突破强度、图表箭头、窗口扫描、归档与按小时／四小时合并的 Bark 通知。

**Architecture:** `lib/radar/reversal.ts` 成为基础形态、收盘突破跨度和箭头强度的唯一事实来源。扫描层对窗口内每根已收盘 K 线调用该逻辑，并将候选交给归档策略和 Bark 分组；维护端点只决定自然时间桶与调度，不重复实现形态规则。图表和雷达页面仅消费候选字段。

**Tech Stack:** Next.js/Vinext、TypeScript、Cloudflare D1、Binance Futures 公共 K 线、Lightweight Charts、Node test runner（通过 `tsx`）。

**Spec:** `docs/superpowers/specs/2026-09-02-super-strong-reversal-alerts-design.md`

**Status (2026-09-02):** 已实施并部署至 VPS；相关测试 55/55 通过，生产构建及 `/radar`、`/api/radar/reversal` 健康检查通过。

## Global Constraints

- 仅使用 Binance Futures 的已收盘 K 线；禁止在任何路径创建、取消或修改实盘订单。
- 基础反转继续固定为此前五根 K 线的流动性扫出与完整实体收回，强度不改变准入。
- `breakoutLookbackBars` 保留旧有“影线扫出跨度”语义；新增收盘突破字段，历史 JSON 缺失新字段须可读。
- 15m 普通信号不归档不推送；1h、4h 基础信号归档；只有 4h 普通信号在四小时 Bark 汇总中推送。
- 每条 Bark 候选按收盘突破根数降序、评分降序、币种升序排序；同时间桶重试不重复。
- 不增加第三方依赖，保持现有 TypeScript 风格与 D1 迁移方式。

---

### Task 1: 统一收盘突破强度模型

**Files:**
- Modify: `lib/radar/reversal.ts`
- Modify: `tests/reversal.test.mjs`

**Interfaces:**
- Produces: `ReversalCandidate.closeBreakoutLookbackBars: number`、`closeBreakoutLookbackCapped: boolean`。
- Produces: `calculateReversalStrength(candidate, interval)`，返回 `isSuperStrong` 与箭头数量；扫描候选与图表标记分别消费这个周期相关结果，`ReversalCandidate` 本身不依赖扫描周期。
- Consumes: 既有 `detectStructuralReversal(bars, direction, lookback?)`，保持调用兼容。

- [ ] **Step 1: 写出会失败的收盘突破与阈值边界测试**

```js
import { calculateReversalStrength, detectStructuralReversal } from "../lib/radar/reversal.ts";

test("uses closed prices, rather than wick sweeps, to measure breakout strength", () => {
  const candidate = detectStructuralReversal(longReversalWithTenPriorLowerCloses, "LONG");
  assert.equal(candidate?.closeBreakoutLookbackBars, 10);
  assert.equal(candidate?.breakoutLookbackBars, 5);
});

test("uses 14/10/5 closed-bar thresholds for 15m/1h/4h super strength", () => {
  assert.equal(calculateReversalStrength({ closeBreakoutLookbackBars: 13 }, "15m").isSuperStrong, false);
  assert.equal(calculateReversalStrength({ closeBreakoutLookbackBars: 14 }, "15m").isSuperStrong, true);
  assert.equal(calculateReversalStrength({ closeBreakoutLookbackBars: 10 }, "1h").isSuperStrong, true);
  assert.equal(calculateReversalStrength({ closeBreakoutLookbackBars: 5 }, "4h").strengthArrows, 2);
});
```

- [ ] **Step 2: 运行测试确认 Red**

Run: `npx --no-install tsx --test tests/reversal.test.mjs`  
Expected: FAIL，因为候选没有 `closeBreakoutLookbackBars`，且 `calculateReversalStrength` 未导出。

- [ ] **Step 3: 最小实现收盘突破及强度函数**

```ts
export type ReversalStrength = {
  strengthArrows: 1 | 2 | 3 | 4;
  isSuperStrong: boolean;
};

export type ReversalStrengthInterval = "15m" | "1h" | "4h" | "1d" | "1w";

export function calculateReversalStrength(
  candidate: Pick<ReversalCandidate, "closeBreakoutLookbackBars">,
  interval: ReversalStrengthInterval,
): ReversalStrength;
```

向后逐根比较 `signal.close` 与此前 `close`；LONG 遇到 `prior.close >= signal.close` 停止，SHORT 遇到 `prior.close <= signal.close` 停止。4h 的箭头阈值为 `1/5/10/20`，其余周期为 `1/10/20/30`；强势阈值严格采用规格中的 14/10/5。

- [ ] **Step 4: 运行领域测试确认 Green**

Run: `npx --no-install tsx --test tests/reversal.test.mjs`  
Expected: PASS，且现有基础形态和收益测试继续通过。

- [ ] **Step 5: 提交该独立变更**

```bash
git add lib/radar/reversal.ts tests/reversal.test.mjs
git commit -m "feat: score reversal close breakouts"
```

### Task 2: 窗口扫描、D1 字段与归档策略

**Files:**
- Modify: `lib/radar/reversal-snapshot.ts`
- Modify: `db/ensure.ts`
- Modify: `tests/reversal-snapshot.test.mjs`
- Create: `tests/reversal-archive-policy.test.mjs`

**Interfaces:**
- Consumes: `detectStructuralReversal` 与 `calculateReversalStrength`。
- Produces: `buildReversalScan(fetchers, interval, now, { signalWindowBars })`，可返回窗口内每个已收盘信号，而非只返回最后一根。
- Produces: `saveReversalScan(db, snapshot, { archiveIntervals })`，由调用方显式选择 `1h`、`4h`（以及既有 `1d`、`1w`）入归档。

- [ ] **Step 1: 写出窗口扫描和归档筛选的失败测试**

```js
test("finds an earlier 15m reversal inside the completed hourly window", async () => {
  const snapshot = await buildReversalScan(fetchersWithSignalInTheSecondNewestBar, "15m", now, { signalWindowBars: 4 });
  assert.deepEqual(snapshot.candidates.map((item) => item.signalTime), [secondNewestCloseTime]);
});

test("does not persist 15m reversals but preserves 1h and 4h archive records", async () => {
  await saveReversalScan(db, fifteenMinuteSnapshot, { archiveIntervals: ["1h", "4h"] });
  await saveReversalScan(db, oneHourSnapshot, { archiveIntervals: ["1h", "4h"] });
  assert.equal(insertedArchiveIntervals.join(","), "1h");
});
```

- [ ] **Step 2: 运行测试确认 Red**

Run: `npx --no-install tsx --test tests/reversal-snapshot.test.mjs tests/reversal-archive-policy.test.mjs`  
Expected: FAIL，因为扫描仅检查最后一根，保存函数没有归档周期参数。

- [ ] **Step 3: 实现逐根扫描与安全持久化**

为每个候选的前缀 K 线调用检测器，只保留最后 `signalWindowBars` 根的信号；每根仅允许 LONG 或 SHORT 之一。新增数据库列 `close_breakout_lookback_bars`、`close_breakout_lookback_capped`，在 `CREATE TABLE`、幂等 `ALTER TABLE` 和排序索引中均覆盖。读取旧 JSON 时默认为 `0` 和 `false`。

```ts
export type ReversalScanOptions = ScanProgressOptions & { signalWindowBars?: number };

export async function saveReversalScan(
  db: ReversalDb,
  snapshot: ReversalScanSnapshot,
  options?: { archiveIntervals?: readonly ReversalInterval[] },
): Promise<void>;
```

- [ ] **Step 4: 运行扫描、归档及 D1 相关测试确认 Green**

Run: `npx --no-install tsx --test tests/reversal.test.mjs tests/reversal-snapshot.test.mjs tests/reversal-archive-policy.test.mjs`  
Expected: PASS，15m 窗口不漏较早信号；归档只插入允许周期；旧候选仍可加载。

- [ ] **Step 5: 提交该独立变更**

```bash
git add lib/radar/reversal-snapshot.ts db/ensure.ts tests/reversal-snapshot.test.mjs tests/reversal-archive-policy.test.mjs
git commit -m "feat: scan and archive reversal windows"
```

### Task 3: Bark 合并、分层和排序

**Files:**
- Modify: `lib/radar/bark-notifications.ts`
- Modify: `tests/radar-bark-batching.test.mjs`
- Modify: `tests/bark-alerts.test.mjs`

**Interfaces:**
- Produces: `buildHourlySuperReversalBarkGroups(candidates, scanBucket)`，零或一条 15m/1h 超级强势通知。
- Produces: `buildFourHourlyReversalBarkGroups(candidates, scanBucket)`，零至两条：强势 15m/1h/4h 合并通知与普通 4h 合并通知。
- Produces: `notifyReversalBarkGroups({ db, groups, fetcher? })`，沿用 `notifyBark` 的投递去重。

- [ ] **Step 1: 写出通知内容、排序和空消息的失败测试**

```js
test("batches super candidates in closed-breakout descending order", () => {
  const groups = buildFourHourlyReversalBarkGroups([
    reversal("AAAUSDT", "1h", 10, true),
    reversal("BBBUSDT", "15m", 14, true),
    reversal("CCCUSDT", "4h", 5, true),
  ], "2026-09-02-16");
  assert.equal(groups[0].title, "超级强势破底翻／破顶翻");
  assert.ok(groups[0].body.indexOf("BBB") < groups[0].body.indexOf("AAA"));
});

test("sends only one ordinary four-hour summary and never includes 15m or 1h ordinary candidates", () => {
  const groups = buildFourHourlyReversalBarkGroups([ordinary15m, ordinary1h, ordinary4h], "2026-09-02-16");
  assert.equal(groups.length, 1);
  assert.match(groups[0].body, /普通4H/);
  assert.doesNotMatch(groups[0].body, /15M|1H/);
});
```

- [ ] **Step 2: 运行测试确认 Red**

Run: `npx --no-install tsx --test tests/radar-bark-batching.test.mjs tests/bark-alerts.test.mjs`  
Expected: FAIL，因为现有函数按“周期+方向+新增差异”拆分通知。

- [ ] **Step 3: 最小实现两类通知生成器**

每个条目格式为 `币种 · 多/空 · 周期 · 收盘突破近 N 根新高/新低 · ↑↑`。同根数用评分、币种打破平局。键分别使用：

```ts
`radar:reversal:hourly-super:${scanBucket}`
`radar:reversal:four-hour-super:${scanBucket}`
`radar:reversal:four-hour-ordinary:${scanBucket}`
```

不依赖“前一次快照差异”；窗口扫描本身就是本次候选的范围，`notifyBark` 的投递键负责同桶重试去重。

- [ ] **Step 4: 运行通知测试确认 Green**

Run: `npx --no-install tsx --test tests/radar-bark-batching.test.mjs tests/bark-alerts.test.mjs`  
Expected: PASS，三类键稳定，正常空集合不出消息，排序完全由收盘突破根数主导。

- [ ] **Step 5: 提交该独立变更**

```bash
git add lib/radar/bark-notifications.ts tests/radar-bark-batching.test.mjs tests/bark-alerts.test.mjs
git commit -m "feat: batch strong reversal bark alerts"
```

### Task 4: 小时／四小时维护编排

**Files:**
- Modify: `app/api/radar/reversal/route.ts`
- Modify: `app/api/advisory/maintenance/route.ts`
- Modify: `services/workbench/maintenance-schedule.mjs`
- Modify: `services/workbench/maintenance-scheduler.mjs`
- Modify: `tests/maintenance-runtime.test.mjs`
- Create: `tests/reversal-schedule.test.mjs`

**Interfaces:**
- Produces: `runScheduledReversalScans(now)`，返回小时和四小时扫描及各自 Bark 摘要。
- Consumes: Task 2 的 `signalWindowBars`，Task 3 的通知分组函数。
- Preserves: 手动扫描与日常 `1d`／`1w` 雷达操作不产生结构反转 Bark。

- [ ] **Step 1: 写出定时窗口及幂等调度失败测试**

```js
test("runs the hourly 15m×4 and 1h×1 reversal window at five minutes past every hour", () => {
  assert.deepEqual(dueJobs(new Date("2026-09-02T08:05:00.000Z")), ["atr-band", "reversal-hourly", "reversal-four-hour"]);
});

test("uses 16/4/1 bars for the four-hour 15m/1h/4h digest", async () => {
  const result = await runScheduledReversalScans(fixedFourHourClose);
  assert.deepEqual(result.fourHourly.windowBars, { "15m": 16, "1h": 4, "4h": 1 });
});
```

- [ ] **Step 2: 运行测试确认 Red**

Run: `npx --no-install tsx --test tests/maintenance-runtime.test.mjs tests/reversal-schedule.test.mjs`  
Expected: FAIL，因为当前维护任务只周期性扫描最新一根 4h，且没有小时窗口。

- [ ] **Step 3: 实现自然时间桶编排**

在 Asia/Shanghai 每个整点后五分钟执行小时扫描。逢四小时边界，同次维护额外执行四小时窗口并发送对应汇总；小时强势即时通知仍覆盖刚结束的一小时。日线／周线继续每日雷达快照，但以 `notify: false` 执行。维护摘要加入小时、四小时扫描数和 Bark 结果。

- [ ] **Step 4: 运行维护与 API 相关测试确认 Green**

Run: `npx --no-install tsx --test tests/maintenance-runtime.test.mjs tests/reversal-schedule.test.mjs tests/reversal-api.test.mjs`  
Expected: PASS，非四小时整点没有四小时消息；四小时整点使用 16/4/1 窗口；调度槽不重复。

- [ ] **Step 5: 提交该独立变更**

```bash
git add app/api/radar/reversal/route.ts app/api/advisory/maintenance/route.ts services/workbench/maintenance-schedule.mjs services/workbench/maintenance-scheduler.mjs tests/maintenance-runtime.test.mjs tests/reversal-schedule.test.mjs
git commit -m "feat: schedule reversal alert windows"
```

### Task 5: 图表箭头与雷达强度展示

**Files:**
- Modify: `app/trade/strategyMath.ts`
- Modify: `app/trade/TradeChart.tsx`
- Modify: `app/radar/page.tsx`
- Modify: `tests/trade-reversal-markers.test.mjs`
- Modify: `tests/radar-reversal-ui.test.mjs`

**Interfaces:**
- Consumes: Task 1 的 `calculateReversalStrength`，`TradeChart` 新增当前周期 prop `interval: ReversalInterval`。
- Produces: 图表标记 `text` 为重复方向箭头而不是固定 `!`；雷达表展示“收盘突破近 N 根”并能安全显示旧归档。

- [ ] **Step 1: 写出图表和雷达显示的失败测试**

```js
test("renders a two-arrow 4h marker after a five-closed-bar breakout", () => {
  assert.match(buildReversalMarkers(bars, "4h")[0].text, /↑↑/);
});

test("radar view displays the closed-price breakout label with a legacy fallback", async () => {
  const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  assert.match(source, /收盘突破近/);
  assert.match(source, /closeBreakoutLookbackBars \?\?/);
});
```

- [ ] **Step 2: 运行测试确认 Red**

Run: `npx --no-install tsx --test tests/trade-reversal-markers.test.mjs tests/radar-reversal-ui.test.mjs`  
Expected: FAIL，因为标记固定为 `!`，页面没有新字段。

- [ ] **Step 3: 最小实现消费统一强度模型**

将交易页当前选择周期传给 `TradeChart`，然后由 `buildReversalMarkers(bars, interval)` 产生只针对闭合 K 线、已排序、不会与成交标记重复的箭头。雷达页面把旧“突破强度”明确标为扫出跨度，并新增收盘突破列；旧 JSON 使用 `0`／`false` 安全渲染。

- [ ] **Step 4: 运行 UI／图表测试确认 Green**

Run: `npx --no-install tsx --test tests/trade-reversal-markers.test.mjs tests/radar-reversal-ui.test.mjs tests/trade-terminal-enhancements.test.mjs`  
Expected: PASS，所有标记时间有对应 K 线，切换周期不会将未收盘 K 线加入 marker。

- [ ] **Step 5: 提交该独立变更**

```bash
git add app/trade/strategyMath.ts app/trade/TradeChart.tsx app/radar/page.tsx tests/trade-reversal-markers.test.mjs tests/radar-reversal-ui.test.mjs
git commit -m "feat: display reversal breakout strength"
```

### Task 6: 集成验证与部署

**Files:**
- Modify: `docs/superpowers/specs/2026-09-02-super-strong-reversal-alerts-design.md`（仅在验证发现的规格澄清确有必要时）
- Modify: `docs/superpowers/plans/2026-09-02-super-strong-reversal-alerts.md`（勾选已完成步骤）

**Interfaces:**
- Consumes: Tasks 1–5 的全部实现与测试。
- Produces: 已构建、已部署且可读的只读雷达功能。

- [ ] **Step 1: 运行全部相关测试组**

Run: `npx --no-install tsx --test tests/reversal.test.mjs tests/reversal-snapshot.test.mjs tests/reversal-archive-policy.test.mjs tests/radar-bark-batching.test.mjs tests/bark-alerts.test.mjs tests/reversal-schedule.test.mjs tests/maintenance-runtime.test.mjs tests/trade-reversal-markers.test.mjs tests/radar-reversal-ui.test.mjs tests/reversal-api.test.mjs`  
Expected: PASS。

- [ ] **Step 2: 运行类型检查与生产构建**

Run: `npm run build`  
Expected: exit code 0；无 TypeScript 或路由构建错误。

- [ ] **Step 3: 审阅已部署文件清单并部署**

Run: `rsync -az --relative [modified source files] root@139.59.99.126:/opt/trade-workbench/`，随后远端停止服务、`npm run build`、启动服务并检查 `/radar` 与 `/api/radar/reversal` HTTP 200。  
Expected: systemd `active`，VPS 使用的是刚构建的版本。

- [ ] **Step 4: 提交实施记录**

```bash
git add docs/superpowers/plans/2026-09-02-super-strong-reversal-alerts.md
git commit -m "docs: record reversal alert verification"
```
