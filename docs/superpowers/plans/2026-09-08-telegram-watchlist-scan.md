# Telegram 可靠响应与分区自选币扫描 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Telegram webhook 无响应，并以低频 1h/4h 公共行情扫描维护四分区自选币。

**Architecture:** webhook 的 claim、处理和回发分别可测；失败可释放 claim 并让 Telegram 重试。自选以来源表投影 sections，1h MA30±1ATR 的纯函数更新机器来源，4h 仅作排序确认。

**Tech Stack:** TypeScript、Node test runner、SQLite/D1、Vinext、React、systemd。

**Spec:** `docs/superpowers/specs/2026-09-08-telegram-watchlist-scan-design.md`

## Global Constraints

- 不打开任何 Binance/Bybit 实盘开关，不创建、取消或修改订单。
- Telegram 诊断不包含 token、secret、消息正文、callback 原文或订单资料。
- 入池只使用最近三根已收盘 1h 的 MA30±1ATR；4h 只影响排序。
- 公共行情串行、间隔至少 300ms、429/5xx 最多重试一次；降级扫描不得删除自动来源。
- VPS 基线未冻结前不得执行代码任务或部署。

---

### Task 1: 让 Telegram webhook 失败可重试

**Files:** `app/api/telegram/webhook/[path]/route.ts`、`lib/telegram/store.ts`、`tests/telegram-webhook.test.mjs`。

**Interfaces:** `claimTelegramUpdate(updateId): Promise<"CLAIMED" | "DUPLICATE">`、`releaseTelegramUpdate(updateId): Promise<void>`、`telegramWebhookDiagnostic({stage, updateId, outcome, errorCode?}): void`。

- [ ] **Step 1: 写失败测试。** `sendMessage` 抛错时断言响应为 500，且随后 `claimTelegramUpdate(updateId)` 再次得到 `CLAIMED`；同一 update 第二次投递断言 200 且 handler 只调用一次。
- [ ] **Step 2: 验证 RED。** 运行 `npx --no-install tsx --test tests/telegram-webhook.test.mjs`；预期现有 route 以 400 吞掉失败、保留 claim，测试失败。
- [ ] **Step 3: 最小实现。** 处理成功后返回 `{ok:true, duplicate:false}`；回发失败时执行 `releaseTelegramUpdate`、写 allowlist 诊断 `{stage:"reply", outcome:"failed", errorCode:"send_failed"}`，返回 500；未授权和格式错误仍是 401/400。
- [ ] **Step 4: 验证 GREEN。** 运行 `npx --no-install tsx --test tests/telegram-webhook.test.mjs tests/telegram-contracts.test.mjs tests/telegram-handler.test.mjs`，所有通过且诊断不含敏感内容。
- [ ] **Step 5: 提交。** `git add app/api/telegram/webhook/'[path]'/route.ts lib/telegram/store.ts tests/telegram-webhook.test.mjs && git commit -m "fix: make Telegram webhook delivery retryable"`。

### Task 2: 实现 1h 强度纯函数

**Files:** 新建 `lib/radar/hourly-strong-watchlist.ts`；新增 `tests/hourly-strong-watchlist.test.mjs`。

**Interfaces:** `evaluateHourlyStrongWatchlist(bars)` 返回 `{ direction, outsideBars, favorableAtrMultiple, eligible } | null`；`rankHourlyStrongCandidates(rows)` 返回排序后的候选。

- [ ] **Step 1: 写失败测试。** 断言连续三根高于 `MA30+1ATR` 的闭合 bar 得到 `{direction:"LONG", outsideBars:3, eligible:true}`；2.2ATR 候选排在 1.1ATR 前；最新 bar 回到阈值内返回 null。
- [ ] **Step 2: 验证 RED。** 运行 `npx --no-install tsx --test tests/hourly-strong-watchlist.test.mjs`；预期因模块不存在失败。
- [ ] **Step 3: 最小实现。** 对每个尾部已收盘 bar 调用 `atrBandMetricsAt(bars, index, direction, 1)`，统计同侧连续根数；按连续根数、`favorableAtrMultiple`、`fourHourConfirmed`、symbol 排序。
- [ ] **Step 4: 验证 GREEN。** 运行 `npx --no-install tsx --test tests/hourly-strong-watchlist.test.mjs tests/atr-band-lifecycle.test.mjs`。
- [ ] **Step 5: 提交。** `git add lib/radar/hourly-strong-watchlist.ts tests/hourly-strong-watchlist.test.mjs && git commit -m "feat: score hourly ATR watchlist strength"`。

### Task 3: 投影四分区并同步双交易所持仓

**Files:** `db/ensure.ts`、`lib/watchlist.ts`、`lib/trade/watchlist-position-sync.ts`、`tests/watchlist-source-priority.test.mjs`。

**Interfaces:** 新增 `POSITION_BINANCE`、`POSITION_BYBIT`；`listWatchlistSections(db)` 返回 `PINNED`、`POSITION`、`MANUAL`、`MACHINE` 四段；`syncExchangePositionWatchlist(db, exchange, positions)` 只替换指定交易所来源。

