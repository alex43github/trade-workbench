# Trade Workbench Source of Truth（2026-09-13）

## 当前判定

`SOURCE_OF_TRUTH_READY=NO`

本 reconciliation branch 以 GitHub baseline commit `7d8f6f83ebf9be8e13b52884f9556c20158108e2` 为主干，并安全纳入 3 个由生产 `bybit-gateway.service` 明确引用、且 baseline 缺失的 Bybit 源码文件。Binance EXIT_ONLY、per-position lock、authoritative position/open-order reconciliation、stale-order lifecycle、ENTRY preflight 与 manual-close idempotency 均保留 GitHub 实现，未用 VPS 旧版覆盖。

## Provenance

- Base repository: `alex43github/trade-workbench`
- Base branch/commit: `source-baseline/20260913-current` / `7d8f6f83ebf9be8e13b52884f9556c20158108e2`
- Reconciliation branch: `source-reconcile/20260913-vps`
- VPS source root: `/opt/trade-workbench`（只读捕获）
- Sensitive/runtime files: 未读取、未纳入 manifest
- Handoff scope: 不做 29 个 `MERGE_REQUIRED` 语义合并；仅提供可审计 unified diff bundle。

## VPS-only 纳入结果

以下文件先在本地内存执行 secret/token/key/password/private-key/hard-coded credential 扫描，结果均 clean，然后从 VPS 纳入：

| Path | VPS SHA-256 | Scan |
|---|---|---|
| `bybit-gateway/server.mjs` | `cf5b5161432fb7474f0e064633ac5486acf5e497b475629726099f8b5eb6c6b2` | clean |
| `bybit-gateway/order-policy.mjs` | `1068d3624154390512562389d8ab1946256ae4eceaf24f973b9bc6c53a5c3e1a` | clean |
| `bybit-gateway/signing.mjs` | `6f3d9db75e4326548701124d7bfde1a555c23e884535791876487925dd2dd7e5` | clean |

同时只读捕获 `/etc/systemd/system/bybit-gateway.service` 的安全 unit 内容，纳入 `deploy/bybit-gateway.service`；EnvironmentFile 仅保留路径，未读取值。

## Handoff bundle

- `docs/vps-reconciliation/INDEX.md`：29 个文件的路径、双方 SHA-256、`MERGE_REQUIRED` 分类和逐文件 patch 索引。
- `docs/vps-reconciliation/VPS_MERGE_REQUIRED.patch`：完整 unified diff；未覆盖 GitHub 源码，供后续 GitHub 审计使用。
- bundle secret scan：clean；不含 `.env`、数据库、日志、runtime state 或 credential。

## 61 个 production DIFF 分类

| 分类 | 数量 | 处理原则 |
|---|---:|---|
| `KEEP_GITHUB_NEWER` | 31 | GitHub 包含已审计安全修复或当前 RC；不回退到 VPS 旧实现 |
| `IMPORT_VPS_NEWER` | 0 | 未发现可证明应整文件导入的 VPS 修复 |
| `MERGE_REQUIRED` | 29 | Web/UI、DB、radar/Telegram 等存在独立漂移，需逐文件语义合并 |
| `GENERATED_OR_NON_SOURCE` | 1 | `deploy/workbench.env.example` 仅为模板，不作为生产源码 |
| `UNKNOWN_REQUIRES_REVIEW` | 0 | 本轮无未分类路径 |

### KEEP_GITHUB_NEWER（31）

`binance-gateway/order-policy.mjs`、`binance-gateway/server.mjs`；
`lib/trade/alex-positions.ts`、`live-contracts.ts`、`live-entry-protection.ts`、`live-entry-reanchor.ts`、`live-position-close.ts`、`live-strategies.ts`、`live-submit.ts`、`live-three-leg.ts`、`order-alias.ts`、`order-source.ts`、`position-analysis.ts`、`protection-contracts.ts`、`protection-executor.ts`、`protection-math.ts`、`protection-scheduler.ts`、`protection-strategies.ts`、`quick-live-exits.ts`、`quick-live-template.ts`、`reanchor-math.ts`、`strategy-contracts.ts`；
`services/structure-radar/http-server.ts`、`main.ts`、`radar-repository.ts`、`runtime.ts`、`scanner.ts`、`squeeze-radar.ts`；
`services/workbench/maintenance-schedule.mjs`、`maintenance-scheduler.mjs`、`protection-strategy-scheduler.mjs`。

