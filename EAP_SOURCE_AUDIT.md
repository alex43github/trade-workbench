# FAST-DETACH-V2-TASK-007D — Production Final Action / EAP Source Audit

审计范围：`epoch-20260924T185000` 的 177 条 `LIVE_FORWARD` 事件、当前 checked-out repository，以及 canonical Google Drive model/data documents。审计只读，不修改 Production service、threshold、model、Bark、order path、历史 snapshot 或 Forward ledger。

审计证据时间：`2026-09-26T16:24:20+08:00`，由 repair commit `b624779b82c092019bdc87509a9fc1a919e8f57e` 的 committer timestamp 固定；不是未来计划时间。

## 结论

Production 的 execution-permission **语义存在**，但本轮没有找到能从 Production Final Action 运行时结果进入 immutable permission ledger 的可审计 lineage：

```text
PRODUCTION_EXECUTION_PERMISSION_SEMANTICS_FOUND=true
NO_AUDITABLE_RUNTIME_LINEAGE_FROM_PRODUCTION_FINAL_ACTION_TO_IMMUTABLE_PERMISSION_LEDGER=true
REAL_LIVE_EAP_SOURCE_FOUND=false
```

因此不能再把结论写成“Production 没有 execution-permission semantics/source”。准确 blocker 是：`MODEL_CURRENT`/`WORKBENCH_SPEC` 定义了 Final Action vocabulary，但 runtime 没有可验证的生成、持久化、稳定 key 和 `event_id` join 证据，不能把这些语义当作真实 `EAP_GRANTED`/`DENIED` decision source。

历史 177 条仍必须保持 `EAP_NOT_OBSERVED`，不能回填 prospective EAP，也不能从 `PLATFORM_RECLAIM`、`CONFIRMED`、score、Bark、paper plan 或 `executionPlan` 推导 EAP。

## Canonical model semantics

| Canonical file | Stable ID / revision evidence | Frozen semantics |
|---|---|---|
| `03_MODEL_REGISTRY/MODEL_CURRENT.md` | Drive file `1pC40sbP9oj82At8G6aBjZcGzY2BfTnaa`; modified `2026-09-12T16:17:09.988Z`; current revision `0B-0oAJIjSHwhcktKbmV2SSt4SWloNmtpSk9qR284OFFwcXNvPQ` | Production baseline `ASTPS V3-LR / Monster Squeeze V1.1-LR`; Discovery 与 Execution 分离；`Execution Outputs` 包含 `BUY RESET`, `RE-IGNITION LONG`, `CHASE ALLOWED`, `HOLD ONLY`, `NO CHASE`, `ABSOLUTELY_NO_SHORT`, `SHORT_WARNING`, `SHORT_PERMISSION_PENDING`, `SHORT_ALLOWED`。 |
| `WORKBENCH_SPEC.md` | Drive file `1m6IbzlvUFrxTTW9vMP5wx4vW4nP6tqoY`; modified `2026-09-12T16:50:59.446Z`; current revision `0B-0oAJIjSHwhb2N3anF5RWlwYzhrUXFLazZZL3kzRzZJQXRBPQ` | Per-symbol output 必须有 `Final Action`；同一组 Final Action vocabulary；该文档是 interface/spec，不是 immutable permission ledger。 |
| `CURRENT_CANDIDATE_MODEL.md` | Drive file `1LoHtmTqhDL6jY4D6XzH5jU-SCcZOyQu1`; modified `2026-09-16T10:28:33.066Z`; current revision `0B-0oAJIjSHwhVHN3ZzVBWEh3cFVucEVJZk1vdU9kOHZweWNRPQ` | Execution requires event-time structure quality；candidate/shadow 逻辑不能自动授予 Production permission。 |
| `workbench_stage6_implementation_spec.md` | Drive file `1LccJTNfOca5VBaeEIs0mWhyzHz6Wad9A` | Stage6 observer 是 research-only / append-only / no order；`tradingPermission=false` 的 paper plan 不是 Production permission。 |

## Runtime lineage audit

