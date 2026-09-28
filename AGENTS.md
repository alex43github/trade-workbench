# AGENTS.md — Trade Workbench Engineering Rules

These instructions apply to Codex, ChatGPT, and any coding/research agent working in this repository.

## 1. MVP-first is the default and mandatory

The first goal of any new idea is **not** to build the most complete architecture. The first goal is to make the user's idea testable with the **smallest cost, shortest time, and least operational risk**.

Before designing a task, identify the smallest end-to-end loop that can answer:

> Does the user's idea work well enough to justify further investment?

Implement that loop first.

Do not add infrastructure, abstractions, schemas, state machines, backtest frameworks, dashboards, generalized runners, registries, migration layers, or production integrations unless they are required for the MVP to run and be tested.

If an extra component is not necessary to validate the idea, it belongs to a later phase.

## 2. Minimum runnable version before expansion

Every new feature or research idea must begin with a Minimum Runnable Version (MRV/MVP) that:

1. runs end to end;
2. produces observable output;
3. has a simple acceptance test;
4. can be validated by the user quickly;
5. does not depend on speculative future functionality.

For example, for alert-quality research, the MVP is:

- record every real alert when it is emitted;
- freeze symbol, alert time, alert price, direction/stage/source;
- automatically fill outcomes after fixed horizons such as +1H/+4H/+6H/+12H;
- calculate simple returns and, when practical, MFE/MAE;
- show whether the alert rapidly detached from cost.

Do **not** block this MVP on a full historical OOS platform, generalized research registry, large schema redesign, or model-promotion framework.

## 3. Phase gates

Use this order unless the user explicitly approves another order:

**Phase 1 — Runnable MVP**
- smallest implementation;
- minimum required data;
- minimum required code changes;
- isolated from production risk where possible;
- explicit acceptance criteria.

**Phase 2 — Real validation**
- collect enough real observations;
- verify timestamps, prices, outputs, and failure handling;
- determine whether the idea has value.

**Phase 3 — Improvement proposal**
Only after Phase 1 works, propose optional improvements.

For every optional improvement, state:
- what problem it solves;
- expected benefit;
- implementation time;
- compute/storage/network/API cost;
- operational risk;
- whether it changes production behavior.

Do not implement Phase 3 items until the user explicitly approves them.

**Phase 4 — Integration/generalization**
Only after the idea is validated should it be merged into wider system groups, generalized, optimized, or promoted into larger research/production architecture.

## 4. No speculative over-engineering

Agents must not turn a simple validation task into a multi-day platform project unless the user explicitly approves that expansion.

Forbidden by default:
- building generalized frameworks before the first working example;
- introducing new schemas because they may be useful later;
- requiring historical replay before live logging can start;
- requiring generalized OOS infrastructure before a simple forward test can run;
- refactoring unrelated production code while implementing an MVP;
- adding “nice to have” observability, dashboards, registries, or orchestration before the core loop works.

If the MVP can work with one script, one table/file, and one timer, prefer that first.

## 5. Acceptance criteria must be defined before implementation

Before substantial coding, state the exact evidence that will prove the MVP works.

Prefer concrete checks such as:
- alert emitted -> record exists;
- alert timestamp and price match source;
- +1H/+4H/+6H/+12H outcomes appear automatically;
- rerun does not duplicate or mutate the original alert;
- failure is visible and retryable.

Do not substitute architecture completion, test counts, code volume, or SHA generation for user-visible validation.

## 6. Protect the user's time and resources

Optimize for fast learning per unit of time and resource.

Before adding work that materially increases scope, estimate it.

Use a concise proposal such as:

- **Optional feature:** ...
- **Why it helps:** ...
- **Extra implementation time:** ...
- **Extra runtime/storage/API cost:** ...
- **Risk/complexity:** ...
- **Required for MVP?** No.

Wait for explicit approval before proceeding.

## 7. Preserve safety without blocking the MVP

MVP-first does not mean bypassing safety.

For trading/production code:
- do not place real orders without explicit authorization;
- prefer read-only, shadow, paper, or isolated paths for first validation;
- preserve immutable timestamps/prices for evaluation;
- do not silently modify production state;
- keep rollback simple.

Use the smallest safety mechanism needed for the MVP; do not build a full production governance platform unless justified.

## 8. When blocked, solve the blocker at the smallest layer

When a task fails:
1. identify the first failing layer;
2. fix only that layer;
3. rerun the smallest relevant test;
4. avoid redesigning adjacent systems unless the blocker proves it necessary.

Do not respond to each bug by expanding architecture.

If the same task repeatedly grows new blockers, stop and reassess whether the design has violated MVP-first principles.

## 9. ChatGPT / Codex collaboration rule

ChatGPT should:
- define the smallest useful goal;
- keep scope narrow;
- provide acceptance criteria;
- review evidence;
- propose optional expansions separately.

Codex should:
- implement only the approved scope;
- avoid speculative additions;
- report actual execution evidence;
- stop when the MVP acceptance criteria pass or when a real blocker is reached.

Neither agent should interpret “this might be useful later” as authorization to build it now.

## 10. Default decision rule

When choosing between:

A. a small implementation that can test the idea today, and  
B. a more complete system that may take days before the idea can be tested,

choose **A** by default.

The user's priority is:

**test the idea quickly -> learn from real results -> then expand only if justified.**
