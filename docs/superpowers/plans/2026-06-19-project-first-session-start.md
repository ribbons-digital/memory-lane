# Project-First SessionStart Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SessionStart baseline memory selection prefer current-project memories before global memories, without changing prompt-time recall or adding new policy configuration.

**Architecture:** Extend `selectBaselineMemories` with an optional `projectScope` in its existing options object. Sort baseline candidates by applicability tier first and recency second, then reuse the existing selection loop for approved-only filtering, secret filtering, deduplication, truncation, and budget enforcement. Pass the current project scope from `handleSessionStart` into selection and keep rendering behavior unchanged.

**Tech Stack:** TypeScript, Node test runner, pnpm workspace, `@memory-lane/lifecycle`.

---

## File structure

- Modify: `packages/lifecycle/src/injection.ts`
  - Add `BaselineSelectionOptions`.
  - Replace recency-first comparator with project-first baseline comparator when `projectScope` is provided.
  - Keep old recency-first behavior when no project scope is provided.
- Modify: `packages/lifecycle/src/handlers.ts`
  - Pass `engine.getProjectScope()?.key` into `selectBaselineMemories`.
- Modify: `packages/lifecycle/test/injection.test.ts`
  - Add project-first baseline selection tests.
  - Preserve no-scope recency-first test coverage.
- Modify: `packages/lifecycle/test/handlers.test.ts`
  - Add SessionStart integration coverage proving current-project memory is selected before newer global memory under a tight item budget.
- Modify: `README.md`
  - Document SessionStart baseline selection as project-first, while prompt-time recall remains relevance-based.

## Task 1: Add failing baseline selection tests

**Files:**
- Modify: `packages/lifecycle/test/injection.test.ts`

- [ ] **Step 1: Add project/global baseline helpers**

Near the existing `memoryWithUpdatedAt` helper, add:

```ts
function globalMemoryWithUpdatedAt(id: string, text: string, updatedAt: string): MemoryRecord {
  return {
    id,
    status: "approved",
    text,
    category: "preference",
    scope: { type: "global" },
    source: "manual",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt,
    kind: "preference",
  }
}

function projectMemoryWithUpdatedAt(id: string, project: string, text: string, updatedAt: string): MemoryRecord {
  return {
    id,
    status: "approved",
    text,
    category: "project",
    scope: { type: "project", key: project },
    source: "manual",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt,
    kind: "project_fact",
  }
}
```

If equivalent helpers already exist from earlier tests, reuse them instead of duplicating.

- [ ] **Step 2: Add project-first test**

Add this test near the existing `selectBaselineMemories` tests:

```ts
test("selectBaselineMemories prefers current project memories before newer globals", () => {
  const memories = [
    globalMemoryWithUpdatedAt("global-newest", "Global preference newest", "2026-06-19T00:00:00.000Z"),
    globalMemoryWithUpdatedAt("global-newer", "Global preference newer", "2026-06-18T00:00:00.000Z"),
    projectMemoryWithUpdatedAt("project-checkpoint", "/repo/sitewright", "Latest Sitewright checkpoint", "2026-06-16T00:00:00.000Z"),
    projectMemoryWithUpdatedAt("project-fact", "/repo/sitewright", "Sitewright uses pnpm", "2026-06-15T00:00:00.000Z"),
  ]

  const selected = selectBaselineMemories(memories, {
    projectScope: "/repo/sitewright",
    maxItems: 3,
    targetChars: 500,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
  })

  assert.deepEqual(selected.map((m) => m.id), ["project-checkpoint", "project-fact", "global-newest"])
})
```

- [ ] **Step 3: Add recency-within-tier and other-project fallback test**

Add:

```ts
test("selectBaselineMemories keeps recency order within project and global tiers", () => {
  const memories = [
    projectMemoryWithUpdatedAt("project-old", "/repo/sitewright", "Older project fact", "2026-06-12T00:00:00.000Z"),
    globalMemoryWithUpdatedAt("global-new", "New global preference", "2026-06-19T00:00:00.000Z"),
    projectMemoryWithUpdatedAt("project-new", "/repo/sitewright", "Newer project fact", "2026-06-18T00:00:00.000Z"),
    globalMemoryWithUpdatedAt("global-old", "Old global preference", "2026-06-10T00:00:00.000Z"),
    projectMemoryWithUpdatedAt("other-project", "/repo/other", "Other project fact", "2026-06-20T00:00:00.000Z"),
  ]

  const selected = selectBaselineMemories(memories, {
    projectScope: "/repo/sitewright",
    maxItems: 5,
    targetChars: 500,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
  })

  assert.deepEqual(selected.map((m) => m.id), ["project-new", "project-old", "global-new", "global-old", "other-project"])
})
```