| Stage | Exact path | What is produced | Why it is not an auditable EAP source |
|---|---|---|---|
| Detection | `services/structure-radar/scanner.ts:71-134`; `lib/structure-radar/platform-reclaim.ts`; `trendline-breakout.ts` | closed-bar `TrackedSignal` and deterministic `signalId(symbol,timeframe,setup,anchorHash)` | Discovery identity only; no permission decision. |
| Final-action-like consultation | `services/structure-radar/main.ts:65-81`; `services/structure-radar/orchestrator.ts:80-116`; `lib/structure-radar/expert-consensus.ts:74-91` | expert consensus, `alertPolicy`, optional `consensus.executionPlan` | Consultation/paper plan has no immutable permission status, EDP/EAP timestamp pair, or `event_id` ledger append. `executionPlan` is not `GRANTED`. |
| State machine | `lib/structure-radar/state-machine.ts:121-142` | consumes plan/position to produce state transitions such as `TAKE_PROFIT_WATCH`/`ADD_CANDIDATE` | No `BUY RESET`/`CHASE ALLOWED`/`SHORT_ALLOWED` decision record and no permission ledger key. |
| Production persistence | `services/structure-radar/radar-repository.ts` and `radar.json` path | scanner/consultation/enriched signal artifacts | No immutable EAP ledger row keyed by `event_id + closed-bar decision time`; no source decision ID/version/payload hash contract. |
| Execution-forward observer | `services/execution-forward/execution-forward-v1.ts:80-155`; `execution-forward-persistence.ts`; `execution-forward-watcher.ts` | EDP, recheck, paper plan and outcomes | Every EDP/recheck/plan carries `tradingPermission=false`; scorer is unavailable; persistence rejects permission enablement. This is `CANDIDATE_EAP`/`SHADOW_EAP`, not Production permission. |
| Task-007D observer | `services/structure-radar/research/task-007d-eap.ts` | accepts an externally supplied immutable `EapDecision` and appends `EAP_GRANTED` | Observer is not connected to the Production Final Action path. `LIVE_FORWARD` count remains zero. |
| Existing EAP-like evaluator | `lib/radar/sticky-lifecycle.ts:123-131` | evaluates optional external `eap`/`eapPrice` input | Not connected to scanner `event_id`; not a Production ledger source. |
| Order path | `services/structure-radar/main.ts` imports only read-only account observation; no order client/permission append is in this path | no auditable order-permission decision | No runtime lineage to audit. |

### Exact implementation gap

The repository has no implementation that simultaneously:

1. computes the canonical Final Action vocabulary in the deployed scanner/runtime;
2. assigns it an immutable closed-bar decision timestamp and source decision ID/version;
3. persists `GRANTED`, explicit `DENIED`, and unknown/error states append-only;
4. deterministically joins that decision to a Task-007 `event_id`; and
5. produces a payload hash/revision contract consumable by the Task-007D observer.

This is an implementation/lineage gap, not evidence that the model semantics do not exist.

## Classification and denominator boundary

- `EAP_OBSERVED`: 0 — no external immutable Production grant decision was observed.
- `EAP_CONFIRMED_ABSENT`: 0 — no auditable Production permission evaluator returned explicit `DENIED`.
- `EAP_NOT_OBSERVED`: 177 — discovery/outcome exists, but permission source/lineage was not observed.
- `REPLAY_EAP`: 0 — no historical reconstruction was inserted into LIVE_FORWARD.
- `CANDIDATE_EAP` / `SHADOW_EAP`: not counted in LIVE_FORWARD denominator.

The LIVE_FORWARD denominator remains the set of immutable `EAP_GRANTED` ledger event IDs only. The persistent collector remains stopped until the real permission semantics and runtime lineage are resolved. No synthetic LIVE EAP was created.

## Evidence disposition

The machine-readable full audit is [`change-logs/ASTPS_FAST_DETACH_PERMISSION_SOURCE_AUDIT.json`](change-logs/ASTPS_FAST_DETACH_PERMISSION_SOURCE_AUDIT.json). The current round records `REAL_LIVE_EAP_SOURCE_FOUND=false` and the precise lineage blocker above; it does not set the overbroad “no Production permission source” conclusion.
