# Global Preference Layering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add bounded global-preference layering to automatic Memory Lane context selection for SessionStart and UserPromptSubmit.

**Architecture:** Extend the shared lifecycle context policy resolver with optional preference budgets, then centralize layered selection in `packages/lifecycle/src/injection.ts` so Claude, Codex, pi, and future adapters inherit the same behavior through existing handlers. Keep diagnostics minimal in this slice: tests may assert lifecycle `contextDecision`, but richer status/doctor/MCP selected/omitted metadata is deferred.

**Tech Stack:** TypeScript, Node test runner, pnpm monorepo, Memory Lane core/lifecycle packages.

---

## Spec and scope

Approved spec: `docs/superpowers/specs/2026-06-20-global-preference-layering-design.md`

In scope:

- Optional `memory.contextPolicy.preferenceMaxItems` and `memory.contextPolicy.preferenceMaxChars` config fields.
- Layered baseline selection for SessionStart.
- Layered prompt selection for UserPromptSubmit while preserving recall relevance and generic-prompt skipping.
- Tests for global preference inclusion, bounding, project-before-global ordering, prompt relevance, and budget enforcement.
- Docs for saving/inspecting/narrowing global preferences using existing commands/tools.

Out of scope:

- New CLI commands.
- New MCP tools.
- Rich status/doctor/MCP selected/omitted preference-count diagnostics.
- Automatic preference learning or approval.
- Explicit override/supersede/rescope semantics.

## Files

Modify:

- `packages/core/src/types.ts`
  - Add optional preference budget fields to `MemoryContextPolicyConfig`.
- `packages/core/src/config.ts`
  - Add defaults and validation for preference budget fields.
- `packages/lifecycle/src/injection.ts`
  - Resolve preference budget defaults.
  - Add preference-like helper and layered selection helpers.
  - Replace prompt and baseline selection internals with layered selection behavior while preserving existing exported function names where possible.
- `packages/lifecycle/src/handlers.ts`
  - Pass resolved preference budgets through existing selection calls if needed.
- `packages/lifecycle/test/injection.test.ts`
  - Unit tests for layered selectors and rendering order.
- `packages/lifecycle/test/handlers.test.ts`
  - Integration tests through `handleSessionStart` and `handleUserPromptSubmit`.
- `packages/core/test/engine.test.ts` or a smaller config-focused core test file if one already exists.
  - Config validation/default tests.
- `README.md`
  - User guidance for global preferences and project-specific narrowing.
- `CONTEXT.md`
  - Add glossary entry for global preference layer / project preference layer if useful.
- `ROADMAP.md`
  - Mark Phase 18 Slice 1 as in progress/completed as appropriate.
- `HANDOFF.md`
  - Update current status after implementation.

Do not modify:

- MCP schemas or CLI command surfaces for this slice unless an existing type import breaks from config changes.

---

## Task 1: Add preference budget config types, defaults, and validation

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/config.ts`
- Test: `packages/core/test/engine.test.ts` or existing config test file if discovered during implementation

- [ ] **Step 1: Write failing config tests**

Add tests proving default preference budgets exist after config load and invalid values are rejected. If there is no dedicated config test file, add near existing config/default tests in `packages/core/test/engine.test.ts`.

Use test cases equivalent to:

```ts
it("loads default preference context budgets", () => {
  const e = new MemoryEngine({
    memoryPath: path.join(dir, "mem.jsonl"),
    embeddingsPath: path.join(dir, "emb.jsonl"),
    configPath: path.join(dir, "cfg.json"),
  })

  assert.deepEqual(e.getContextPolicy()?.preferenceMaxItems, { sessionStart: 2, prompt: 2 })
  assert.deepEqual(e.getContextPolicy()?.preferenceMaxChars, { sessionStart: 600, prompt: 900 })
})

