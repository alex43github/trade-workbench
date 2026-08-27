# Vegas 通道与多周期强势币筛选 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** 在不改变现有交易保护和 MA30 过滤语义的前提下，为 TradingView 风格图表加入可调 Vegas 双通道，为所有筛币窗口加入已收盘 K 线 MA30 三档归档和 1h/4h/1d Vegas 排列筛选，并让合约页实盘开关默认开启且保留服务端安全闸门。

**Architecture:** 用独立纯函数模块计算收盘 K 线的 MA30 与四条 EMA，并由独立的多周期快照 API 负责受保护的手动扫描和 SQLite 持久化。雷达页面把快照作为原有候选结果的后置筛选，不改变原有评分和来源；交易图表把 Vegas 作为只读指标设置的一部分，浏览器偏好与服务端真实下单条件分离。

**Tech Stack:** Next.js/Vinext、React 19、TypeScript、SQLite/Drizzle 兼容 SQL、Node test runner、lightweight-charts 5、Binance Futures 公共 K 线接口。

**Spec:** docs/superpowers/specs/2026-08-27-vegas-multitimeframe-screening-design.md

## Global Constraints

- MA30 和 Vegas 均只使用 Binance Futures 最新一根完整收盘 K 线；形成中的 K 线、数据不足、失败或过期快照不得算作满足。
- 四条 Vegas 线固定默认周期 144 / 169 / 576 / 676；EMA144/EMA169 同色，EMA576/EMA676 同色；周期、两组颜色和线宽可调。
- Vegas 排列必须严格满足 MA30 > EMA144 > EMA169 > EMA576 > EMA676，并分别展示 1h、4h、1d 档位；同币可出现在多个档位。
- MA30 三档是当前窗口原候选集的后置子集筛选，按钮为 K 线站上 15 分钟 MA30、K 线站上 1 小时 MA30、K 线站上 4 小时 MA30。
- 手动扫描沿用 operator guard、限频、进度状态和显式失败诊断；不触碰 Binance gateway、账户数据或服务端实盘开关。
- 实盘开关页面默认开启并可保存 UI 偏好，但账户连接、operator guard、服务端开关和最终确认仍是下单必要条件。
- 不新增依赖；保留现有 worktree 中与本任务无关的改动。

---

### Task 1: 多周期收盘指标与 Vegas 快照扫描器

**Files:**
- Create: lib/radar/vegas.ts
- Create: lib/radar/multitimeframe.ts
- Test: tests/radar-multitimeframe.test.mjs

**Interfaces:**
- vegas.ts produces calculateSma, calculateEmaValue, calculateVegasValues, passesVegasAlignment and typed timeframe indicator snapshots.
- multitimeframe.ts consumes ClosedBar arrays and an injected fetchClosedBars callback, and produces a serializable snapshot containing per-symbol 15m/1h/4h MA30 status plus 1h/4h/1d Vegas matches.

- [x] Step 1: Write failing pure-function tests

~~~js
test("Vegas alignment requires strict MA30 and EMA ordering", async () => {
  const { passesVegasAlignment } = await import("../lib/radar/vegas.ts");
  assert.equal(passesVegasAlignment({ close: 10, ma30: 9, ema144: 8, ema169: 7, ema576: 6, ema676: 5 }), true);
  assert.equal(passesVegasAlignment({ close: 10, ma30: 9, ema144: 8, ema169: 8, ema576: 6, ema676: 5 }), false);
});

test("insufficient history never produces a Vegas match", async () => {
  const { buildMultiTimeframeSnapshot } = await import("../lib/radar/multitimeframe.ts");
  const result = await buildMultiTimeframeSnapshot(["BTCUSDT"], new Date("2026-08-27T00:00:00Z"), {
    fetchClosedBars: async () => Array.from({ length: 675 }, (_, index) => ({
      openTime: index * 3_600_000, closeTime: index * 3_600_000 + 3_599_000,
      open: 1, high: 1, low: 1, close: 1, volume: 1,
    })),
  });
  assert.deepEqual(result.vegas["1h"], []);
  assert.match(result.warning ?? "", /676/);
});
~~~

