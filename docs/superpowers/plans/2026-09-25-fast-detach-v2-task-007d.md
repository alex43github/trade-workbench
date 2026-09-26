# FAST-DETACH-V2-TASK-007D Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Preserve the validated `epoch-20260924T185000` in persistent research storage, prove why its 177 LIVE_FORWARD events have no observed EAP, and add an append-only EAP observer contract without changing Production behavior.

**Architecture:** Keep the existing `/tmp` epoch byte-for-byte unchanged and copy its canonical files into a deterministic `/var/lib/trade-workbench/research/forward-shadow/epochs/<epoch>/` layout through a staging directory with per-file SHA/row-count verification. Add a research-only EAP module that distinguishes `EAP_NOT_OBSERVED` from `EAP_CONFIRMED_ABSENT`, accepts only an explicit permission-decision source, and emits an immutable `EAP_GRANTED` transition on first valid permission. Add an EDP-only descriptive summary whose denominators are explicit and separate from EAP-valid metrics.

**Tech Stack:** Node.js 22, TypeScript strip-types, Node test runner, existing Task-007/007B/007C protocol/repository, remote VPS SSH/SCP for the authorized persistent copy and isolated validation.

**Spec:** `/Users/niangao/.codex/attachments/2eefd777-36f9-4cc3-b706-83d7defa4c0f/已粘贴的文本.txt`

## Global Constraints

- Preserve `epoch-20260924T185000`; never recreate, merge, delete, or rewrite its snapshots.
- Copy from `/tmp/fast-detach-v2-task007-20260924/` to `/var/lib/trade-workbench/research/forward-shadow/`; never move or delete the source.
- Historical `chunk_001_unified.jsonl` remains read-only with SHA `de4cec2d69f60e72e96ab56c23e37ad209b9899815b56e52d03c14783b10707e`.
- Do not access `chunk_002`; do not modify `/opt`, thresholds, models, Bark, order execution, or `squeeze-radar.service`.
- Existing LIVE_FORWARD events without an immutable permission decision are `EAP_NOT_OBSERVED`, not `NOT_ESTABLISHED` and not reconstructed EAP.
- A future EAP must come only from an explicit permission decision payload; setup/state/score/Bark are never EAP.
- Any same-key replay reuses; any different payload for the same immutable key hard-fails.
- Short VPS validation may observe zero natural EAP and must never synthesize an EAP or event.
- Stop after validation; do not restart the 24–48h collector, install systemd, repair production observability, or promote a model.

## Review Focus

- Permission source absence versus explicit denial: tests must classify missing immutable decision evidence as `EAP_NOT_OBSERVED` and explicit false as `EAP_CONFIRMED_ABSENT`.
- EAP causal evidence: every timestamp in the permission payload must be at or before `eap_time_utc`; future evidence must fail closed.
- First-EAP immutability: a second valid permission may append a later transition, but cannot replace the first EAP payload.
- Persistent copy safety: staging copy must preserve bytes, file sizes, JSONL row counts, source files, and the frozen historical SHA.
- Sample-quality denominator: discovery maturity and EAP-valid maturity must be reported as separate fields; no ambiguous `LOW_SAMPLE` overload.

### Task 1: Audit the real EAP path and freeze machine-readable evidence

**Files:**
- Create: `EAP_SOURCE_AUDIT.md`
- Create: `PRODUCTION_OBSERVABILITY_GAP.json`
- Test: `tests/fast-detach-task-007d.test.mjs`

**Interfaces:**
- `classifyEapObservation(input)` returns `EAP_OBSERVED`, `EAP_CONFIRMED_ABSENT`, `EAP_NOT_OBSERVED`, or `REPLAY_EAP` with a reason.
- `buildGapInventory(report)` converts the existing Markdown gap report into deterministic JSON records.

- [x] Write failing tests for missing-versus-explicit permission evidence and deterministic gap JSON.
- [x] Run the focused test and confirm the new module/API fails for the expected missing implementation.
- [x] Trace `services/structure-radar/main.ts`, `services/structure-radar/scanner.ts`, `lib/structure-radar/state-machine.ts`, `services/structure-radar/orchestrator.ts`, and `lib/radar/sticky-lifecycle.ts`; document detection, state, consultation/plan, actual permission source, and persistence.
- [x] Implement the classifier and generate the audit artifacts without modifying Production code.
- [x] Re-run focused tests and verify all 177 existing events classify as `EAP_NOT_OBSERVED` because no immutable permission decision was logged.

### Task 2: EAP contract, append-only observer, and EDP/EAP metrics

**Files:**
- Create: `services/structure-radar/research/task-007d-eap.ts`
- Modify: `services/structure-radar/research/task-007-protocol.ts`
- Modify: `services/structure-radar/research/task-007-repository.ts`
- Modify: `scripts/fast-detach-v2-task-007c-shadow-forward-collector.ts`
- Test: `tests/fast-detach-task-007d.test.mjs`

