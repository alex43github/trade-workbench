# REQ-20260925-fast-detach-v2-task-007d

状态：VERIFIED_ON_VPS_AND_STOPPED
创建时间：2026-09-26 Asia/Shanghai

## 结论

TASK-007D 完成了既有 Forward Epoch 的 persistent research copy、EAP source audit、EAP observer contract、EDP-only descriptive summary 和短时 VPS validation。没有修改 Production scanner、model、threshold、Bark、订单链或生产服务。

`EAP_ZERO_ROOT_CAUSE=OBSERVER_NOT_CONNECTED`：structure-radar 当前有 detection、state transition 和 expert `executionPlan`，但没有把实际 execution permission decision 作为 immutable payload 输出或按 Task-007 `event_id` 持久化。现有 177 条事件因此全部为 `EAP_NOT_OBSERVED`，不能改写成 `EAP_CONFIRMED_ABSENT`，也没有回填 `REPLAY_EAP`。

## Required result

```text
TASK007D_VALID=true
PERSISTENT_FORWARD_EPOCH_READY=true
PERSISTENT_COPY_SHA_MATCH=true
SOURCE_TMP_PRESERVED=true
LIVE_FORWARD_EVENTS=177
UNIQUE_SYMBOLS=138
EAP_ZERO_ROOT_CAUSE=OBSERVER_NOT_CONNECTED
EAP_OBSERVER_CONNECTED=false
LIVE_EAP_OBSERVED_N=0
LIVE_EAP_CONFIRMED_ABSENT_N=0
LIVE_EAP_NOT_OBSERVED_N=177
NEW_EVENTS=0
NEW_EAP_OBSERVED=0
DISCOVERY_SAMPLE_QUALITY_6H=READY_FOR_DESCRIPTIVE_SUMMARY
EAP_SAMPLE_QUALITY_6H=LOW_SAMPLE
OUTCOME_6H_MATURE_N=177
OUTCOME_12H_MATURE_N=177
OUTCOME_24H_MATURE_N=2
OUTCOME_48H_MATURE_N=0
EDP_PLUS5_HIT_RATE_6H=0.096045197740113
EDP_PLUS10_HIT_RATE_6H=0.05084745762711865
EDP_MEDIAN_MFE_6H=1.6361469281612306
EDP_MEDIAN_MAE_6H=-1.3900589721988266
EDP_POSITIVE_RETURN_RATE_6H=0.5084745762711864
EDP_NORMAL_MAE_6H=155
EDP_SEVERE_FAILURE_6H=22
FEATURE_LEAKAGE_COUNT=0
DUPLICATE_EVENT_IDS=0
DUPLICATE_OUTCOME_KEYS=0
SNAPSHOT_MUTATION_COUNT=0
OUTCOME_MUTATION_COUNT=0
HISTORICAL_CHUNK001_SHA_BEFORE=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_CHUNK001_SHA_AFTER=de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e
HISTORICAL_FROZEN_UNCHANGED=true
PRODUCTION_OBSERVABILITY_GAP_JSON_READY=true
CHUNK002_ACCESSED=false
PRODUCTION_MODEL_CHANGED=false
PRODUCTION_CODE_CHANGED=false
PRODUCTION_SERVICE_RESTARTED=false
BLOCKERS=[]
```

## Persistent copy

Destination:

```text
/var/lib/trade-workbench/research/forward-shadow/epochs/epoch-20260924T185000/
```

The source `/tmp/fast-detach-v2-task007-20260924/live/run-20260924T185000/` remains present. Canonical copied rows are 177 snapshots, 185 transitions, 1064 outcomes and 227 Unified View rows. Every canonical source/destination file matched byte-for-byte; the source inventory also records the historical temporary state file but does not copy that ephemeral file into the canonical destination. The second validation reused the existing copy and reused the identical EAP status audit ledger without mutation.

Forward Epoch SHA remains `446a6a3281d2b1eb74dc886b032c3ee19abe82ad0547c0f65b41159c692c7781`. Historical chunk SHA remains unchanged. Post-copy `df` reports `/var/lib` at rounded `80%`; no further remote writes were made after the final read-only audit.

## 24h event report

Both original events remain `EAP_STATUS=EAP_NOT_OBSERVED`, with unchanged snapshot hashes and 48h `NOT_MATURE`:

```text
ETHUSDT 24h return=2.5963136425442013 MFE=3.5904215138238493 MAE=-0.21151231303822016 TTP_5/8/10/15/20=null barrier=NEITHER_BY_HORIZON max_time_underwater=0
TRXUSDT 24h return=-0.9028615122195105 MFE=0.42937387877539646 MAE=-1.0087345234244038 TTP_5/8/10/15/20=null barrier=NEITHER_BY_HORIZON max_time_underwater=690
```

## Verification

- Task-007/007B/007C/007D focused tests: `29/29 passed`.
- Radar regression: `100 passed, 1 skipped` (sandbox loopback listener restriction only).
- Task-006 regression: `98 passed`.
- `git diff --check`: passed.
- `PRODUCTION_OBSERVABILITY_GAP.json`: valid JSON.
- `npx tsc --noEmit`: exit 2 only for the pre-existing 8 UI/trading type errors; no TASK-007D error was reported.

## Stop gate

未启动新的长跑 collector，未安装 systemd/cron，未修复 Production observability writeback，未修改 `/opt`、Bark、order chain、threshold 或 model。TASK-007E 需要另行授权，至少涉及 `services/structure-radar/main.ts` 的 event identity adapter、candidate/notification/score/outcome writer 以及对应 Sheet/ledger sink；长跑 collector 需要另行授权其目标目录、运行时长和是否允许接入真实 permission source。