- [x] Step 2: Run the focused tests and confirm they fail

Run: node --test tests/radar-multitimeframe.test.mjs

Expected: FAIL because the new indicator and scanner modules do not exist yet.

- [x] Step 3: Implement finite, strict indicator calculations

Implement SMA as a trailing window whose last value is returned only when values.length is at least the period; implement EMA with the existing chart convention (seed from the first close and return only after the required period); reject non-finite values; expose close, ma30, ema144, ema169, ema576, and ema676.

- [x] Step 4: Implement the injected multi-timeframe scanner

Normalize and deduplicate Binance symbols, call the fetcher for 15m, 1h, 4h, and 1d, sort bars by close time, discard bars with closeTime after now, calculate the MA30 buckets from the last closed bar, calculate Vegas only with all 676 closes, and return status, scannedAt, bySymbol, vegas, scannedSymbols, successfulSymbols, failedSymbols, and a human-readable warning. A failed interval must stay absent/false rather than becoming a match.

- [x] Step 5: Run the focused tests and confirm they pass

Run: node --test tests/radar-multitimeframe.test.mjs

Expected: PASS, including strict inequality and incomplete-history cases.

### Task 2: Persistent multi-timeframe API and schema

**Files:**
- Modify: lib/radar/binance-public.ts
- Modify: db/ensure.ts
- Create: app/api/radar/multitimeframe/route.ts
- Test: tests/radar-multitimeframe-api.test.mjs

**Interfaces:**
- The route accepts GET for the latest saved snapshot and guarded POST with { symbols: string[] } for a manual scan.
- Persistence uses radar_multitimeframe_snapshots with one latest JSON snapshot and status metadata; it must survive a page refresh without triggering duplicate scans.

- [x] Step 1: Write source-contract tests for the API

~~~js
test("multi-timeframe route has read and guarded manual scan paths", async () => {
  const source = await readFile(new URL("../app/api/radar/multitimeframe/route.ts", import.meta.url), "utf8");
  assert.match(source, /export async function GET/);
  assert.match(source, /export async function POST/);
  assert.match(source, /requireOperatorMutation/);
  assert.match(source, /radar_multitimeframe_snapshots/);
  assert.match(source, /pending/);
});
~~~

- [x] Step 2: Run the API contract test and confirm it fails

Run: node --test tests/radar-multitimeframe-api.test.mjs

Expected: FAIL because the route and table do not exist.

- [x] Step 3: Extend the public K-line fetcher

Allow 15m as a BinanceKlineInterval, add a bounded limit argument capped at Binance’s 1000 rows, and preserve existing callers. Every returned ClosedBar must continue to carry open and close times so the scanner can enforce the closed-bar cutoff.

- [x] Step 4: Add the snapshot table and route

Create radar_multitimeframe_snapshots with id, status, scanned_at, symbols_json, snapshot_json, and warning; add an index on scanned_at. GET loads the newest valid row. POST validates at most 100 symbols, stores a pending row, scans through the existing Binance public fetcher with bounded concurrency, writes the ready/degraded result, and returns JSON diagnostics. Keep the authorization checks already used by MA30/OI and reversal routes.

- [x] Step 5: Run API and existing radar lifecycle tests

Run: node --test tests/radar-multitimeframe-api.test.mjs tests/radar-scan-lifecycle.test.mjs tests/reversal-snapshot.test.mjs

Expected: PASS with existing radar behavior unchanged.

### Task 3: TradingView Vegas indicator and persisted settings

**Files:**
- Modify: app/trade/TradeChart.tsx
- Modify: app/trade/TradingTerminal.tsx
- Modify: lib/trade/indicator-settings.ts
- Modify: app/binancePublicBrowser.ts
- Test: tests/trade-indicator-settings.test.mjs

**Interfaces:**
- IndicatorSettings.vegas contains enabled, fastLength, slowLength, outerFastLength, outerSlowLength, firstColor, secondColor, and lineWidth.
- The chart creates four LineSeries using calculateEma, with EMA144/169 sharing firstColor and EMA576/676 sharing secondColor.