- [ ] **Step 4: Update existing recency-first test to assert no-scope behavior**

Keep the existing test named `selectBaselineMemories picks recent approved memories within budget`, but ensure it calls `selectBaselineMemories` without `projectScope` and still expects recency-first IDs. If the helper changes require updating expected IDs, the expected order should remain the old recency-first order.

- [ ] **Step 5: Run focused test and verify failure**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- injection.test.ts
```

Expected: FAIL because `projectScope` is not part of the selection options and the comparator is still recency-first.

## Task 2: Implement project-first baseline comparator

**Files:**
- Modify: `packages/lifecycle/src/injection.ts`
- Test: `packages/lifecycle/test/injection.test.ts`

- [ ] **Step 1: Add baseline selection options type**

In `packages/lifecycle/src/injection.ts`, near the `MemoryInjectionLimits` interface, add:

```ts
export interface BaselineSelectionOptions extends Partial<MemoryInjectionLimits> {
  projectScope?: string
}
```

- [ ] **Step 2: Replace comparator with project-aware helpers**

Replace the existing `compareBaselineRelevance` function:

```ts
function compareBaselineRelevance(a: MemoryRecord, b: MemoryRecord): number {
  const dateCompare = b.updatedAt.localeCompare(a.updatedAt)
  if (dateCompare !== 0) return dateCompare
  const aProject = a.scope.type === "project" ? 1 : 0
  const bProject = b.scope.type === "project" ? 1 : 0
  return bProject - aProject
}
```

with:

```ts
function baselineTier(memory: MemoryRecord, projectScope?: string): number {
  if (!projectScope) return 0
  if (memory.scope.type === "project" && memory.scope.key === projectScope) return 0
  if (memory.scope.type === "global") return 1
  if (memory.scope.type === "project") return 2
  return 3
}