**Interfaces:**
- `validateEapDecision(decision, snapshot)` validates identity, timestamps, explicit permission, and causal evidence.
- `createEapGrantedTransition(decision)` produces a deterministic `EAP_GRANTED` transition without changing the snapshot.
- `EapObserver.observe(decision)` appends/reuses the first EAP and rejects conflicts; `observerStatus()` reports whether an explicit source is attached.
- `calculateEapSeparatedMetrics(snapshot, outcomes, decision)` keeps EDP-relative and EAP-relative metrics separate.

- [x] Add failing tests for valid EAP, future causal evidence, same-payload reuse, conflicting payload rejection, first-EAP immutability, replay separation, and EDP/EAP metric separation.
- [x] Run the focused test and confirm these behaviors fail before implementation.
- [x] Add `EAP_GRANTED` to the research transition protocol and implement the observer as a read-only adapter; the default TASK-007C production-like scanner path remains disconnected because no real permission source is currently exposed.
- [x] Modify new-snapshot initialization to use `EAP_NOT_OBSERVED`; leave all existing snapshots byte-for-byte untouched.
- [x] Add optional observer wiring to the shadow collector. It must accept only explicit permission decisions and produce no EAP when no source is attached.
- [x] Re-run Task-007/007B/007C/007D focused tests.

### Task 3: Correct sample-quality fields and generate EDP-only summary

**Files:**
- Create: `services/structure-radar/research/task-007d-summary.ts`
- Modify: `services/structure-radar/research/task-007c-shadow.ts`
- Test: `tests/fast-detach-task-007d.test.mjs`

**Interfaces:**
- `buildEdpOnlyForwardSummary({ snapshots, outcomes })` returns all-live descriptive metrics by horizon, timeframe, setup, discovery channel, and frozen mechanism/family where available.
- `buildSampleQuality({ mature6hN, eapMature6hN })` returns explicit `DISCOVERY_SAMPLE_QUALITY_6H` and `EAP_SAMPLE_QUALITY_6H`.

- [x] Add failing tests for N=177 discovery outcomes with zero EAP, N<20 EAP outcomes, target hit rates, medians, positive-return rate, and no executable PF label.
- [x] Implement deterministic median/rate/stratification calculations from existing outcome metrics only.
- [x] Update the shadow summary to expose explicit discovery and EAP denominators while preserving the original mature counts.
- [x] Generate the EDP-only summary for the 177 live events; label any overlapping PF as `DIAGNOSTIC_OVERLAPPING_EVENT_PF` only.
- [x] Re-run focused tests and verify 48h remains `NOT_MATURE`.

### Task 4: Persistent copy and restart-safe inventory

**Files:**
- Create: `services/structure-radar/research/task-007d-persistence.ts`
- Create: `scripts/fast-detach-v2-task-007d-persist-epoch.ts`
- Test: `tests/fast-detach-task-007d.test.mjs`
- Modify: `docs/superpowers/specs/2026-09-24-fast-detach-v2-task-007c-storage-plan.md`

**Interfaces:**
- `inventoryResearchEpoch(sourceRoot)` returns deterministic file size, JSONL row count, SHA256, and event/outcome counts.
- `copyResearchEpoch({ sourceRoot, destinationRoot, epochId })` copies to staging, verifies every byte and row count, atomically publishes, and leaves source untouched.

- [x] Add failing tests for byte mismatch, row-count mismatch, existing destination conflict, source preservation, and deterministic layout.
- [x] Implement staging copy under `/var/lib/trade-workbench/research/forward-shadow/epochs/<epoch>`, with `snapshot/`, `transitions/`, `outcomes/`, `unified/`, `manifests/`, and `audit/`.
- [x] Write source and destination manifests only in the destination; never rewrite canonical source payloads.
- [x] Run local persistence tests against a temporary source/destination.
- [x] Execute the authorized VPS copy after a read-only preflight; verify `PERSISTENT_COPY_SHA_MATCH=true`, source `/tmp` still exists, and historical SHA remains unchanged.

### Task 5: Short isolated VPS validation and final audit

**Files:**
- Create: `scripts/fast-detach-v2-task-007d-shadow-validation.ts`
- Modify: `change-logs/REQ-20260924-fast-detach-v2-task-007c.md`
- Create: `change-logs/REQ-20260925-fast-detach-v2-task-007d.md`

**Interfaces:**
- Validation reads the persistent copy and the existing shadow epoch, runs the observer with no synthetic permission/event, writes only TASK-007D audit artifacts, and emits the required result block.

- [x] Add a failing validation test for no-source observer status and no synthetic EAP.
- [x] Implement the short runner with read-only production PID check and persistent-copy SHA verification.
- [x] Upload only TASK-007D files to the VPS approved locations and run the short validation.
- [x] Independently audit the final files, source counts, duplicate keys, historical SHA, production PID, and service state.
- [x] Run all Task-006 through Task-007D tests plus radar regression and record unrelated TypeScript errors separately.
- [x] Stop, pause any temporary heartbeat, and report exact files/commands requiring future approval for long-run collection and TASK-007E production observability repair.
