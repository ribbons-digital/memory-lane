# Global Memory Hygiene Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface approved global memories that look project-specific as text-free, read-only continuity hints.

**Architecture:** Extend existing `ContinuityHintSummary` rather than adding a new command. Add typed scope-hygiene candidate metadata and reason codes in core, detect conservative global-scope mismatches inside `buildContinuityHints`, and rely on existing dashboard/status/doctor/MCP continuity hint surfaces to expose the signal.

**Tech Stack:** TypeScript, Node test runner, pnpm workspace, `@memory-lane/core`, CLI/MCP JSON surfaces.

---

## File structure

- Modify: `CONTEXT.md`
  - Add glossary term `Scope hygiene candidate`.
- Modify: `packages/core/src/types.ts`
  - Add `scope-hygiene-candidate` hint code.
  - Add `ScopeHygieneReason` and `ScopeHygieneCandidateMetadata` types.
  - Add `scopeHygieneCandidates` to `ContinuityHintSummary`.
- Modify: `packages/core/src/continuity-hints.ts`
  - Add conservative candidate detection for approved global project/category/kind/path-like memories.
  - Emit a single aggregate continuity hint when candidates exist.
- Modify: `packages/core/test/continuity-hints.test.ts`
  - Add unit tests for detection, non-detection, reason codes, maxIds, and text-free output.
- Modify: `packages/cli/test/cli.test.ts`
  - Add fixture coverage showing dashboard/status JSON include metadata without text and human output remains compact.
- Modify: `packages/mcp-server/test/handlers.test.ts`
  - Add `memory_status` coverage for text-free scope hygiene candidates.
- Modify: `README.md`
  - Document scope hygiene hints as inspection-only signals.

## Task 1: Add core types and failing continuity hint tests

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/test/continuity-hints.test.ts`

- [ ] **Step 1: Add types**

In `packages/core/src/types.ts`, extend `ContinuityHintCode`:

```ts
export type ContinuityHintCode =
  | "superseded-visible"
  | "operating-agreement-overlap"
  | "project-global-overlap"
  | "scope-hygiene-candidate"
  | "newer-approved"
```

After `ContinuityHintMemoryMetadata`, add:

```ts
export type ScopeHygieneReason =
  | "project-category-global-scope"
  | "project-kind-global-scope"
  | "project-path-global-scope"