理由：受控 diff 显示 VPS 为旧版或缺失基线已审计功能；尤其 Binance/Radar/保护调度路径不得倒退。

### MERGE_REQUIRED（29）

`app/api/account/route.ts`、`app/api/advisory/maintenance/route.ts`、`app/api/radar/atr-band/route.ts`、`app/api/telegram/webhook/[path]/route.ts`、`app/api/trade/live-status/route.ts`、`app/api/trade/live-strategies/[id]/cancel/route.ts`、`app/api/trade/live-strategies/route.ts`、`app/api/trade/manual-protection/route.ts`、`app/api/trade/positions/close/route.ts`、`app/api/trade/protection-status/route.ts`、`app/api/watchlist/route.ts`、`app/trade/AdaptiveStrategyPanel.tsx`、`EquityChart.tsx`、`LiveStrategyStatusList.tsx`、`QuickLiveStrategyPanel.tsx`、`StrategyWizard.tsx`、`TradeChart.tsx`、`TradingTerminal.tsx`、`trade.module.css`、`app/watchlist/useWatchlist.ts`、`db/ensure.ts`、`lib/radar/atr-band-lifecycle-snapshot.ts`、`lib/radar/atr-band-lifecycle.ts`、`lib/radar/binance-public.ts`、`lib/structure-radar/state-machine.ts`、`lib/telegram/contracts.ts`、`lib/telegram/handler.ts`、`lib/telegram/store.ts`、`lib/watchlist.ts`。

这些文件保留 GitHub baseline 版本，同时标记为 unresolved merge review；本轮不粗暴覆盖 VPS，也不伪造“已合并”。

### GENERATED_OR_NON_SOURCE（1）

`deploy/workbench.env.example`：模板漂移，不含生产 secret，不纳入运行源码事实判定。

## 验证记录

- Secret scan：3 个 VPS-only Bybit 文件 clean；未读取任何 secret value。
- Handoff bundle/unit targeted secret scan：clean（37 个新增/交接文件）；仓库既有测试 fixture 中的示例 credential 字面量未作为生产 secret 处理。
- `npm run build`：通过（exit 0；仅有既有 Vite/Vinext future-config 与动态 API 分类提示）。
- Binance relevant tests：通过，31/31（`binance-gateway/test.mjs`、`order-policy.test.mjs`、`exit-lock.test.mjs`）。
- Bybit relevant tests：未运行；baseline 与本地工作树均没有 `bybit-gateway/test.mjs`，按本任务“只抢救三份已确认源码”的范围未从 VPS 额外读取测试文件。
- Radar relevant tests：通过，92 项中 91 pass、1 skip；skip 为受当前执行环境 loopback listener 限制的真实 HTTP adapter 测试。
- Full `npm test`：844 项中 816 pass、27 fail、1 skip。失败集中在既有 gateway smoke、ATR/radar UI、gateway-config、maintenance/rendered-html 与 watchlist 测试；本分支未修改这些产品实现，故不将其归因于三份 Bybit 源码纳入。该结果不满足“无新 P0/P1 阻塞”的放行条件。
- `git diff --check`：通过（exit 0）；历史 baseline Markdown whitespace warning 单独记录，不作为源码一致性结论。

## 未解决项目

1. 29 个 `MERGE_REQUIRED` 生产差异仍需逐文件语义合并。
2. 进程内 lock 不解决跨进程/跨实例竞态；Binance 最后 snapshot 到交易所接收之间仍存在 TOCTOU residual risk。

在上述项目清零并完成验证前，不宣称 `SOURCE_OF_TRUTH_READY=YES`。
