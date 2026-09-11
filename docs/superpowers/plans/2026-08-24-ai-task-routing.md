# AI Task Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route market analysis tasks to verified AI models with deterministic fallbacks.

**Architecture:** Add a pure routing module beside the existing channel registry. The model gateway receives an ordered list of compatible targets and retries only eligible provider failures. Existing consultation and plan-review callers supply the appropriate task category.

**Tech Stack:** Next.js/TypeScript, D1, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-24-ai-task-routing-design.md`

## Global Constraints

- Never expose API keys to the browser.
- Only tested-and-enabled targets may be selected.
- Keep the live trading route disabled.

---

### Task 1: Pure task route selection

**Files:**
- Create: `lib/advisory/task-routing.ts`
- Test: `tests/advisory-task-routing.test.mjs`

**Interfaces:**
- Produces `AiTaskKind`, `routeTargets(task, targets)` and `defaultTaskRoute(task)`.

- [ ] **Step 1: Write the failing test**

```js
assert.deepEqual(routeTargets("market_scan", targets).map((target) => target.model), ["deepseek-v4-flash", "gpt-5.6-luna"]);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/advisory-task-routing.test.mjs`

- [ ] **Step 3: Write minimal implementation**

```ts
export function routeTargets(task: AiTaskKind, targets: readonly RoutedTarget[]) {
  return [...targets].sort((left, right) => priority(task, left) - priority(task, right));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/advisory-task-routing.test.mjs`

### Task 2: Retry eligible model failures

**Files:**
- Modify: `lib/advisory/model-gateway.ts`
- Test: `tests/advisory-task-routing.test.mjs`

**Interfaces:**
- Consumes `CompatibleTarget[]`.
- Produces `invokeStructuredModelWithFallback(request, { targets })`.

- [ ] **Step 1: Write the failing test**

```js
const result = await invokeStructuredModelWithFallback(request, { targets, fetcher });
assert.equal(result.model, "gpt-5.6-luna");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/advisory-task-routing.test.mjs`

- [ ] **Step 3: Write minimal implementation**

```ts
for (const target of targets) {
  try { return await invokeStructuredModel(request, { target }); }
  catch (error) { if (!(error instanceof ModelProviderError) || !error.requiresManualSwitch) throw error; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/advisory-task-routing.test.mjs`

### Task 3: Connect task routing to analyses

**Files:**
- Modify: `lib/advisory/daily-job.ts`
- Modify: `app/api/ai/plan-review/route.ts`
- Test: `tests/advisory-task-routing.test.mjs`

**Interfaces:**
- Consultation uses `expert_consultation`.
- Plan review uses `risk_review`.

- [ ] **Step 1: Write the failing test**

```js
assert.equal(taskForPositionAnalysis(), "expert_consultation");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/advisory-task-routing.test.mjs`

- [ ] **Step 3: Write minimal implementation**

```ts
const targets = await resolveTaskTargets(db, "expert_consultation");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/advisory-task-routing.test.mjs`

### Task 4: Verify and expose current routing state

**Files:**
- Modify: `app/api/connections/route.ts`
- Modify: `app/settings/ConnectionSettings.tsx`
- Test: `tests/advisory-task-routing.test.mjs`

**Interfaces:**
- Produces task route summaries without credentials.

- [ ] **Step 1: Write the failing test**

```js
assert.equal(routeSummary.market_scan[0].model, "deepseek-v4-flash");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/advisory-task-routing.test.mjs`

- [ ] **Step 3: Write minimal implementation**

```ts
return { taskRouting: buildTaskRoutingSummary(targets) };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/advisory-task-routing.test.mjs`

### Task 5: Verify build and local runtime

**Files:**
- Test: `tests/advisory-task-routing.test.mjs`

- [ ] **Step 1: Run focused tests**

Run: `node --test tests/advisory-task-routing.test.mjs`

- [ ] **Step 2: Run type check and build**

Run: `npx tsc --noEmit && npm run build`

- [ ] **Step 3: Restart local runtime**

Run: `STREETLIGHT_LOCALHOST=true npm start -- --hostname 127.0.0.1 --port 3003`
