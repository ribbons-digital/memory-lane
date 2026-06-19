# Readable Memory Context Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render lifecycle-injected Memory Lane context in readable groups that make current-project, global, and other-project memory applicability obvious.

**Architecture:** Keep selection/ranking unchanged and improve only the shared lifecycle renderer. Add optional render options carrying the current project scope, then pass the engine's refreshed project scope from lifecycle handlers into prompt and session-start context rendering.

**Tech Stack:** TypeScript, Node test runner, pnpm workspace, `@memory-lane/core`, `@memory-lane/lifecycle`.

---

## File structure

- Modify `packages/lifecycle/src/injection.ts`
  - Add `MemoryBlockRenderOptions`.
  - Add human label/group helpers.
  - Update `renderMemoryBlock` and `renderMemoryContext` to render readable grouped memory blocks.
- Modify `packages/lifecycle/src/handlers.ts`
  - Pass the current project scope into `renderMemoryContext` for `UserPromptSubmit` and `SessionStart`.
- Modify `packages/lifecycle/test/injection.test.ts`
  - Add focused unit tests for grouping and labels.
  - Update existing flat-list assertions.
- Modify `packages/lifecycle/test/handlers.test.ts`
  - Add/adjust integration-level tests proving lifecycle context uses readable labels.
- Modify adapter/CLI tests only if snapshots/assertions expect the old flat text:
  - `packages/claude-adapter/test/runner.test.ts`
  - `packages/codex-adapter/test/runner.test.ts`
  - `packages/cli/test/cli.test.ts`
- Modify `README.md`
  - Document grouped/labeled injected memory blocks under lifecycle context policy.

## Task 1: Add readable grouping unit tests

**Files:**
- Modify: `packages/lifecycle/test/injection.test.ts`

- [ ] **Step 1: Add helper variants for global and project memories**

Near the existing `memory(id, text)` helper, add these helpers:

```ts
function globalMemory(id: string, text: string, kind: MemoryRecord["kind"] = "preference"): MemoryRecord {
  return {
    id,
    status: "approved",
    text,
    category: "preference",
    scope: { type: "global" },
    source: "manual",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    kind,
  }
}

function projectMemory(id: string, project: string, text: string, kind: MemoryRecord["kind"] = "project_fact"): MemoryRecord {
  return {
    id,
    status: "approved",
    text,
    category: "project",
    scope: { type: "project", key: project },
    source: "manual",
    createdAt: "2026-05-26T00:00:00.000Z",
    updatedAt: "2026-05-26T00:00:00.000Z",
    kind,
  }
}
```

- [ ] **Step 2: Replace or update the existing `renderMemoryBlock` test**

Find the existing test named like `renderMemoryBlock renders selected memories` and update it to expect grouped readable output:

```ts
test("renderMemoryBlock groups current project and global memories with readable labels", () => {
  const rendered = renderMemoryBlock([
    projectMemory("p1", "repo", "Latest Sitewright checkpoint", "project_checkpoint"),
    globalMemory("g1", "Always keep HANDOFF.md synced", "workflow_rule"),
  ], { projectScope: "repo" })

  assert.match(rendered, /## Relevant Memory/u)
  assert.match(rendered, /Memory Lane selected these approved memories/u)
  assert.match(rendered, /### Current project/u)
  assert.match(rendered, /\*\*Project checkpoint\*\*/u)
  assert.match(rendered, /Latest Sitewright checkpoint/u)
  assert.match(rendered, /### Global preferences and workflow rules/u)
  assert.match(rendered, /\*\*Workflow rule\*\*/u)
  assert.match(rendered, /Always keep HANDOFF\.md synced/u)
  assert.doesNotMatch(rendered, /\[global\/preference\/workflow_rule\]/u)
})
```

- [ ] **Step 3: Add tests for unknown and other-project scopes**

Add these tests near the render tests:

```ts
test("renderMemoryBlock labels project memories when current project scope is unknown", () => {
  const rendered = renderMemoryBlock([
    projectMemory("p1", "/tmp/sitewright", "This repo uses pnpm", "project_fact"),
  ])

  assert.match(rendered, /### Project-specific memory/u)
  assert.match(rendered, /\*\*Project fact\*\*/u)
  assert.match(rendered, /This repo uses pnpm/u)
})

test("renderMemoryBlock separates other visible project memories", () => {
  const rendered = renderMemoryBlock([
    projectMemory("p1", "/tmp/other", "Memory system design intent", "project_fact"),
  ], { projectScope: "/tmp/sitewright" })

  assert.match(rendered, /### Other visible project memory/u)
  assert.match(rendered, /\*\*Project fact\*\*/u)
  assert.match(rendered, /Memory system design intent/u)
})
```