- [ ] **Step 1: 写失败测试。** 写入 Binance `DOGEUSDT` 与 Bybit `DOGEUSDT/WIFUSDT` 后，`POSITION` 区只得到 `[DOGEUSDT,WIFUSDT]`；移除 `MANUAL` 不移除同币机器来源。
- [ ] **Step 2: 验证 RED。** 运行 `npx --no-install tsx --test tests/watchlist-source-priority.test.mjs`；预期 source/section API 不存在。
- [ ] **Step 3: 最小实现。** 一次性将旧 `POSITION` 映射为 `POSITION_BINANCE`；保留其它来源；每币仅出现在最高优先级段，继续返回扁平兼容列表。
- [ ] **Step 4: 验证 GREEN。** 运行 `npx --no-install tsx --test tests/watchlist-source-priority.test.mjs tests/watchlist-persistence.test.mjs`。
- [ ] **Step 5: 提交。** `git add db/ensure.ts lib/watchlist.ts lib/trade/watchlist-position-sync.ts tests/watchlist-source-priority.test.mjs && git commit -m "feat: project isolated watchlist source sections"`。

### Task 4: 接入低频 1h 扫描与 4h 确认

**Files:** `app/api/radar/atr-band/route.ts`、`app/api/advisory/maintenance/route.ts`、`services/workbench/maintenance-schedule.mjs`、`services/workbench/maintenance-scheduler.mjs`、`tests/maintenance-runtime.test.mjs`、`tests/atr-band-lifecycle-api.test.mjs`。

**Interfaces:** `runHourlyStrongWatchlistScan({interval:"1h", confirmationInterval?:"4h"})`；`:05` 跑 1h，上海时区 0/4/8/12/16/20 加 4h，08 点保留 daily。

- [ ] **Step 1: 写失败测试。** 断言 08:05、12:05、00:05 的 jobs 均含 `hourly-strong`、`four-hour-confirmation`（08 另含 daily）；degraded fake K-line fetcher 只出现 `/fapi/v1/klines`，并保留已有机器来源。
- [ ] **Step 2: 验证 RED。** 运行 `npx --no-install tsx --test tests/maintenance-runtime.test.mjs tests/atr-band-lifecycle-api.test.mjs`。
- [ ] **Step 3: 最小实现。** 单 worker、每币后等待 300ms、仅一次 429/5xx 退避重试；数据不全返回 degraded 且不作权威删除；在 1h 成功后才附加 4h confirmation 字段。
- [ ] **Step 4: 验证 GREEN。** 运行 `npx --no-install tsx --test tests/maintenance-runtime.test.mjs tests/atr-band-lifecycle-api.test.mjs tests/hourly-strong-watchlist.test.mjs`。
- [ ] **Step 5: 提交。** `git add app/api/radar/atr-band/route.ts app/api/advisory/maintenance/route.ts services/workbench/maintenance-schedule.mjs services/workbench/maintenance-scheduler.mjs tests/maintenance-runtime.test.mjs tests/atr-band-lifecycle-api.test.mjs && git commit -m "feat: schedule low-rate hourly watchlist scans"`。

### Task 5: 在交易页显示实线分隔区段

**Files:** `app/api/watchlist/route.ts`、`app/watchlist/useWatchlist.ts`、`app/watchlist/WatchlistBanner.tsx`、`app/trade/TradingTerminal.tsx`、`tests/trade-watchlist-ui.test.mjs`、`tests/watchlist-persistence.test.mjs`。

**Interfaces:** API 返回 `{items, sections, initialized}`；hook 返回 `{watchlist, sections, ready, add, remove}`。

- [ ] **Step 1: 写失败 UI 测试。** fixture sections 渲染后必须出现“主流、持仓、手动自选、机器自选”，并恰有三个 `data-watchlist-divider`。
- [ ] **Step 2: 验证 RED。** 运行 `npx --no-install tsx --test tests/trade-watchlist-ui.test.mjs tests/watchlist-persistence.test.mjs`。
- [ ] **Step 3: 最小实现。** 仅渲染非空 section；每个非首段前渲染 `data-watchlist-divider` 的实线；保留选币行为，星标只撤销 `MANUAL`。
- [ ] **Step 4: 验证 GREEN。** 运行 `npx --no-install tsx --test tests/trade-watchlist-ui.test.mjs tests/watchlist-persistence.test.mjs tests/rendered-html.test.mjs`。
- [ ] **Step 5: 提交。** `git add app/api/watchlist/route.ts app/watchlist/useWatchlist.ts app/watchlist/WatchlistBanner.tsx app/trade/TradingTerminal.tsx tests/trade-watchlist-ui.test.mjs tests/watchlist-persistence.test.mjs && git commit -m "feat: show watchlist source sections"`。

### Task 6: 基线冻结、集成与受控发布

**Files:** `change-logs/REQ-20260908-1258-telegram-watchlist-scan.md`、`change-logs/INDEX.md`。

- [ ] **Step 1: 建立基线。** 以恢复后的只读 SSH 记录 VPS RELEASE、Git commit、服务/timer/listener 和脱敏 webhook 日志；若与集成候选不同则停止。
- [ ] **Step 2: 集成验证。** 执行 `git rebase main`，然后运行 Telegram、watchlist、maintenance focused tests，`npx --no-install tsc --noEmit --pretty false`、`npm run build`、`git diff --check`。
- [ ] **Step 3: 经用户单独授权后发布。** 加锁 `/var/lock/trade-workbench-deploy.lock`；只同步已审阅 commit 的代码，排除 `.env*`、SQLite、状态、依赖和构建产物；保持所有交易开关关闭。
- [ ] **Step 4: 安全验证。** 检查服务、timer、3000/8788/8789 回环绑定、API/页面和 webhook 诊断；不发送订单能力 Telegram 命令；在 REQ 记录真实版本/commit/验证结果。
