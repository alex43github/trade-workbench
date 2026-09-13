# Source-of-Truth Reconciliation Decisions — 2026-09-13

Canonical branch: `chatgpt/source-of-truth-20260913`
Baseline: `7d8f6f83ebf9be8e13b52884f9556c20158108e2`

## Decision rule

Production VPS drift is not automatically authoritative. A VPS change is preserved only when it is self-contained, does not depend on missing source, does not weaken live-trading safety, and can be reasoned about independently. Binance EXIT_ONLY ownership/reconciliation, manual-close durable idempotency, ENTRY preflight, stale-exit cleanup, and fail-closed controls must never be regressed.

## 29 MERGE_REQUIRED decisions

| Path | Canonical decision | Reason |
|---|---|---|
| `app/api/account/route.ts` | KEEP_GITHUB | VPS change depends on incomplete/untracked Bybit exchange abstraction; Bybit gateway source is preserved separately but account integration must be reintroduced as an audited feature. |
| `app/api/advisory/maintenance/route.ts` | KEEP_GITHUB | VPS cadence/ATR split is superseded by the new strong-trend/squeeze scanning design; avoid preserving two schedulers. |
| `app/api/radar/atr-band/route.ts` | KEEP_GITHUB | VPS changes production ATR semantics from 3 ATR to 1 ATR without an isolated promotion record. |
| `app/api/telegram/webhook/[path]/route.ts` | MERGED_SAFE | Failure now releases claimed update and returns retryable 500 without leaking secret values. |
| `app/api/trade/live-status/route.ts` | KEEP_GITHUB | Depends on incomplete Bybit exchange abstraction. |
| `app/api/trade/live-strategies/[id]/cancel/route.ts` | KEEP_GITHUB_SAFETY | VPS removes owned EXIT_ONLY cleanup and can leave stale exits. Rejected. |
| `app/api/trade/live-strategies/route.ts` | MERGED_SAFE | Adds fail-safe error boundary around submit without changing order semantics. |
| `app/api/trade/manual-protection/route.ts` | KEEP_GITHUB | Depends on incomplete Bybit exchange abstraction and changes protection semantics. |
| `app/api/trade/positions/close/route.ts` | KEEP_GITHUB_SAFETY | VPS removes durable idempotency reservation/outcome recording and workbench order intent. Rejected. |
| `app/api/trade/protection-status/route.ts` | KEEP_GITHUB | Depends on incomplete Bybit exchange abstraction/schema migration. |
| `app/api/watchlist/route.ts` | KEEP_GITHUB | VPS sectioning is coupled to a larger watchlist/schema drift; scanner dashboard will get an explicit audited candidate-pool model instead. |
| `app/trade/AdaptiveStrategyPanel.tsx` | KEEP_GITHUB | Coupled to incomplete multi-exchange UI. |
| `app/trade/EquityChart.tsx` | KEEP_GITHUB | Cosmetic part of incomplete multi-exchange UI. |
| `app/trade/LiveStrategyStatusList.tsx` | KEEP_GITHUB | Coupled to incomplete multi-exchange API/UI. |
| `app/trade/QuickLiveStrategyPanel.tsx` | KEEP_GITHUB | Changes confirmation flow and strategy descriptions; not accepted as provenance-only reconciliation. |
| `app/trade/StrategyWizard.tsx` | KEEP_GITHUB | Coupled to incomplete multi-exchange workflow. |
| `app/trade/TradeChart.tsx` | KEEP_GITHUB | VPS difference is only a TS line-width assertion; baseline already builds and this is not a production-semantic requirement. |
| `app/trade/TradingTerminal.tsx` | KEEP_GITHUB | Large multi-exchange/watchlist UI drift with missing dependencies. |
| `app/trade/trade.module.css` | KEEP_GITHUB | Coupled to rejected UI drift and removes existing chart/confirmation layout rules. |
| `app/watchlist/useWatchlist.ts` | KEEP_GITHUB | Coupled to rejected watchlist section/schema drift. |
| `db/ensure.ts` | KEEP_GITHUB_SAFETY | VPS adds exchange columns but simultaneously removes live exit ledger/manual-close idempotency schema; unsafe wholesale merge. Future exchange migration must be isolated. |
| `lib/radar/atr-band-lifecycle-snapshot.ts` | KEEP_GITHUB | VPS adds a 4H ATR confirmation branch outside the promoted radar RC. New strong-trend radar handles 4H context separately. |
| `lib/radar/atr-band-lifecycle.ts` | KEEP_GITHUB | Same ATR branch as above. |
| `lib/radar/binance-public.ts` | KEEP_GITHUB | Same ATR branch as above. |
| `lib/structure-radar/state-machine.ts` | KEEP_GITHUB | VPS removes `score` from the state contract; rejected because trend radar uses score for ranking/actionability. |
| `lib/telegram/contracts.ts` | KEEP_GITHUB | Coupled to incomplete Bybit exchange conversation flow. |
| `lib/telegram/handler.ts` | KEEP_GITHUB | Coupled to incomplete Bybit exchange/protection flow. |
| `lib/telegram/store.ts` | MERGED_SAFE | Adds `releaseTelegramUpdate()` so transient delivery failures can be retried safely. |
| `lib/watchlist.ts` | KEEP_GITHUB | Coupled to incomplete Bybit/watchlist schema drift; candidate-pool redesign will be explicit. |

## Preserved VPS-only source

The following production-referenced files were independently secret-scanned and have been preserved on the canonical branch without enabling them in the Workbench UI:

- `bybit-gateway/server.mjs`
- `bybit-gateway/order-policy.mjs`
- `bybit-gateway/signing.mjs`
- `deploy/bybit-gateway.service`

This preserves recoverability without silently introducing an incomplete multi-exchange control plane.

## Result

`MERGE_REQUIRED_UNRESOLVED=0`

All 29 previously ambiguous source differences now have an explicit canonical decision. This closes the provenance ambiguity. It does **not** mean production deployment is approved, and it does not resolve the known cross-process / exchange-acceptance TOCTOU residual risk.

Before production deployment, the branch still requires current build/test verification and an explicit deployment step against one approved commit SHA.