- [x] Step 1: Add failing assertions for four lines, defaults, persistence, and history length

~~~js
test("Vegas settings and four chart series are wired", async () => {
  const settings = await readFile(new URL("../lib/trade/indicator-settings.ts", import.meta.url), "utf8");
  const chart = await readFile(new URL("../app/trade/TradeChart.tsx", import.meta.url), "utf8");
  const terminal = await readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
  assert.match(settings, /fastLength: 144/);
  assert.match(settings, /outerSlowLength: 676/);
  for (const key of ["vegas144", "vegas169", "vegas576", "vegas676"]) assert.match(chart, new RegExp(key));
  assert.match(terminal, /limit=1000/);
});
~~~

- [x] Step 2: Run the focused test and confirm it fails

Run: node --test tests/trade-indicator-settings.test.mjs

Expected: FAIL because no Vegas setting or series exists.

- [x] Step 3: Extend normalized indicator settings

Add safe defaults, boolean/color/line-width normalization, and integer clamps of 2–2000 for all four Vegas periods. Older saved settings normalize to Vegas enabled with the four defaults; malformed colors and widths fall back safely.

- [x] Step 4: Add four chart series and controls

Create four LineSeries with lightweight-charts v5 chart.addSeries(LineSeries, options, 0), calculate each EMA from loaded bars, update data and visibility/colors/width when settings change, and add an IndicatorManager row with adjustable periods, two color inputs, and line width. Increase chart K-line loading to 1000 rows and browser fallback cap to 1000 so EMA676 can be computed. Leave existing MA30/ATR strategy values and execution paths untouched.

- [x] Step 5: Run indicator, chart, and TypeScript checks

Run: node --test tests/trade-indicator-settings.test.mjs tests/trade-chart-data.test.mjs; npx tsc --noEmit

Expected: PASS with no type errors.

### Task 4: Shared radar MA30 buckets, Vegas tab, and progress UI

**Files:**
- Modify: app/radar/page.tsx
- Modify: the existing radar stylesheet selected by the page
- Test: tests/radar-multitimeframe-ui.test.mjs
- Modify: tests/manual-scan-progress-ui.test.mjs if the count assertion needs updating

**Interfaces:**
- The page consumes MultiTimeframeSnapshot from /api/radar/multitimeframe, keeps the selected bucket as all, 15m, 1h, or 4h, and uses the current window’s original symbols as the filter input.
- Every tab, including ma30oi, reversal, and vegas, renders the shared three-button bucket bar; the Vegas tab renders three separate 1h/4h/1d result cards.

- [x] Step 1: Write failing UI source-contract tests

~~~js
test("all radar windows expose closed-candle MA30 buckets and Vegas ordering", async () => {
  const source = await readFile(new URL("../app/radar/page.tsx", import.meta.url), "utf8");
  for (const label of ["K 线站上 15 分钟 MA30", "K 线站上 1 小时 MA30", "K 线站上 4 小时 MA30"]) assert.match(source, new RegExp(label));
  assert.match(source, /MA30 > EMA144 > EMA169 > EMA576 > EMA676/);
  assert.match(source, /ManualProgress/);
  assert.match(source, /api\\/radar\\/multitimeframe/);
  assert.match(source, /1h/);
  assert.match(source, /4h/);
  assert.match(source, /1d/);
});
~~~

- [x] Step 2: Run the UI test and confirm it fails

Run: node --test tests/radar-multitimeframe-ui.test.mjs tests/manual-scan-progress-ui.test.mjs

Expected: FAIL because the shared bar and Vegas tab are not present.

- [x] Step 3: Add snapshot loading and guarded manual progress state

Load the latest snapshot on mount, automatically request a scan for the deduplicated union of current candidate symbols capped at 100, poll while pending, and expose a manual 立即筛选 action on the Vegas tab. Reuse ManualProgress for every manual scan and show ready/degraded/pending, scan time, failed symbols, and warnings.

