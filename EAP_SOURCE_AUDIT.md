# FAST-DETACH-V2-TASK-007D — EAP Source Audit

审计范围：`epoch-20260924T185000` 的 177 条 `LIVE_FORWARD` 事件，以及当前 `structure-radar` 生产代码路径。该审计不修改生产服务、阈值、模型、Bark 或订单链。

## 结论

`EAP_ZERO_ROOT_CAUSE=OBSERVER_NOT_CONNECTED`。

当前 scanner 生产链路确实产生 detection 和 state transition，也会在部分状态上生成 expert `executionPlan`，但没有把“实际 execution permission decision”作为事件输出、稳定 payload 或可按 Task-007 `event_id` 连接的持久化记录。因此不能证明 177 个事件曾被 permission logic 明确拒绝，也不能从 `PLATFORM_RECLAIM`、`CONFIRMED`、score、Bark 或 plan 推导 EAP。

现有 177 条事件的历史状态必须标为 `EAP_NOT_OBSERVED`，而不是 `EAP_CONFIRMED_ABSENT` 或回填的 `REPLAY_EAP`。原始 snapshot 保持不可修改。

## 真实路径审计

| 阶段 | 精确代码路径 | 输入 identity / 时间戳 | 输出 | 确定性 / 因果性 | 当前持久化 |
|---|---|---|---|---|---|
| Detection | `services/structure-radar/scanner.ts:71-78` `RadarScanner.handleRawEvent → handleClosedBar`；`lib/structure-radar/platform-reclaim.ts`、`trendline-breakout.ts` | closed websocket kline；`bar.time` / closed-bar time | `TrackedSignal`，`signalId(symbol,timeframe,setup,anchorHash)` | identity deterministic；只使用 closed bars，causal | `RadarRepository.save` 写 `radar.json`；TASK-007 shadow 写 immutable snapshot |
| State transition | `services/structure-radar/scanner.ts:98-134`；`lib/structure-radar/state-machine.ts:90-142` `advanceSignal` | existing `TrackedSignal` + 后续 closed bars；bar time | `CANDIDATE`、`CONFIRMED`、`INVALIDATED`、`TAKE_PROFIT_WATCH` 等 state | state transition deterministic；bar watermark causal | `RadarRepository.save`；TASK-007 shadow append transition |
| Consultation / plan | `services/structure-radar/main.ts:65-81`；`services/structure-radar/orchestrator.ts:80-116` `processCandidate` | `ProcessSignal` + cache market snapshot；无独立 permission timestamp | expert consensus 与 `executionPlan` | 计划是 consultation 输出，不是 frozen execution permission；时间/证据未形成 EAP contract | consultation/enriched signal 写 `radar.json`；没有 Task-007 EAP ledger |
| Position observation | `services/structure-radar/main.ts:38-49`；`position-monitor.ts` | read-only account/position GET 状态 | `POSITION_UNKNOWN` / pre/post signal position classification | 只描述账户观察，不代表 permission decision | local radar state；不产生 EAP |
| Execution evaluation | 当前 `services/structure-radar` 路径中没有独立 permission evaluator | 无 stable permission input | 无 `GRANTED` / `DENIED` decision event | 不可判定 | 未持久化 |
| Existing EAP-like evaluator | `lib/radar/sticky-lifecycle.ts:123-131` `evaluateSecondChanceEap` | 外部可选 `eap`、`eapPrice` 与 reset/reclaim/second-test/reignition evidence | sticky lifecycle 的 `CONFIRMED` / `UNKNOWN` / `REJECTED` | 只对该旁路输入评估；未接入 `RadarScanner.onSignal`，没有 Task-007 event_id join | sticky state / notification artifacts；不是 LIVE_FORWARD EAP source |
| Order permission | `services/structure-radar/main.ts` 不导入 order client；账户 client 为 read-only | 无 order route / permission payload | 无 order permission decision | 不存在可审计的生产 order permission path | 未持久化 |

## 分类

- `EAP_OBSERVED`: 0。没有收到带完整 permission payload 的 immutable decision。
- `EAP_CONFIRMED_ABSENT`: 0。没有可证明“permission logic 已执行且明确返回 DENIED”的记录。
- `EAP_NOT_OBSERVED`: 177。检测和 outcome 存在，但当时没有 permission observer/immutable decision log。
- `REPLAY_EAP`: 0。未对 LIVE_FORWARD 事件做历史重建；任何未来 replay 都必须保持独立 source。

## 后续边界

TASK-007D 新增的 observer 只接受显式 permission decision，并以 `EAP_GRANTED` append-only transition 保存；同 payload replay 为 `REUSED`，冲突 payload HARD FAIL。当前 VPS 短时验证没有真实 permission source，因而预期 `NEW_EAP_OBSERVED=0`。将生产 permission source 与 candidate/event identity 连接属于后续 TASK-007E，必须另行授权。