function compareBaselineRelevance(projectScope?: string): (a: MemoryRecord, b: MemoryRecord) => number {
  return (a, b) => {
    const tierCompare = baselineTier(a, projectScope) - baselineTier(b, projectScope)
    if (tierCompare !== 0) return tierCompare
    return b.updatedAt.localeCompare(a.updatedAt)
  }
}
```

This preserves recency-first behavior when `projectScope` is omitted because all memories have tier `0`.

- [ ] **Step 3: Update `selectBaselineMemories` signature and sorting**

Change:

```ts
export function selectBaselineMemories(
  memories: MemoryRecord[],
  options?: Partial<MemoryInjectionLimits>,
): MemoryRecord[] {
```

to:

```ts
export function selectBaselineMemories(
  memories: MemoryRecord[],
  options?: BaselineSelectionOptions,
): MemoryRecord[] {
```

Then change:

```ts
.sort(compareBaselineRelevance)
```

to:

```ts
.sort(compareBaselineRelevance(options?.projectScope))
```

Keep the rest of the function unchanged.

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- injection.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add packages/lifecycle/src/injection.ts packages/lifecycle/test/injection.test.ts
git commit -m "feat(lifecycle): prioritize project baseline memories"
```

## Task 3: Pass project scope into SessionStart selection

**Files:**
- Modify: `packages/lifecycle/src/handlers.ts`
- Modify: `packages/lifecycle/test/handlers.test.ts`

- [ ] **Step 1: Pass `projectScope` to `selectBaselineMemories`**

In `handleSessionStart`, the `projectScope` constant currently exists immediately before `renderMemoryContext`. Move or duplicate it so it is available before `selectBaselineMemories`.

Change this block:

```ts
const baselineCandidates = approved.filter((memory) => !operatingAgreementIds.has(memory.id))
const selected = selectBaselineMemories(baselineCandidates, limitsFromContextPolicy("sessionStart", policy, {
  ...options,
  hardMaxChars: remainingChars,
  targetChars: remainingChars,
  absoluteMaxChars: remainingChars,
}))
const projectScope = engine.getProjectScope()?.key
const memoryContext = renderMemoryContext({ event: "sessionStart", memories: selected, policy, projectScope })
```

to:

```ts
const baselineCandidates = approved.filter((memory) => !operatingAgreementIds.has(memory.id))
const projectScope = engine.getProjectScope()?.key
const selected = selectBaselineMemories(baselineCandidates, limitsFromContextPolicy("sessionStart", policy, {
  ...options,
  projectScope,
  hardMaxChars: remainingChars,
  targetChars: remainingChars,
  absoluteMaxChars: remainingChars,
}))
const memoryContext = renderMemoryContext({ event: "sessionStart", memories: selected, policy, projectScope })
```

- [ ] **Step 2: Add handler integration test**

In `packages/lifecycle/test/handlers.test.ts`, add a test near existing SessionStart selective tests:

```ts
test("session-start selects current project memory before newer global memory", () => {
  const project = tempDir()
  const engine = engineInTemp(project, { contextPolicy: { mode: "selective", maxItems: { sessionStart: 1, prompt: 6 } } })
  engine.save({ text: "Global preference newest for all projects", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  engine.save({ text: "Current project checkpoint should win baseline selection", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })

  const result = handleSessionStart(engine, { cwd: project }, {
    maxItems: 1,
    targetChars: 500,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
  })
  const context = result.additionalContext ?? ""

  assert.match(context, /Current project checkpoint should win baseline selection/u)
  assert.doesNotMatch(context, /Global preference newest for all projects/u)
  assert.match(context, /### Current project/u)
})
```

If `updatedAt` ordering matters in this test, use `engine.update` or direct records only if existing test helpers allow it. The core assertion is that current-project wins even when the global memory is saved first or is otherwise eligible under a one-item budget.

- [ ] **Step 3: Run handler tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- handlers.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Task 3**

Run:

```bash
git add packages/lifecycle/src/handlers.ts packages/lifecycle/test/handlers.test.ts
git commit -m "feat(lifecycle): use project scope for session start baseline"
```

## Task 4: Document SessionStart project-first behavior

**Files:**
- Modify: `README.md`
- Modify: `ROADMAP.md` if useful for tracking the slice.

- [ ] **Step 1: Update README context policy section**

After the paragraph about readable grouped memory blocks, add:

```md
For `SessionStart`, baseline memory selection is project-first when a project scope is available: current-project approved memories are selected before global memories, then rendered with the same readable grouping. This applies only to session-opening baseline context; prompt-time `UserPromptSubmit` recall remains relevance-based and bounded by the prompt context policy.
```

- [ ] **Step 2: Optionally update ROADMAP**

If the roadmap should track this slice, add a short completed/in-progress note under Phase 18 or the continuity follow-up area. Keep it constrained to project-first SessionStart selection; do not add preference-budget work.

- [ ] **Step 3: Run docs diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md ROADMAP.md
git commit -m "docs: document project-first session start"
```

If `ROADMAP.md` was not changed, omit it.

## Task 5: Final verification and review packet

**Files:**
- No source edits expected unless verification finds an issue.

- [ ] **Step 1: Run full tests**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 3: Run diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Inspect diff and commits**

Run:

```bash
git diff --stat main...HEAD
git log --oneline --decorate main..HEAD
```

Expected: spec, plan, lifecycle selector/handler/tests, docs.

- [ ] **Step 5: Prepare review summary**

Return:

```md
Changed:
- SessionStart baseline selection now prioritizes current-project memories before global memories when project scope is known.
- Recency remains the ordering within each tier.
- No-project-scope selection remains recency-first.
- Prompt-time recall and semantic ranking are unchanged.
- Docs updated.

Verified:
- `pnpm test`
- `pnpm build`
- `git diff --check`

Out of scope:
- Prompt-time recall changes
- Preference-specific budgets
- Scope hygiene cleanup
- MCP behavior
```

## Self-review

- Spec coverage: tasks cover project-first SessionStart ordering, recency within tiers, global eligibility after project memories, no-scope fallback, handler scope passing, prompt recall non-change, tests, and docs.
- Placeholder scan: no `TBD`, `TODO`, vague “add tests”, or unspecified implementation steps remain.
- Type consistency: plan consistently uses `BaselineSelectionOptions`, `projectScope?: string`, and `selectBaselineMemories(..., { projectScope })`.