- [ ] **Step 4: Add a `renderMemoryContext` test for grouped context wrapper**

Add:

```ts
test("renderMemoryContext wraps grouped readable memories in guarded context", () => {
  const rendered = renderMemoryContext({
    event: "prompt",
    memories: [
      projectMemory("p1", "repo", "Latest Sitewright checkpoint", "project_checkpoint"),
      globalMemory("g1", "Keep next steps constrained", "preference"),
    ],
    projectScope: "repo",
  })

  assert.match(rendered, /^<memory-context mode="selective" event="prompt">/u)
  assert.match(rendered, /### Current project/u)
  assert.match(rendered, /\*\*Project checkpoint\*\*/u)
  assert.match(rendered, /### Global preferences and workflow rules/u)
  assert.match(rendered, /\*\*Preference\*\*/u)
  assert.match(rendered, /<\/memory-context>$/u)
})
```

- [ ] **Step 5: Run the focused test and verify failure**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- injection.test.ts
```

Expected: FAIL because `renderMemoryBlock` does not accept options and still renders a flat list.

## Task 2: Implement readable grouped rendering

**Files:**
- Modify: `packages/lifecycle/src/injection.ts`
- Test: `packages/lifecycle/test/injection.test.ts`

- [ ] **Step 1: Add render option and group types**

In `packages/lifecycle/src/injection.ts`, near the existing `MemoryContextEvent` type, add:

```ts
export interface MemoryBlockRenderOptions {
  projectScope?: string
}

type MemoryContextGroupKey =
  | "current-project"
  | "project-specific"
  | "global-preferences"
  | "global-memory"
  | "other-project"
  | "other"

interface MemoryContextGroup {
  key: MemoryContextGroupKey
  title: string
  memories: MemoryRecord[]
}
```

- [ ] **Step 2: Add readable label helpers before `renderMemoryBlock`**

Add this implementation before `renderMemoryBlock`:

```ts
const MEMORY_CONTEXT_GROUPS: Array<{ key: MemoryContextGroupKey; title: string }> = [
  { key: "current-project", title: "Current project" },
  { key: "project-specific", title: "Project-specific memory" },
  { key: "global-preferences", title: "Global preferences and workflow rules" },
  { key: "global-memory", title: "Global memory" },
  { key: "other-project", title: "Other visible project memory" },
  { key: "other", title: "Other visible memory" },
]