export interface ScopeHygieneCandidateMetadata {
  id: string
  status: Extract<MemoryStatus, "approved">
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  reason: ScopeHygieneReason
}
```

Then add this field to `ContinuityHintSummary`:

```ts
scopeHygieneCandidates: ScopeHygieneCandidateMetadata[]
```

- [ ] **Step 2: Add failing detection test**

In `packages/core/test/continuity-hints.test.ts`, add after the project/global preference overlap test:

```ts
test("continuity hints report global memories that look project-specific without text", () => {
  const result = buildContinuityHints([
    memory({
      id: "global-project-category",
      text: "SECRET PROJECT CATEGORY TEXT",
      category: "project",
      scope: { type: "global" },
      kind: "misc",
    }),
    memory({
      id: "global-project-kind",
      text: "SECRET PROJECT KIND TEXT",
      category: "preference",
      scope: { type: "global" },
      kind: "project_fact",
    }),
    memory({
      id: "global-project-path",
      text: "SECRET PATH TEXT implemented in docs/superpowers/specs/example.md",
      category: "preference",
      scope: { type: "global" },
      kind: "preference",
    }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.scopeHygieneCandidates.map((candidate) => ({ id: candidate.id, reason: candidate.reason })), [
    { id: "global-project-category", reason: "project-category-global-scope" },
    { id: "global-project-kind", reason: "project-kind-global-scope" },
    { id: "global-project-path", reason: "project-path-global-scope" },
  ])
  assert.ok(result.hints.some((hint) => hint.code === "scope-hygiene-candidate" && hint.severity === "review"))
  assert.match(result.suggestedActions.join("\n"), /memory-lane list --json/u)
  assert.doesNotMatch(json(result), /SECRET PROJECT CATEGORY TEXT|SECRET PROJECT KIND TEXT|SECRET PATH TEXT/u)
})
```

- [ ] **Step 3: Add non-detection test**

Add:

```ts
test("continuity hints do not flag ordinary global workflow preferences or non-approved records", () => {
  const result = buildContinuityHints([
    memory({
      id: "valid-global-workflow",
      text: "Global workflow preference: use PRs and keep roadmap updated.",
      category: "preference",
      scope: { type: "global" },
      kind: "workflow_rule",
    }),
    memory({
      id: "pending-global-project",
      text: "SECRET PENDING PROJECT TEXT",
      category: "project",
      scope: { type: "global" },
      status: "pending",
      kind: "project_fact",
    }),
    memory({
      id: "project-scoped-fact",
      text: "SECRET PROJECT SCOPED TEXT",
      category: "project",
      scope: { type: "project", key: "project-a" },
      kind: "project_fact",
    }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.scopeHygieneCandidates, [])
  assert.equal(result.hints.some((hint) => hint.code === "scope-hygiene-candidate"), false)
  assert.doesNotMatch(json(result), /SECRET PENDING PROJECT TEXT|SECRET PROJECT SCOPED TEXT/u)
})
```

- [ ] **Step 4: Add maxIds test**

Add:

```ts
test("continuity hints limit scope hygiene candidate metadata and ids", () => {
  const result = buildContinuityHints([
    memory({ id: "one", category: "project", scope: { type: "global" } }),
    memory({ id: "two", category: "project", scope: { type: "global" } }),
    memory({ id: "three", category: "project", scope: { type: "global" } }),
  ], { maxIds: 2 })

  assert.deepEqual(result.scopeHygieneCandidates.map((candidate) => candidate.id), ["one", "two"])
  const hint = result.hints.find((item) => item.code === "scope-hygiene-candidate")
  assert.deepEqual(hint?.memoryIds, ["one", "two"])
  assert.equal(hint?.count, 3)
})
```

- [ ] **Step 5: Run focused test and verify failure**

Run:

```bash
pnpm --filter @memory-lane/core test -- continuity-hints.test.ts
```

Expected: FAIL because `scopeHygieneCandidates` and detection are not implemented yet.

## Task 2: Implement scope hygiene candidate detection

**Files:**
- Modify: `packages/core/src/continuity-hints.ts`
- Modify: `packages/core/test/continuity-hints.test.ts`

- [ ] **Step 1: Update imports**

In `packages/core/src/continuity-hints.ts`, add `MemoryKind`, `ScopeHygieneCandidateMetadata`, and `ScopeHygieneReason` to the type import list:

```ts
  MemoryKind,
  MemoryRecord,
  OperatingAgreementSelection,
  ScopeHygieneCandidateMetadata,
  ScopeHygieneReason,
  WorkflowArea,
```

- [ ] **Step 2: Add reason helpers near `ids`**

Add:

```ts
const PROJECT_SPECIFIC_KINDS = new Set<MemoryKind>(["project_fact", "project_checkpoint", "session_summary"])

const PROJECT_PATH_PATTERNS = [
  /(?:^|\s)(?:~|\/Users\/[^\s]+)\/projects\/[^\s]+/iu,
  /(?:^|\s)packages\/[\w.-]+\/src\//iu,
  /(?:^|\s)docs\/superpowers\//iu,
] as const

function scopeHygieneReason(memory: MemoryRecord): ScopeHygieneReason | undefined {
  if (memory.status !== "approved" || memory.scope.type !== "global") return undefined
  if (memory.category === "project") return "project-category-global-scope"
  if (memory.kind && PROJECT_SPECIFIC_KINDS.has(memory.kind)) return "project-kind-global-scope"
  if (PROJECT_PATH_PATTERNS.some((pattern) => pattern.test(memory.text))) return "project-path-global-scope"
  return undefined
}

function scopeHygieneMetadata(memory: MemoryRecord, reason: ScopeHygieneReason): ScopeHygieneCandidateMetadata {
  return {
    id: memory.id,
    status: "approved",
    category: memory.category,
    scope: memory.scope,
    source: memory.source,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    kind: memory.kind,
    provenance: memory.provenance,
    reason,
  }
}
```

- [ ] **Step 3: Detect candidates inside `buildContinuityHints`**

After `const hints: ContinuityHint[] = []`, add:

```ts
  const allScopeHygieneCandidates = memories
    .map((memory): ScopeHygieneCandidateMetadata | undefined => {
      const reason = scopeHygieneReason(memory)
      return reason ? scopeHygieneMetadata(memory, reason) : undefined
    })
    .filter((candidate): candidate is ScopeHygieneCandidateMetadata => Boolean(candidate))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
  const scopeHygieneCandidates = allScopeHygieneCandidates.slice(0, maxIds)
```

Then after superseded hint generation, add:

```ts
  if (allScopeHygieneCandidates.length) {
    hints.push({
      code: "scope-hygiene-candidate",
      severity: "review",
      message: "Some global memories look project-specific and may need manual scope review.",
      count: allScopeHygieneCandidates.length,
      memoryIds: scopeHygieneCandidates.map((memory) => memory.id),
      suggestedActions: ["memory-lane list --json"],
    })
  }
```

- [ ] **Step 4: Return the new field**

In the final return object, add:

```ts
scopeHygieneCandidates,
```

Place it near `supersededVisible`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/core test -- continuity-hints.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/continuity-hints.ts packages/core/test/continuity-hints.test.ts
git commit -m "feat(core): flag global scope hygiene candidates"
```

## Task 3: Add CLI and MCP surface coverage

**Files:**
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Add a scope hygiene record to CLI continuity fixture**

In `packages/cli/test/cli.test.ts`, inside `continuityFixtureRecords`, add this record to the returned array:

```ts
    {
      id: "global-project-like",
      text: "PRIVATE GLOBAL PROJECT-LIKE TEXT docs/superpowers/specs/sitewright-specific.md",
      category: "preference",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "preference",
      createdAt: "2026-06-18T07:30:00.000Z",
      updatedAt: "2026-06-18T07:30:00.000Z",
    },
```

- [ ] **Step 2: Update dashboard JSON continuity test**

In `dashboard --json includes text-free continuity hints`, add assertions:

```ts
assert.equal(parsed.data.continuityHints.scopeHygieneCandidates[0].id, "global-project-like")
assert.equal(parsed.data.continuityHints.scopeHygieneCandidates[0].reason, "project-path-global-scope")
assert.ok(parsed.data.continuityHints.hints.some((hint: any) => hint.code === "scope-hygiene-candidate"))
```

Update the text leak assertion to include `PRIVATE GLOBAL PROJECT-LIKE TEXT`.

- [ ] **Step 3: Update human dashboard/status text-free assertions**

In the human dashboard and status/doctor tests that already assert private continuity fixture text is absent, add `PRIVATE GLOBAL PROJECT-LIKE TEXT` to the forbidden regex.

Also assert the human dashboard output includes the hint code compactly:

```ts
assert.match(output, /scope-hygiene-candidate/u)
```

- [ ] **Step 4: Add MCP memory_status coverage**

In `packages/mcp-server/test/handlers.test.ts`, find the `memory_status includes text-free continuity hints` test or equivalent fixture. Add an approved global project-like memory:

```ts
engine.save({
  text: "PRIVATE MCP GLOBAL PROJECT-LIKE TEXT docs/superpowers/specs/mcp-specific.md",
  status: "approved",
  category: "preference",
  scopeType: "global",
  kind: "preference",
})
```

Then assert:

```ts
assert.equal(result.data.status.continuityHints.scopeHygieneCandidates[0].reason, "project-path-global-scope")
assert.ok(result.data.status.continuityHints.hints.some((hint: any) => hint.code === "scope-hygiene-candidate"))
assert.doesNotMatch(JSON.stringify(result.data.status.continuityHints), /PRIVATE MCP GLOBAL PROJECT-LIKE TEXT/u)
```

Adapt variable names to the existing test's parsed payload shape.

- [ ] **Step 5: Run surface tests**

Run:

```bash
pnpm --filter @memory-lane/cli test -- cli.test.ts
pnpm --filter @memory-lane/mcp-server test -- handlers.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add packages/cli/test/cli.test.ts packages/mcp-server/test/handlers.test.ts
git commit -m "test: cover scope hygiene hint surfaces"
```

## Task 4: Document glossary and user-facing behavior

**Files:**
- Modify: `CONTEXT.md`
- Modify: `README.md`

- [ ] **Step 1: Add glossary term**

In `CONTEXT.md`, after `Checkpoint candidate`, add:

```md
**Scope hygiene candidate**:
An approved visible memory whose scope metadata may be broader than its content warrants, such as a global memory that appears to describe a specific project, repository, session, checkpoint, release, or implementation detail. It is an inspection signal only; Memory Lane does not automatically rescope, delete, reject, or supersede it.
_Avoid_: Scope error, automatic cleanup, rejected memory, rescope recommendation
```

- [ ] **Step 2: Update README context/diagnostic docs**

In `README.md`, near the lifecycle/context policy or dashboard/status description, add:

```md
Status, doctor, and dashboard continuity hints may also report scope hygiene candidates: approved global memories that look project-specific because of their category, kind, or path-like content. These hints are text-free inspection signals only. Memory Lane does not automatically rescope or clean up those memories; use `memory-lane list --json` to inspect them before deciding whether to update, supersede, or leave them alone.
```

- [ ] **Step 3: Run diff check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 4: Commit docs**

Run:

```bash
git add CONTEXT.md README.md
git commit -m "docs: document scope hygiene candidates"
```

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

Expected: spec, plan, core types/detection/tests, CLI/MCP surface tests, README/CONTEXT docs.

- [ ] **Step 5: Prepare review summary**

Return:

```md
Changed:
- Added text-free scope hygiene candidates to continuity hints.
- Flags approved global memories that look project-specific by category, kind, or path-like content.
- Exposes metadata/reason codes through existing status/dashboard/doctor/MCP continuity hint surfaces.
- Documented scope hygiene candidates.

Verified:
- `pnpm test`
- `pnpm build`
- `git diff --check`

Out of scope:
- Automatic rescoping/cleanup
- Recall/injection/ranking changes
- New config flags
- MCP mutation changes
```

## Self-review

- Spec coverage: tasks cover candidate detection, non-detection, maxIds, text-free surfaces, docs/glossary, and out-of-scope constraints.
- Placeholder scan: no `TBD`, `TODO`, or vague “add tests” steps remain.
- Type consistency: reason type is `ScopeHygieneReason`; metadata field is `scopeHygieneCandidates`; hint code is `scope-hygiene-candidate`.
