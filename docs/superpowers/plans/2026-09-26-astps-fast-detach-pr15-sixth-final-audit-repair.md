# PR #15 Sixth Final Audit Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make chunk002 cache materialization fail-closed, bounded-memory, and reproducible without evaluating chunk002 or changing Production.

**Architecture:** The converter will stream the gzip master into a disk-backed SQLite staging index, validate every required Task-002B row before insertion, then write deterministic per-symbol caches into an unpublished staging root. It will atomically publish the entire cache only after manifest and completeness sentinel creation. Audit artifacts will pin the complete frozen dependency graph, a single Drive RFC-6902 patch, and final published provenance.

**Tech Stack:** Python 3 standard library, SQLite, zstd CLI, Node.js tests, frozen VPS research scripts read-only.

**Spec:** User-provided PR #15 Sixth Final Audit repair requirements, 2026-09-26.

## Global Constraints

- Do not materialize the canonical master or run any chunk002 hypothesis.
- Do not start an EAP collector or alter Production code, threshold, model, Bark, order, service, deployment, or merge state.
- Require exact source ID/bytes/SHA and fail closed on required source fields or invalid OHLC/time relationships.
- Do not expose partial output as a Task-002B cache.

## Review Focus

- A source with a missing required Task-002B field must fail before any published cache exists.
- A source with non-finite/non-positive OHLC or invalid close time must fail before output publication.
- A converter failure after staging writes must remove its staging root and leave no completeness sentinel.
- The integration test must use zstd and the frozen Task-002B parser, not a local substitute.
- The Drive dry-run must use byte-identical RFC-6902 data to the pending manifest.

### Task 1: Bounded-memory converter

**Files:**
- Modify: `scripts/fast-detach-v2-materialize-5m-master.py`
- Modify: `tests/fast-detach-5m-materialization.test.mjs`

- [ ] Write failing tests for zstd frozen-parser consumption, invalid source failure, and no published partial output.
- [ ] Run the test to prove the old converter fails the required zstd/parser contract.
- [ ] Implement disk-backed streaming validation/partitioning, preflight guards, staging cleanup, and atomic publish.
- [ ] Run the focused test and confirm it passes.

### Task 2: Frozen dependency and regression audit

**Files:**
- Modify: `change-logs/CHUNK002_5M_CONVERTER_CONTRACT.json`
- Modify: `change-logs/CHUNK002_RETRY_MATERIALIZATION_MANIFEST.json`
- Create: `change-logs/CHUNK002_SAME_PIPELINE_DEPENDENCY_GRAPH.json`
- Create: `change-logs/TASK006_FROZEN_PYTHON_REGRESSION_AUDIT.json`

- [ ] Read-only hash/audit frozen Task-006, Task-002B/003/004, schema, 15m contract, and invoked dependencies.
- [ ] Record exact isolated orchestration command and all known blockers; do not run OOS.
- [ ] Attempt the original 98-test Task-006 regression in an isolated workspace only after hashes are pinned.

### Task 3: Drive patch and final provenance

**Files:**
- Modify: `change-logs/DRIVE_PENDING_WRITEBACK_MANIFEST.json`
- Modify: `change-logs/RESEARCH_QUEUE_JSON_PATCH_DRY_RUN.json`
- Modify: final manifest, status, engineering/research reports, and Review Packet.

- [ ] Extract one exact RFC-6902 patch from the pending manifest and compute its SHA.
- [ ] Dry-run it against the exact canonical revision and verify before/after hashes, parse, and existing-key preservation.
- [ ] Record code versus validation versus published artifact provenance and final artifact blob SHA set.

### Task 4: Verification and handoff

- [ ] Run focused materialization and Task-007 tests, related radar regression, JSON checks, `git diff --check`, and status.
- [ ] Generate the complete review patch, commit/push the existing PR branch, and post a Seventh-audit result.