function titleCaseKind(value: string): string {
  return value
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function readableMemoryKind(memory: MemoryRecord): string {
  switch (memory.kind) {
    case "project_checkpoint":
      return "Project checkpoint"
    case "workflow_rule":
      return "Workflow rule"
    case "session_summary":
      return "Session summary"
    case "project_fact":
      return "Project fact"
    case "preference":
      return "Preference"
    default:
      return memory.kind ? titleCaseKind(memory.kind) : titleCaseKind(memory.category)
  }
}

function isGlobalPreferenceLike(memory: MemoryRecord): boolean {
  return memory.scope.type === "global"
    && (memory.category === "preference" || memory.kind === "workflow_rule" || memory.kind === "preference")
}

function groupKeyForMemory(memory: MemoryRecord, options?: MemoryBlockRenderOptions): MemoryContextGroupKey {
  if (memory.scope.type === "project") {
    if (!options?.projectScope) return "project-specific"
    return memory.scope.key === options.projectScope ? "current-project" : "other-project"
  }

  if (memory.scope.type === "global") return isGlobalPreferenceLike(memory) ? "global-preferences" : "global-memory"
  return "other"
}

function groupMemoriesForContext(memories: MemoryRecord[], options?: MemoryBlockRenderOptions): MemoryContextGroup[] {
  const grouped = new Map<MemoryContextGroupKey, MemoryRecord[]>()
  for (const memory of memories) {
    const key = groupKeyForMemory(memory, options)
    grouped.set(key, [...(grouped.get(key) ?? []), memory])
  }

  return MEMORY_CONTEXT_GROUPS
    .map((group) => ({ ...group, memories: grouped.get(group.key) ?? [] }))
    .filter((group) => group.memories.length > 0)
}
```

- [ ] **Step 3: Replace `renderMemoryBlock`**

Replace the existing function:

```ts
export function renderMemoryBlock(memories: MemoryRecord[]): string {
  if (!memories.length) return ""
  return ["## Relevant Memory", "", ...memories.map((memory) => `- ${memory.text}`)].join("\n")
}
```

with:

```ts
export function renderMemoryBlock(memories: MemoryRecord[], options?: MemoryBlockRenderOptions): string {
  if (!memories.length) return ""

  const lines = [
    "## Relevant Memory",
    "",
    "Memory Lane selected these approved memories for this turn. They may include current-project memories and global preferences or workflow rules.",
  ]

  for (const group of groupMemoriesForContext(memories, options)) {
    lines.push("", `### ${group.title}`, "")
    for (const memory of group.memories) {
      lines.push(`- **${readableMemoryKind(memory)}**`, `  ${memory.text}`)
    }
  }

  return lines.join("\n")
}
```

- [ ] **Step 4: Update `renderMemoryContext` input type and body**

Change the function signature from:

```ts
export function renderMemoryContext(input: { event: MemoryContextEvent; memories: MemoryRecord[]; policy?: MemoryContextPolicyConfig }): string {
```

to:

```ts
export function renderMemoryContext(input: { event: MemoryContextEvent; memories: MemoryRecord[]; policy?: MemoryContextPolicyConfig; projectScope?: string }): string {
```

Then replace the final selective body:

```ts
return [
  header,
  "These are selected Memory Lane memories for this turn. They are not an authoritative full memory list.",
  "",
  ...input.memories.map((memory) => `- ${memory.text}`),
  footer,
].join("\n")
```

with:

```ts
return [
  header,
  renderMemoryBlock(input.memories, { projectScope: input.projectScope }),
  footer,
].join("\n")
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- injection.test.ts
```

Expected: PASS for the new readable rendering tests, with possible failures in old assertions that still expect the previous flat introductory sentence.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add packages/lifecycle/src/injection.ts packages/lifecycle/test/injection.test.ts
git commit -m "feat(lifecycle): group injected memory context"
```

## Task 3: Pass current project scope from lifecycle handlers

**Files:**
- Modify: `packages/lifecycle/src/handlers.ts`
- Modify/Test: `packages/lifecycle/test/handlers.test.ts`

- [ ] **Step 1: Pass project scope into prompt rendering**

`MemoryEngine.getProjectScope()` already returns `ProjectScope | null`. In `handleUserPromptSubmit`, change:

```ts
const memoryContext = renderMemoryContext({ event: "prompt", memories: selected, policy })
```

to:

```ts
const projectScope = engine.getProjectScope()?.key
const memoryContext = renderMemoryContext({ event: "prompt", memories: selected, policy, projectScope })
```

Place the `projectScope` constant immediately before the `renderMemoryContext` call. Do not change `engine.refreshScope(input.cwd)` or scope resolution behavior.

- [ ] **Step 2: Pass project scope into session-start rendering**

In `handleSessionStart`, change:

```ts
const memoryContext = renderMemoryContext({ event: "sessionStart", memories: selected, policy })
```

to:

```ts
const projectScope = engine.getProjectScope()?.key
const memoryContext = renderMemoryContext({ event: "sessionStart", memories: selected, policy, projectScope })
```

Place this `projectScope` constant immediately before the `renderMemoryContext` call. Policy-only rendering does not render memory groups, so leave policy-only calls unchanged.

- [ ] **Step 3: Add a handler test proving current project heading appears**

In `packages/lifecycle/test/handlers.test.ts`, add or update a test that creates an approved project memory, calls `handleSessionStart`, and asserts:

```ts
assert.match(result.additionalContext ?? "", /### Current project/u)
assert.match(result.additionalContext ?? "", /\*\*Project fact\*\*/u)
```

Use the existing test fixture style in that file for constructing `MemoryEngine` and saving approved memories.

- [ ] **Step 4: Run lifecycle handler tests**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test -- handlers.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add packages/lifecycle/src/handlers.ts packages/lifecycle/test/handlers.test.ts
git commit -m "feat(lifecycle): label current project memory context"
```

## Task 4: Update adapter/CLI tests for new readable output

**Files:**
- Modify if needed: `packages/claude-adapter/test/runner.test.ts`
- Modify if needed: `packages/codex-adapter/test/runner.test.ts`
- Modify if needed: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Run affected tests**

Run:

```bash
pnpm --filter @memory-lane/claude-adapter test -- runner.test.ts
pnpm --filter @memory-lane/codex-adapter test -- runner.test.ts
pnpm --filter @memory-lane/cli test -- cli.test.ts
```

Expected: Some assertions may fail if they expect the old flat `These are selected...` text or direct `- memory text` bullets.

- [ ] **Step 2: Update assertions to check readable structure**

For hook output tests that previously asserted only memory text, keep that assertion and add structure checks such as:

```ts
assert.match(output.additionalContext ?? "", /## Relevant Memory/u)
assert.match(output.additionalContext ?? "", /### Current project|### Project-specific memory|### Global preferences and workflow rules/u)
assert.match(output.additionalContext ?? "", /\*\*(Project fact|Preference|Workflow rule|Project checkpoint)\*\*/u)
```

Do not assert exact full rendered blocks unless the existing test already does exact matching; prefer resilient regex assertions.

- [ ] **Step 3: Re-run affected tests**

Run:

```bash
pnpm --filter @memory-lane/claude-adapter test -- runner.test.ts
pnpm --filter @memory-lane/codex-adapter test -- runner.test.ts
pnpm --filter @memory-lane/cli test -- cli.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit Task 4 if any files changed**

Run:

```bash
git status --short
git add packages/claude-adapter/test/runner.test.ts packages/codex-adapter/test/runner.test.ts packages/cli/test/cli.test.ts
git commit -m "test: update hook context rendering assertions"
```

If no test files changed, do not create an empty commit.

## Task 5: Document readable injected memory context

**Files:**
- Modify: `README.md`
- Modify if roadmap status needs slice note: `ROADMAP.md`

- [ ] **Step 1: Update README context policy section**

In `README.md`, under `### Context policy`, add this paragraph after the mode list or before prompt-time continuity guidance:

```md
When `selective` mode injects memory bodies, the `Relevant Memory` block is grouped for readability. Current-project memories are separated from global preferences/workflow rules and other visible project memories, and each memory shows a plain-language type label such as `Project checkpoint`, `Workflow rule`, `Preference`, or `Project fact`. These labels explain applicability only; they do not change recall ranking or memory selection.
```

- [ ] **Step 2: Add a short roadmap note**

In `ROADMAP.md`, under Phase 18 or the continuity follow-up area, add a completed/in-progress note only if the team wants this slice tracked there. Suggested wording:

```md
- In progress: readable lifecycle-injected memory context labels, grouping current-project memories separately from global preferences/workflow rules without changing recall ranking.
```

If `ROADMAP.md` already has a better active-slice section, place the note there. Do not expand scope beyond Slice A.

- [ ] **Step 3: Run docs diff check**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add README.md ROADMAP.md
git commit -m "docs: document readable memory context labels"
```

If `ROADMAP.md` was not changed, omit it from `git add`.

## Task 6: Final verification and review packet

**Files:**
- No source edits expected unless verification finds an issue.

- [ ] **Step 1: Run full test suite**

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

- [ ] **Step 3: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat main...HEAD
git log --oneline --decorate main..HEAD
```

Expected: commits include spec, plan, lifecycle implementation, tests, and docs.

- [ ] **Step 5: Prepare review summary**

Create a concise summary with:

```md
Changed:
- Grouped lifecycle-injected `Relevant Memory` blocks by current project, global preferences/workflow rules, and other visible scopes.
- Added readable kind labels such as `Project checkpoint`, `Workflow rule`, and `Project fact`.
- Passed project scope into lifecycle rendering without changing recall ranking/selection.
- Documented the behavior.

Verified:
- `pnpm test`
- `pnpm build`
- `git diff --check`

Out of scope:
- Recall ranking changes
- Pending review visibility
- Scope hygiene cleanup
```

## Self-review

- Spec coverage: tasks cover readable grouping, current/global/other scope distinctions, plain-language labels, unchanged ranking, tests, and docs.
- Placeholder scan: no `TBD`, `TODO`, or vague “add tests” steps remain; code snippets and commands are concrete.
- Type consistency: plan consistently uses `MemoryBlockRenderOptions`, optional `projectScope`, `renderMemoryBlock(memories, options)`, and `renderMemoryContext({ ..., projectScope })`.