- [x] Step 4: Apply the MA30 post-filter to every window

Render the three buttons below the filter toolbar. For normal tabs, filter filteredCoins by the selected bucket; for MA30/OI and reversal tabs, derive base symbols from their existing result rows before applying the bucket. Keep each coin link to /trade?symbol=..., show counts, and never treat missing bySymbol[timeframe] as true.

- [x] Step 5: Add the Vegas tab and three buckets

Add a top tab labeled Vegas 强势, preserve original filter tabs, and display separate cards for 1h, 4h, and 1d matches with count, scan time, warning/status, and trade links. Explain the strict ordering is MA30 > EMA144 > EMA169 > EMA576 > EMA676 on the latest closed candle; do not send these results to trading APIs.

- [x] Step 6: Run focused UI and rendered HTML checks

Run: node --test tests/radar-multitimeframe-ui.test.mjs tests/manual-scan-progress-ui.test.mjs tests/rendered-html.test.mjs

Expected: PASS and no regression in existing panel progress indicators.

### Task 5: Persist the contract-page UI live-switch preference

**Files:**
- Modify: app/trade/TradingTerminal.tsx
- Test: tests/trade-live-switch.test.mjs

**Interfaces:**
- Browser key: streetlight-live-switch-v1 with values on/off; missing or unreadable storage defaults to on.
- resolveRealTradingStatus and all server-side route, account, gateway, and final-confirmation checks remain unchanged.

- [x] Step 1: Write the failing UI preference test

~~~js
test("contract page defaults the UI switch on and persists explicit preference", async () => {
  const source = await readFile(new URL("../app/trade/TradingTerminal.tsx", import.meta.url), "utf8");
  assert.match(source, /useState\\(true\\)/);
  assert.match(source, /streetlight-live-switch-v1/);
  assert.match(source, /localStorage\\.setItem/);
  assert.match(source, /realTradingSwitchOn/);
});
~~~

- [x] Step 2: Run the focused test and confirm it fails

Run: node --test tests/trade-live-switch.test.mjs

Expected: FAIL because the current state defaults to false and has no browser persistence.

- [x] Step 3: Implement SSR-safe default-on persistence

Initialize the state to true, read an existing explicit value in a client effect before the persistence effect, write on/off after changes, and bind the switch presentation to the user preference while retaining the existing server status chip and blocked toggle behavior. Do not make a route/account that is not actually enabled place orders.

- [x] Step 4: Run live-mode regression tests

Run: node --test tests/trade-live-switch.test.mjs tests/trade-live-mode.test.mjs tests/trade-live-status.test.mjs

Expected: PASS; existing account and route safety assertions remain unchanged.

### Task 6: Full verification, deployment, and VPS smoke checks

**Files:**
- Modify: docs/superpowers/specs/2026-08-27-vegas-multitimeframe-screening-design.md after verification
- No unrelated files

- [x] Step 1: Run the complete relevant test suite

Run: npm test and npm run lint.

Expected: PASS; if an unrelated pre-existing test fails, isolate it and report it without weakening new assertions.

- [x] Step 2: Build the production bundle

Run: npm run build.

Expected: PASS with the new API route included and no TypeScript/build errors.

- [x] Step 3: Deploy the verified worktree while preserving VPS secrets and dependencies

Use the existing target root@139.59.99.126:/opt/trade-workbench, sync the worktree while excluding .env, .env.local, .git, node_modules, and build caches, then restart only trade-workbench.service. Do not change gateway environment variables, account data, or the live trading service.

- [x] Step 4: Verify the deployed application

Check systemctl is-active trade-workbench.service, fetch public /radar and /trade?symbol=BTCUSDT for HTTP 200, confirm the deployed source/bundle contains Vegas and the multi-timeframe route, and verify no order endpoint was called. Confirm live-status still reports actual server/account conditions rather than trusting the UI default.

- [x] Step 5: Update the spec status and report the result

Change the spec status from requirement-recording to implemented/deployed only after local and VPS checks pass. Summarize changed files, test/build/deploy evidence, and remaining data-availability risk.