it("rejects invalid preference context budget config", () => {
  fs.writeFileSync(path.join(dir, "cfg.json"), JSON.stringify({
    semantic: {
      enabled: false,
      activeEmbeddingProfile: "local-example",
      embeddings: { profiles: {} },
      retrieval: {
        topK: 8,
        minSimilarity: 0.25,
        semanticWeight: 0.65,
        lexicalWeight: 0.25,
        recencyWeight: 0.1,
        fallbackToAllVisibleOnMiss: true,
      },
      privacy: { allowRemoteEmbeddings: false },
    },
    obsidian: { enabled: false },
    memory: {
      contextPolicy: {
        preferenceMaxItems: { sessionStart: -1 },
      },
    },
  }))

  assert.throws(
    () => new MemoryEngine({
      memoryPath: path.join(dir, "mem.jsonl"),
      embeddingsPath: path.join(dir, "emb.jsonl"),
      configPath: path.join(dir, "cfg.json"),
    }),
    /memory\.contextPolicy\.preferenceMaxItems\.sessionStart/u,
  )
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-layering/packages/core
pnpm test -- test/engine.test.ts
```

Expected: FAIL because `preferenceMaxItems` / `preferenceMaxChars` are missing or validation does not recognize them.

- [ ] **Step 3: Extend `MemoryContextPolicyConfig`**

In `packages/core/src/types.ts`, add optional fields:

```ts
  preferenceMaxItems?: {
    sessionStart?: number
    prompt?: number
  }
  preferenceMaxChars?: {
    sessionStart?: number
    prompt?: number
  }
```

- [ ] **Step 4: Add defaults and validation**

In `packages/core/src/config.ts`, update `DEFAULT_CONFIG.memory.contextPolicy`:

```ts
      preferenceMaxItems: { sessionStart: 2, prompt: 2 },
      preferenceMaxChars: { sessionStart: 600, prompt: 900 },
```

In `validateContextPolicyConfig`, validate the two optional objects exactly like `maxItems` and `maxChars`:

```ts
  if (o.preferenceMaxItems !== undefined) {
    const preferenceMaxItems = obj(o.preferenceMaxItems, "memory.contextPolicy.preferenceMaxItems")
    if (preferenceMaxItems.sessionStart !== undefined) positiveInt(preferenceMaxItems.sessionStart, "memory.contextPolicy.preferenceMaxItems.sessionStart")
    if (preferenceMaxItems.prompt !== undefined) positiveInt(preferenceMaxItems.prompt, "memory.contextPolicy.preferenceMaxItems.prompt")
  }
  if (o.preferenceMaxChars !== undefined) {
    const preferenceMaxChars = obj(o.preferenceMaxChars, "memory.contextPolicy.preferenceMaxChars")
    if (preferenceMaxChars.sessionStart !== undefined) positiveInt(preferenceMaxChars.sessionStart, "memory.contextPolicy.preferenceMaxChars.sessionStart")
    if (preferenceMaxChars.prompt !== undefined) positiveInt(preferenceMaxChars.prompt, "memory.contextPolicy.preferenceMaxChars.prompt")
  }
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-layering/packages/core
pnpm test -- test/engine.test.ts
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-layering
pnpm build
```

Expected: PASS.

---

## Task 2: Add layered selection unit tests and helper implementation

**Files:**
- Modify: `packages/lifecycle/src/injection.ts`
- Test: `packages/lifecycle/test/injection.test.ts`

- [ ] **Step 1: Write failing unit tests**

Add tests to `packages/lifecycle/test/injection.test.ts` near existing `selectBaselineMemories` tests.

Test 1: SessionStart includes bounded global preferences after project content:

```ts
test("selectBaselineMemories includes bounded global preferences after current project context", () => {
  const memories = [
    projectMemory("project-checkpoint", "repo", "Current project release checkpoint", "project_checkpoint"),
    globalMemory("global-one", "User prefers concise final answers", "preference"),
    globalMemory("global-two", "User prefers pnpm for package installation", "preference"),
    globalMemory("global-three", "User prefers extra verbose summaries", "preference"),
  ]

  const selected = selectBaselineMemories(memories, {
    projectScope: "repo",
    maxItems: 4,
    targetChars: 1000,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
    preferenceMaxItems: 2,
    preferenceMaxChars: 1000,
  })

  assert.deepEqual(selected.map((memory) => memory.id), ["project-checkpoint", "global-one", "global-two"])
})
```

Test 2: Project preference renders before duplicate/overlapping global preference:

```ts
test("selectBaselineMemories prefers project preference over exact duplicate global preference", () => {
  const memories = [
    { ...globalMemory("global-pref", "Use pnpm for package installation", "preference"), updatedAt: "2026-06-20T00:00:00.000Z" },
    { ...projectMemory("project-pref", "repo", "Use pnpm for package installation", "preference"), category: "preference" as const, updatedAt: "2026-06-19T00:00:00.000Z" },
  ]

  const selected = selectBaselineMemories(memories, {
    projectScope: "repo",
    maxItems: 2,
    targetChars: 1000,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
    preferenceMaxItems: 2,
    preferenceMaxChars: 1000,
  })

  assert.deepEqual(selected.map((memory) => memory.id), ["project-pref"])
})
```

Test 3: Prompt selection remains relevance-driven but can include relevant global preference:

```ts
test("selectMemoriesForInjection includes relevant global preference within preference budget", () => {
  const selected = selectMemoriesForInjection("pnpm package installation", recall([
    globalMemory("global-pref", "User prefers pnpm for package installation", "preference"),
    globalMemory("global-other", "User prefers short final answers", "preference"),
  ], false, "No semantic matches"), {
    maxItems: 4,
    targetChars: 1000,
    hardMaxChars: 1000,
    absoluteMaxChars: 1000,
    preferenceMaxItems: 1,
    preferenceMaxChars: 1000,
  })

  assert.deepEqual(selected.map((memory) => memory.id), ["global-pref"])
})
```

- [ ] **Step 2: Run focused lifecycle tests and verify RED**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-layering/packages/lifecycle
pnpm test -- test/injection.test.ts
```

Expected: FAIL because `preferenceMaxItems`/`preferenceMaxChars` are not accepted in selection options and selection is not layered/bounded.

- [ ] **Step 3: Extend lifecycle policy and limit types**

In `packages/lifecycle/src/injection.ts`, extend `MemoryInjectionLimits` and add a dedicated selector options type so prompt selection can receive project scope without polluting low-level limit semantics:

```ts
export interface MemoryInjectionLimits {
  maxItems: number
  targetChars: number
  hardMaxChars: number
  absoluteMaxChars: number
  preferenceMaxItems?: number
  preferenceMaxChars?: number
}

export interface MemorySelectionOptions extends Partial<MemoryInjectionLimits> {
  projectScope?: string
}
```

Update `BaselineSelectionOptions` to extend `MemorySelectionOptions` rather than `Partial<MemoryInjectionLimits>`.

Update `ResolvedMemoryContextPolicy` to include:

```ts
  preferenceMaxItems: { sessionStart: number; prompt: number }
  preferenceMaxChars: { sessionStart: number; prompt: number }
```

Update `DEFAULT_CONTEXT_POLICY` and `resolveContextPolicy` to resolve defaults `{ sessionStart: 2, prompt: 2 }` and `{ sessionStart: 600, prompt: 900 }`.

Update `limitsFromContextPolicy` to include event-specific preference caps. Update `capLimits` so it preserves/clamps `preferenceMaxItems` and `preferenceMaxChars` instead of dropping those optional fields when it returns merged limits.

- [ ] **Step 4: Add selection helpers**

Add helper functions in `packages/lifecycle/src/injection.ts` near existing grouping helpers:

```ts
function isPreferenceLikeMemory(memory: MemoryRecord): boolean {
  return memory.category === "preference" || memory.kind === "preference" || memory.kind === "workflow_rule"
}

function preferenceBudget(options: MemoryInjectionLimits): { maxItems: number; maxChars: number } {
  return {
    maxItems: Math.max(0, options.preferenceMaxItems ?? 2),
    maxChars: Math.max(0, options.preferenceMaxChars ?? Math.min(options.hardMaxChars, 900)),
  }
}
```

Add a small shared selection appender that enforces total budget, preference budget, dedupe, and secret filtering. It should:

- Track `selected.length` against total `maxItems`.
- Track total selected chars against `hardMaxChars`.
- Track preference selected count/chars against preference caps for preference-like records.
- Deduplicate by `normalizedMemoryKey` across all layers.
- Fit/truncate with `fitMemoryWithinBudget` using the stricter remaining total/preference char budget.

- [ ] **Step 5: Implement layered baseline selection**

Replace `selectBaselineMemories` internals with layer construction:

```ts
const currentProjectPreferences = candidates.filter((memory) => memory.scope.type === "project" && memory.scope.key === options?.projectScope && isPreferenceLikeMemory(memory))
const currentProjectContent = candidates.filter((memory) => memory.scope.type === "project" && memory.scope.key === options?.projectScope && !isPreferenceLikeMemory(memory))
const globalPreferences = candidates.filter((memory) => memory.scope.type === "global" && isPreferenceLikeMemory(memory))
const globalMemory = candidates.filter((memory) => memory.scope.type === "global" && !isPreferenceLikeMemory(memory))
const otherProject = candidates.filter((memory) => memory.scope.type === "project" && memory.scope.key !== options?.projectScope)
```

Sort each layer by `updatedAt` descending, except preserve exact duplicate project preference before global preference due to layer order.

When no `projectScope` exists, do not classify project memories as current project; start with global preferences/global memory, then other project only if budget remains.

- [ ] **Step 6: Implement layered prompt selection**

Keep `shouldSkipAutomaticInjection`, `requiresLexicalOverlap`, lexical filtering, secret filtering, and recall order relevance. Layer only the recalled candidates that pass existing relevance gates.

Implementation approach:

1. Build `eligible` by walking `result.memories` in recall order and applying existing lexical/secret checks.
2. Partition `eligible` into current project preferences, current project content, global preferences, global non-preferences, and other.
3. Append layers in that order, using preference caps for preference-like records.
4. Preserve recall order within each layer rather than sorting by recency.

Because `selectMemoriesForInjection` currently has no project scope option, change its third parameter type to `MemorySelectionOptions`, and pass `projectScope` from `handleUserPromptSubmit`.

- [ ] **Step 7: Verify GREEN**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-layering/packages/lifecycle
pnpm test -- test/injection.test.ts
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-layering
pnpm build
```

Expected: PASS.

---

## Task 3: Wire layered prompt/session selection through handlers and integration tests

**Files:**
- Modify: `packages/lifecycle/src/handlers.ts`
- Test: `packages/lifecycle/test/handlers.test.ts`

- [ ] **Step 1: Write failing handler tests**

Add tests to `packages/lifecycle/test/handlers.test.ts`.

Test 1: SessionStart respects configured global preference cap:

```ts
test("session-start selective bounds global preferences separately from project context", () => {
  const project = tempDir()
  const engine = engineInTemp(project, {
    contextPolicy: {
      mode: "selective",
      maxItems: { sessionStart: 4 },
      preferenceMaxItems: { sessionStart: 1 },
    },
  })
  engine.save({ text: "Project checkpoint should remain", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })
  engine.save({ text: "User prefers pnpm globally", status: "approved", category: "preference", scopeType: "global", kind: "preference" })
  engine.save({ text: "User prefers concise replies globally", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

  const result = handleSessionStart(engine, { cwd: project })
  const context = result.additionalContext ?? ""

  assert.match(context, /Project checkpoint should remain/u)
  assert.match(context, /User prefers pnpm globally|User prefers concise replies globally/u)
  assert.equal((context.match(/User prefers/gu) ?? []).length, 1)
})
```

Test 2: Prompt passes project scope so project preference precedes global preference:

```ts
test("user-prompt selective renders project preference before relevant global preference", async () => {
  const project = tempDir()
  const engine = engineInTemp(project, {
    contextPolicy: {
      mode: "selective",
      maxItems: { prompt: 4 },
      preferenceMaxItems: { prompt: 2 },
    },
  })
  engine.save({ text: "Use pnpm for this repo", status: "approved", category: "preference", scopeType: "project", kind: "preference" })
  engine.save({ text: "Use pnpm globally", status: "approved", category: "preference", scopeType: "global", kind: "preference" })

  const result = await handleUserPromptSubmit(engine, { cwd: project, prompt: "pnpm repo package manager" })
  const context = result.additionalContext ?? ""

  assert.match(context, /### Current project/u)
  assert.match(context, /### Global preferences and workflow rules/u)
  assert.ok(context.indexOf("Use pnpm for this repo") < context.indexOf("Use pnpm globally"))
})
```

- [ ] **Step 2: Run focused handler tests and verify RED**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-layering/packages/lifecycle
pnpm test -- test/handlers.test.ts
```

Expected: FAIL until handlers pass project scope and config budgets into selectors.

- [ ] **Step 3: Pass project scope into prompt selection**

In `handleUserPromptSubmit`, change selection call from:

```ts
const selected = selectMemoriesForInjection(recallQuery, recalled, limitsFromContextPolicy("prompt", policy, options))
const projectScope = engine.getProjectScope()?.key
```

to resolve `projectScope` first and pass it:

```ts
const projectScope = engine.getProjectScope()?.key
const selected = selectMemoriesForInjection(recallQuery, recalled, {
  ...limitsFromContextPolicy("prompt", policy, options),
  projectScope,
})
```

- [ ] **Step 4: Ensure SessionStart receives preference caps after continuity budget**

Keep the existing remaining-char adjustment. Ensure `limitsFromContextPolicy("sessionStart", policy, ...)` keeps event-specific `preferenceMaxItems` and clamps `preferenceMaxChars` to `remainingChars` if needed.

- [ ] **Step 5: Verify GREEN**

Run:

```bash
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-layering/packages/lifecycle
pnpm test -- test/handlers.test.ts
cd /Users/shiang/.config/superpowers/worktrees/memory-lane/phase-18-preference-layering
pnpm build
```

Expected: PASS.

---

## Task 4: Cross-adapter regression tests and docs

**Files:**
- Modify tests if needed: `packages/claude-adapter/test/runner.test.ts`, `packages/codex-adapter/test/runner.test.ts`, `packages/pi-adapter` tests if present
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Inspect adapter tests**

Run:

```bash
find packages -path '*test*' -type f | rg '(claude|codex|pi).*test'
```

Identify existing tests that assert lifecycle context text or runner output. Prefer adding small assertions to existing runner tests rather than creating broad new fixtures.

- [ ] **Step 2: Add cross-adapter assertions only where lifecycle output is already tested**

For Claude and Codex runner tests, add or update assertions so they prove generated lifecycle output still includes grouped memory context and does not expose extra diagnostics. If adapter tests do not create memory fixtures, skip adapter-specific text assertions and rely on lifecycle handler tests; do not build a large adapter-specific fixture framework in this slice.

- [ ] **Step 3: Update README guidance**

Add a concise section under memory/context policy guidance:

```md
### Global preferences and project-specific narrowing

Global preferences (`category: preference`, `scope: global`) can guide every project, but automatic context rendering keeps them in a bounded preference layer so they do not crowd out current-project checkpoints or facts. Project-scoped preferences render before global preferences for the same project.

Use existing inspection surfaces before changing or relying on preference state:

- `memory-lane list --json`
- `memory-lane review --json`
- `memory-lane status --json`
- `memory-lane continuity --json`
- MCP: `memory_list`, `memory_review`, `memory_status`, `memory_continuity({ projectPath })`

Optional context policy caps:

```json
{
  "memory": {
    "contextPolicy": {
      "preferenceMaxItems": { "sessionStart": 2, "prompt": 2 },
      "preferenceMaxChars": { "sessionStart": 600, "prompt": 900 }
    }
  }
}
```
```

- [ ] **Step 4: Update CONTEXT glossary**

Add concise terms:

```md
**Global preference layer**:
A bounded automatic-context selection layer for approved global preference-like memories. It lets durable user-wide preferences influence sessions without crowding out current-project continuity.
_Avoid_: Unbounded global memory injection, automatic preference approval, override rule

**Project preference layer**:
The automatic-context selection layer for approved current-project preference-like memories. It renders before global preferences so narrower project guidance is easier to follow, without creating an explicit supersede or conflict-resolution relationship.
_Avoid_: Supersede relationship, automatic override, project memory cleanup
```

- [ ] **Step 5: Update ROADMAP/HANDOFF**

ROADMAP: mark Phase 18 Slice 1 as implemented or in progress and explicitly leave richer metadata/inspection as deferred Phase 18 follow-up.

HANDOFF: record branch/worktree, spec, plan, scope, tests run, and remaining work.

- [ ] **Step 6: Verify docs and adapter tests**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: PASS.

---

## Task 5: Final review and PR readiness

**Files:**
- Review all changed files
- Create/update: `subagents/` review reports only if using subagent reviews; do not delete existing tracked `subagents/*.md`

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm build
pnpm test
git diff --check
git status --short
```

Expected:

- Build passes.
- Tests pass.
- Diff check passes.
- Only intentional files modified/untracked.

- [ ] **Step 2: Request implementation review**

Use reviewer/subagent review focused on:

- Spec compliance.
- Budget correctness.
- Prompt relevance preservation.
- Project/global preference ordering.
- No new CLI/MCP surface.
- No raw memory text in diagnostics beyond intended rendered context.

- [ ] **Step 3: Fix review findings with TDD**

For each required finding:

1. Add or update a failing test that demonstrates the issue.
2. Run focused test and verify RED.
3. Fix implementation.
4. Run focused test and verify GREEN.
5. Re-run full verification.

- [ ] **Step 4: Prepare PR**

After review and verification pass:

```bash
git status --short
git add docs/superpowers/specs/2026-06-20-global-preference-layering-design.md docs/superpowers/plans/2026-06-20-global-preference-layering.md packages README.md CONTEXT.md ROADMAP.md HANDOFF.md
git commit -m "feat: add global preference layering"
git push -u origin feature/phase-18-preference-layering
gh pr create --title "feat: add global preference layering" --body-file /tmp/memory-lane-phase-18-pr.md
```

Do not merge locally. Wait for user merge/approval per the Memory Lane PR-protected workflow.
