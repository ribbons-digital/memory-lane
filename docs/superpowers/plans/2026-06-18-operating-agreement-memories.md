# Operating Agreement Memories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only operating agreement discovery so users and agents can find current workflow contracts without lifecycle injection or memory mutation.

**Architecture:** Add a pure core selector in a new focused module, expose it through `MemoryEngine`, then add CLI formatting/command support and text-free status metadata. MCP receives the summary through existing `memory_status` because it already returns `engine.doctor()`.

**Tech Stack:** TypeScript, Node test runner, pnpm workspace, existing Memory Lane core/CLI/MCP packages.

---

## Spec and scope

Implement approved spec: `docs/superpowers/specs/2026-06-18-operating-agreement-memories-design.md`.

Keep these constraints intact:

- No lifecycle injection changes.
- No automatic memory writes.
- No schema revision fields such as `canonical`, `supersedes`, `supersededBy`, or `revisionOf`.
- No cleanup/update/delete suggestions.
- No MCP full-text agreements tool.
- Status/doctor/MCP status remain text-free for operating agreements.

## File map

- Create: `packages/core/src/operating-agreements.ts`
  - Pure selector, area classifier, metadata projection, validation helpers, and exported constants.
- Modify: `packages/core/src/types.ts`
  - Add exported operating agreement types.
- Modify: `packages/core/src/engine.ts`
  - Add `operatingAgreements()`, `operatingAgreementSummary()`, and include summary in `doctor()`.
- Modify: `packages/core/src/index.ts`
  - Export selector helpers and types.
- Modify: `packages/core/test/engine.test.ts`
  - Core selector and engine tests.
- Modify: `packages/cli/src/formatters.ts`
  - Add `formatOperatingAgreements()` and human status/doctor summary line.
- Modify: `packages/cli/src/index.ts`
  - Add `agreements` command, area/limit parsing, command dispatch, and usage text.
- Modify: `packages/cli/test/cli.test.ts`
  - CLI tests for JSON/human output, scoping, filters, limits, and text-free status.
- Modify: `packages/mcp-server/test/handlers.test.ts`
  - Confirm `memory_status` exposes text-free summary and respects `projectPath`.
- Modify: `README.md`
  - Document the new CLI command and status behavior.
- Modify: `skills/memory-lane/SKILL.md`
  - Add guidance to use `memory-lane agreements` for explicit operating contract retrieval.
- Modify: `ROADMAP.md`
  - Mark Slice 2 complete after implementation.
- Modify: `HANDOFF.md`
  - Record Slice 2 completion and next recommended Slice 3.

---

### Task 1: Core selector types and pure helper

**Files:**
- Create: `packages/core/src/operating-agreements.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Add failing core tests for explicit, heuristic, ranking, scoping, limits, and metadata**

Append this `describe` block near the bottom of `packages/core/test/engine.test.ts` before the file ends:

```ts
describe("operating agreement selection", () => {
  function record(overrides: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
    return {
      id: overrides.id,
      text: overrides.text,
      status: overrides.status ?? "approved",
      category: overrides.category ?? "project",
      scope: overrides.scope ?? { type: "project", key: "project-a" },
      source: overrides.source ?? "manual",
      kind: overrides.kind,
      createdAt: overrides.createdAt ?? "2026-06-18T00:00:00.000Z",
      updatedAt: overrides.updatedAt ?? "2026-06-18T00:00:00.000Z",
      provenance: overrides.provenance,
      project: overrides.project,
    }
  }

  it("selects explicit workflow_rule memories as primary operating agreements", () => {
    const result = selectOperatingAgreements([
      record({
        id: "rule-1",
        kind: "workflow_rule",
        text: "Project loop: spec review before implementation.",
        updatedAt: "2026-06-18T10:00:00.000Z",
      }),
    ], { projectScopeKey: "project-a" })

    assert.equal(result.primary.length, 1)
    assert.equal(result.primary[0].memory.id, "rule-1")
    assert.equal(result.primary[0].workflowArea, "project-loop")
    assert.equal(result.primary[0].matchReason, "explicit-kind")
    assert.equal(result.primary[0].recommendedKind, undefined)
    assert.equal(result.relatedCandidates.length, 0)
  })

  it("selects heuristic preference and project_fact candidates and recommends workflow_rule", () => {
    const result = selectOperatingAgreements([
      record({
        id: "loop-pref",
        category: "preference",
        kind: "preference",
        scope: { type: "global" },
        text: "Global working preference: use the project loop with review gates before implementation.",
      }),
      record({
        id: "plain-pref",
        category: "preference",
        kind: "preference",
        scope: { type: "global" },
        text: "User prefers concise answers.",
      }),
      record({
        id: "project-pr",
        kind: "project_fact",
        text: "For PR process, use feature branches and wait for merge approval.",
      }),
    ], { projectScopeKey: "project-a" })

    assert.deepEqual(result.primary.map((item) => item.memory.id).sort(), ["loop-pref", "project-pr"])
    assert.ok(result.primary.every((item) => item.matchReason === "heuristic"))
    assert.ok(result.primary.every((item) => item.recommendedKind === "workflow_rule"))
    assert.ok(!result.primary.some((item) => item.memory.id === "plain-pref"))
    assert.ok(!result.relatedCandidates.some((item) => item.memory.id === "plain-pref"))
  })

  it("prefers explicit kind, then project scope, then recency for each area", () => {
    const result = selectOperatingAgreements([
      record({
        id: "new-global-loop",
        category: "preference",
        kind: "preference",
        scope: { type: "global" },
        text: "Global workflow loop: plan, review, implement.",
        updatedAt: "2026-06-18T12:00:00.000Z",
      }),
      record({
        id: "old-project-loop",
        kind: "project_fact",
        text: "Project collaboration workflow loop: roadmap, plan, review, implement.",
        updatedAt: "2026-06-18T11:00:00.000Z",
      }),
      record({
        id: "explicit-global-loop",
        kind: "workflow_rule",
        scope: { type: "global" },
        category: "preference",
        text: "Workflow rule: use review-gated loop.",
        updatedAt: "2026-06-18T09:00:00.000Z",
      }),
    ], { projectScopeKey: "project-a" })

    assert.equal(result.primary.length, 1)
    assert.equal(result.primary[0].memory.id, "explicit-global-loop")
    assert.deepEqual(result.relatedCandidates.map((item) => item.memory.id), ["old-project-loop", "new-global-loop"])
  })

  it("respects project plus global scope by default and all scope when requested", () => {
    const memories = [
      record({ id: "project-a-loop", text: "Project workflow loop for A.", scope: { type: "project", key: "project-a" }, kind: "project_fact" }),
      record({ id: "project-b-loop", text: "Project workflow loop for B.", scope: { type: "project", key: "project-b" }, kind: "project_fact" }),
      record({ id: "global-loop", text: "Global workflow loop.", scope: { type: "global" }, category: "preference", kind: "preference" }),
    ]

    const scoped = selectOperatingAgreements(memories, { projectScopeKey: "project-a" })
    const all = selectOperatingAgreements(memories, { projectScopeKey: "project-a", all: true })

    assert.ok(scoped.primary.concat(scoped.relatedCandidates).some((item) => item.memory.id === "project-a-loop"))
    assert.ok(scoped.primary.concat(scoped.relatedCandidates).some((item) => item.memory.id === "global-loop"))
    assert.ok(!scoped.primary.concat(scoped.relatedCandidates).some((item) => item.memory.id === "project-b-loop"))
    assert.ok(all.primary.concat(all.relatedCandidates).some((item) => item.memory.id === "project-b-loop"))
  })

  it("filters by area, applies limits, and reports omitted counts", () => {
    const result = selectOperatingAgreements([
      record({ id: "loop-1", text: "Project workflow loop: plan first.", kind: "project_fact", updatedAt: "2026-06-18T12:00:00.000Z" }),
      record({ id: "loop-2", text: "Project workflow loop: older rule.", kind: "project_fact", updatedAt: "2026-06-18T11:00:00.000Z" }),
      record({ id: "review-1", text: "Review gate: get approval before merge.", kind: "project_fact" }),
    ], { projectScopeKey: "project-a", area: "project-loop", limit: 1, relatedLimit: 0 })

    assert.deepEqual(result.primary.map((item) => item.memory.id), ["loop-1"])
    assert.deepEqual(result.relatedCandidates, [])
    assert.equal(result.omittedPrimaryCount, 0)
    assert.equal(result.omittedRelatedCandidateCount, 1)
    assert.deepEqual(result.workflowAreas, ["project-loop"])
  })

  it("builds a text-free operating agreement summary", () => {
    const result = summarizeOperatingAgreements(selectOperatingAgreements([
      record({ id: "private-loop", text: "PRIVATE AGREEMENT TEXT workflow loop", kind: "project_fact" }),
    ], { projectScopeKey: "project-a" }))
    const serialized = JSON.stringify(result)

    assert.equal(result.primaryCount, 1)
    assert.equal(result.primary[0].id, "private-loop")
    assert.equal(result.primary[0].workflowArea, "project-loop")
    assert.ok(!serialized.includes("PRIVATE AGREEMENT TEXT"))
  })
})
```

Add these imports at the top of `packages/core/test/engine.test.ts`:

```ts
import {
  selectOperatingAgreements,
  summarizeOperatingAgreements,
} from "../src/operating-agreements.js"
import type { MemoryRecord } from "../src/types.js"
```

- [ ] **Step 2: Run core tests and verify they fail for missing selector module**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: FAIL with an import/module error for `../src/operating-agreements.js` or missing exported functions.

- [ ] **Step 3: Add operating agreement types**

In `packages/core/src/types.ts`, add these types after `FreshnessStatusOptions`:

```ts
export type WorkflowArea =
  | "project-loop"
  | "review-gate"
  | "pr-process"
  | "release-process"
  | "tooling-preference"
  | "other"

export type OperatingAgreementMatchReason = "explicit-kind" | "heuristic"

export interface OperatingAgreementSelection {
  memory: MemoryRecord
  workflowArea: WorkflowArea
  matchReason: OperatingAgreementMatchReason
  recommendedKind?: "workflow_rule"
}

export interface OperatingAgreementMetadata {
  id: string
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  workflowArea: WorkflowArea
  matchReason: OperatingAgreementMatchReason
  recommendedKind?: "workflow_rule"
}

export interface OperatingAgreementList {
  projectScope: string | "none"
  workflowAreas: WorkflowArea[]
  primary: OperatingAgreementSelection[]
  relatedCandidates: OperatingAgreementSelection[]
  omittedPrimaryCount: number
  omittedRelatedCandidateCount: number
  notes: string[]
}

export interface OperatingAgreementSummary {
  projectScope: string | "none"
  primaryCount: number
  relatedCandidateCount: number
  omittedPrimaryCount: number
  omittedRelatedCandidateCount: number
  workflowAreas: WorkflowArea[]
  primary: OperatingAgreementMetadata[]
  relatedCandidates: OperatingAgreementMetadata[]
  notes: string[]
}

export interface OperatingAgreementOptions {
  projectScopeKey?: string
  all?: boolean
  area?: WorkflowArea
  limit?: number
  relatedLimit?: number
}
```

- [ ] **Step 4: Create the pure selector module**

Create `packages/core/src/operating-agreements.ts` with this implementation:

```ts
import type {
  MemoryKind,
  MemoryRecord,
  OperatingAgreementList,
  OperatingAgreementMetadata,
  OperatingAgreementOptions,
  OperatingAgreementSelection,
  WorkflowArea,
} from "./types.js"

export const WORKFLOW_AREAS: readonly WorkflowArea[] = [
  "project-loop",
  "review-gate",
  "pr-process",
  "release-process",
  "tooling-preference",
  "other",
]

const DEFAULT_LIMIT = 5
const DEFAULT_RELATED_LIMIT = 10
const AGREEMENT_COMPATIBLE_KINDS = new Set<MemoryKind>(["preference", "project_fact"])

const AREA_PATTERNS: Array<{ area: WorkflowArea; pattern: RegExp }> = [
  { area: "project-loop", pattern: /\b(project loop|workflow loop|collaboration workflow|working preference|operating agreement|workflow|loop-engineering|review-gated loop|plan\/spec|roadmap)\b/iu },
  { area: "review-gate", pattern: /\b(review gate|code review|spec review|quality review|approval gate|approved? before|review\/?approve)\b/iu },
  { area: "pr-process", pattern: /\b(pr|pull request|feature branch|branch|merge|merged|worktree cleanup|delete local|delete remote)\b/iu },
  { area: "release-process", pattern: /\b(release|tag|version|publish|published|npm publish|github releases?)\b/iu },
  { area: "tooling-preference", pattern: /\b(package manager|installer|installation|onboarding|harness setup|setup wizard|pnpm|npm|bun|command preference|use sfw)\b/iu },
]

const OPERATING_AGREEMENT_PATTERN = /\b(workflow|loop|operating agreement|working preference|review gate|code review|spec review|quality review|approval gate|pr|pull request|branch|merge|worktree|release|tag|version|publish|package manager|installer|onboarding|harness setup|setup wizard|pnpm|use sfw|process)\b/iu

export function isWorkflowArea(value: string): value is WorkflowArea {
  return WORKFLOW_AREAS.includes(value as WorkflowArea)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! >= 0 ? value! : fallback
}

function visibleApproved(memory: MemoryRecord, projectScopeKey: string | undefined, all: boolean): boolean {
  if (memory.status !== "approved") return false
  if (all) return true
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memory.scope.key === projectScopeKey
}

function matchReason(memory: MemoryRecord): "explicit-kind" | "heuristic" | undefined {
  if (memory.kind === "workflow_rule") return "explicit-kind"
  if (!memory.kind || !AGREEMENT_COMPATIBLE_KINDS.has(memory.kind)) return undefined
  return OPERATING_AGREEMENT_PATTERN.test(memory.text) ? "heuristic" : undefined
}

function classifyWorkflowArea(text: string): WorkflowArea {
  for (const { area, pattern } of AREA_PATTERNS) {
    if (pattern.test(text)) return area
  }
  return "other"
}

function metadata(selection: OperatingAgreementSelection): OperatingAgreementMetadata {
  return {
    id: selection.memory.id,
    category: selection.memory.category,
    scope: selection.memory.scope,
    source: selection.memory.source,
    createdAt: selection.memory.createdAt,
    updatedAt: selection.memory.updatedAt,
    kind: selection.memory.kind,
    provenance: selection.memory.provenance,
    workflowArea: selection.workflowArea,
    matchReason: selection.matchReason,
    recommendedKind: selection.recommendedKind,
  }
}

function matchRank(selection: OperatingAgreementSelection): number {
  return selection.matchReason === "explicit-kind" ? 0 : 1
}

function scopeRank(selection: OperatingAgreementSelection): number {
  return selection.memory.scope.type === "project" ? 0 : 1
}

function compareSelections(a: OperatingAgreementSelection, b: OperatingAgreementSelection): number {
  return matchRank(a) - matchRank(b)
    || scopeRank(a) - scopeRank(b)
    || b.memory.updatedAt.localeCompare(a.memory.updatedAt)
    || a.memory.id.localeCompare(b.memory.id)
}

function notes(projectScopeKey: string | undefined, all: boolean, relatedTotal: number): string[] {
  const values: string[] = []
  if (!projectScopeKey && !all) {
    values.push("No project scope is active; operating agreement selection is limited to global memories. Pass --project <path> for project-aware agreements.")
  }
  if (relatedTotal > 0) {
    values.push("Related candidates are not superseded and no cleanup is performed. Future update/supersede commands can resolve overlap explicitly.")
  }
  return values
}

export function selectOperatingAgreements(memories: MemoryRecord[], options: OperatingAgreementOptions = {}): OperatingAgreementList {
  const limit = positiveInteger(options.limit, DEFAULT_LIMIT)
  const relatedLimit = positiveInteger(options.relatedLimit, DEFAULT_RELATED_LIMIT)
  const all = options.all ?? false

  const candidates = memories
    .filter((memory) => visibleApproved(memory, options.projectScopeKey, all))
    .map((memory): OperatingAgreementSelection | undefined => {
      const reason = matchReason(memory)
      if (!reason) return undefined
      const workflowArea = classifyWorkflowArea(memory.text)
      if (options.area && workflowArea !== options.area) return undefined
      return {
        memory,
        workflowArea,
        matchReason: reason,
        recommendedKind: reason === "heuristic" ? "workflow_rule" : undefined,
      }
    })
    .filter((selection): selection is OperatingAgreementSelection => Boolean(selection))
    .sort(compareSelections)

  const selectedAreas = new Set<WorkflowArea>()
  const primaryCandidates: OperatingAgreementSelection[] = []
  const relatedCandidates: OperatingAgreementSelection[] = []

  for (const candidate of candidates) {
    if (!selectedAreas.has(candidate.workflowArea) && primaryCandidates.length < limit) {
      primaryCandidates.push(candidate)
      selectedAreas.add(candidate.workflowArea)
    } else {
      relatedCandidates.push(candidate)
    }
  }

  const primary = primaryCandidates.slice(0, limit)
  const related = relatedCandidates.slice(0, relatedLimit)

  return {
    projectScope: options.projectScopeKey ?? "none",
    workflowAreas: [...new Set(primary.map((selection) => selection.workflowArea))],
    primary,
    relatedCandidates: related,
    omittedPrimaryCount: Math.max(0, primaryCandidates.length - primary.length),
    omittedRelatedCandidateCount: Math.max(0, relatedCandidates.length - related.length),
    notes: notes(options.projectScopeKey, all, relatedCandidates.length),
  }
}

export function summarizeOperatingAgreements(list: OperatingAgreementList) {
  return {
    projectScope: list.projectScope,
    primaryCount: list.primary.length,
    relatedCandidateCount: list.relatedCandidates.length,
    omittedPrimaryCount: list.omittedPrimaryCount,
    omittedRelatedCandidateCount: list.omittedRelatedCandidateCount,
    workflowAreas: list.workflowAreas,
    primary: list.primary.map(metadata),
    relatedCandidates: list.relatedCandidates.map(metadata),
    notes: list.notes,
  }
}
```

- [ ] **Step 5: Export the selector helpers**

In `packages/core/src/index.ts`, add:

```ts
export {
  WORKFLOW_AREAS,
  isWorkflowArea,
  selectOperatingAgreements,
  summarizeOperatingAgreements,
} from "./operating-agreements.js"
```

- [ ] **Step 6: Run core tests and fix compile errors only in the files named in this task**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: PASS for the new selector tests and existing core tests. If TypeScript complains that `summarizeOperatingAgreements` needs an explicit return type, add `: OperatingAgreementSummary` and import that type.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/operating-agreements.ts packages/core/src/index.ts packages/core/test/engine.test.ts
git commit -m "feat: select operating agreement memories"
```

---

### Task 2: Engine API and doctor/status summary

**Files:**
- Modify: `packages/core/src/engine.ts`
- Test: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Add failing engine tests**

Append these tests inside the existing `describe("MemoryEngine", () => { ... })` block in `packages/core/test/engine.test.ts` near the freshness/doctor tests:

```ts
  it("returns operating agreements through engine APIs", () => {
    const project = tempDir()
    fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "agreement-engine-project" }), "utf8")
    const e = engine()
    e.refreshScope(project)

    e.save({
      text: "Project workflow loop: write a spec, get approval, implement a slice.",
      status: "approved",
      category: "project",
      scopeType: "project",
      kind: "project_fact",
    })
    e.save({
      text: "User prefers concise answers.",
      status: "approved",
      category: "preference",
      scopeType: "global",
      kind: "preference",
    })

    const agreements = e.operatingAgreements()
    const summary = e.operatingAgreementSummary()

    assert.equal(agreements.projectScope, "agreement-engine-project")
    assert.equal(agreements.primary.length, 1)
    assert.equal(agreements.primary[0].memory.text, "Project workflow loop: write a spec, get approval, implement a slice.")
    assert.equal(summary.primaryCount, 1)
    assert.equal(summary.primary[0].id, agreements.primary[0].memory.id)
    assert.ok(!JSON.stringify(summary).includes("Project workflow loop: write a spec"))
  })

  it("includes text-free operating agreement summary in doctor", () => {
    const e = engine()
    e.save({
      text: "PRIVATE DOCTOR AGREEMENT TEXT Project workflow loop: review before implementation.",
      status: "approved",
      category: "project",
      scopeType: "global",
      kind: "workflow_rule",
    })

    const report = e.doctor()
    const serialized = JSON.stringify(report)
    const operatingAgreements = report.operatingAgreements as any

    assert.equal(operatingAgreements.primaryCount, 1)
    assert.equal(operatingAgreements.primary[0].matchReason, "explicit-kind")
    assert.doesNotMatch(serialized, /PRIVATE DOCTOR AGREEMENT TEXT/u)
  })
```

- [ ] **Step 2: Run core tests and verify missing methods**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: FAIL with missing `operatingAgreements` / `operatingAgreementSummary` methods.

- [ ] **Step 3: Add engine imports**

In `packages/core/src/engine.ts`, update imports:

```ts
import { buildFreshnessStatus } from "./freshness.js"
import { selectOperatingAgreements, summarizeOperatingAgreements } from "./operating-agreements.js"
```

Extend the type import list from `./types.js` to include:

```ts
  FreshnessStatus, OperatingAgreementList, OperatingAgreementOptions, OperatingAgreementSummary,
```

- [ ] **Step 4: Add engine methods before `freshnessStatus()`**

In `packages/core/src/engine.ts`, insert before `freshnessStatus(opts?: { since?: string }): FreshnessStatus {`:

```ts
  operatingAgreements(opts?: Omit<OperatingAgreementOptions, "projectScopeKey">): OperatingAgreementList {
    return selectOperatingAgreements(this.store.list(), {
      ...opts,
      projectScopeKey: this.scope?.key,
    })
  }

  operatingAgreementSummary(opts?: Omit<OperatingAgreementOptions, "projectScopeKey">): OperatingAgreementSummary {
    return summarizeOperatingAgreements(this.operatingAgreements(opts))
  }
```

- [ ] **Step 5: Include summary in doctor**

In the object returned by `doctor()`, add this property after `freshness`:

```ts
      operatingAgreements: this.operatingAgreementSummary(),
```

- [ ] **Step 6: Run core tests**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat: expose operating agreement summary"
```

---

### Task 3: CLI agreements command and formatters

**Files:**
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/src/index.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Append these tests to `packages/cli/test/cli.test.ts` near existing status/freshness CLI tests:

```ts
function agreementFixtureRecords(projectScope: string): MemoryRecord[] {
  return [
    {
      id: "project-loop-current",
      text: "Project workflow loop: spec, approval, slice implementation.",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: "2026-06-18T10:00:00.000Z",
      updatedAt: "2026-06-18T10:00:00.000Z",
    },
    {
      id: "project-loop-older",
      text: "Project workflow loop: older overlap.",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-18T09:00:00.000Z",
    },
    {
      id: "global-pr-process",
      text: "PR process: open a pull request and wait for user merge approval.",
      category: "preference",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: "2026-06-18T08:00:00.000Z",
      updatedAt: "2026-06-18T08:00:00.000Z",
    },
    {
      id: "generic-global-pref",
      text: "User prefers concise answers.",
      category: "preference",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "preference",
      createdAt: "2026-06-18T07:00:00.000Z",
      updatedAt: "2026-06-18T07:00:00.000Z",
    },
  ]
}

it("agreements --json returns primary and related agreement text", () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-agreements-project" }), "utf8")
  writeMemoryRecords(memFile, agreementFixtureRecords("cli-agreements-project"))
  const env = {
    MEMORY_LANE_FILE: memFile,
    MEMORY_LANE_EMBEDDINGS_FILE: embFile,
    MEMORY_LANE_CONFIG: cfgFile,
  }

  const payload = JSON.parse(run(["agreements", "--json", "--project", project], env))

  assert.equal(payload.ok, true)
  assert.equal(payload.data.projectScope, "cli-agreements-project")
  assert.deepEqual(payload.data.primary.map((item: any) => item.memory.id), ["global-pr-process", "project-loop-current"])
  assert.deepEqual(payload.data.relatedCandidates.map((item: any) => item.memory.id), ["project-loop-older"])
  assert.match(JSON.stringify(payload.data), /Project workflow loop: spec/u)
  assert.match(JSON.stringify(payload.data), /PR process: open a pull request/u)
  assert.doesNotMatch(JSON.stringify(payload.data), /User prefers concise answers/u)
  assert.equal(payload.data.primary.find((item: any) => item.memory.id === "project-loop-current").recommendedKind, "workflow_rule")
})

it("agreements supports area filters and related limits", () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-area-project" }), "utf8")
  writeMemoryRecords(memFile, agreementFixtureRecords("cli-area-project"))
  const env = {
    MEMORY_LANE_FILE: memFile,
    MEMORY_LANE_EMBEDDINGS_FILE: embFile,
    MEMORY_LANE_CONFIG: cfgFile,
  }

  const payload = JSON.parse(run(["agreements", "--json", "--project", project, "--area", "project-loop", "--related-limit", "0"], env))

  assert.equal(payload.ok, true)
  assert.deepEqual(payload.data.primary.map((item: any) => item.memory.id), ["project-loop-current"])
  assert.deepEqual(payload.data.relatedCandidates, [])
  assert.equal(payload.data.omittedRelatedCandidateCount, 1)
})

it("agreements human output includes primary text and overlap note", () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-human-project" }), "utf8")
  writeMemoryRecords(memFile, agreementFixtureRecords("cli-human-project"))
  const env = {
    MEMORY_LANE_FILE: memFile,
    MEMORY_LANE_EMBEDDINGS_FILE: embFile,
    MEMORY_LANE_CONFIG: cfgFile,
  }

  const output = run(["agreements", "--project", project], env)

  assert.match(output, /Operating agreements/u)
  assert.match(output, /project-loop/u)
  assert.match(output, /Project workflow loop: spec/u)
  assert.match(output, /Related candidates/u)
  assert.match(output, /not superseded/u)
})

it("agreements rejects invalid area and invalid limits", () => {
  const env = {
    MEMORY_LANE_FILE: memFile,
    MEMORY_LANE_EMBEDDINGS_FILE: embFile,
    MEMORY_LANE_CONFIG: cfgFile,
  }

  const badArea = runProcess(["agreements", "--area", "invalid-area"], { env })
  const badLimit = runProcess(["agreements", "--limit", "-1"], { env })

  assert.notEqual(badArea.status, 0)
  assert.match(badArea.stdout + badArea.stderr, /Invalid workflow area/u)
  assert.notEqual(badLimit.status, 0)
  assert.match(badLimit.stdout + badLimit.stderr, /Invalid --limit/u)
})

it("status and doctor expose operating agreement metadata without text", () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-status-agreements" }), "utf8")
  writeMemoryRecords(memFile, [
    {
      id: "private-agreement",
      text: "PRIVATE CLI STATUS AGREEMENT TEXT Project workflow loop: review first.",
      category: "project",
      scope: { type: "project", key: "cli-status-agreements" },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: "2026-06-18T10:00:00.000Z",
      updatedAt: "2026-06-18T10:00:00.000Z",
    },
  ])
  const env = {
    MEMORY_LANE_FILE: memFile,
    MEMORY_LANE_EMBEDDINGS_FILE: embFile,
    MEMORY_LANE_CONFIG: cfgFile,
  }

  const statusPayload = JSON.parse(run(["status", "--json", "--project", project], env))
  const doctorPayload = JSON.parse(run(["doctor", "--json", "--project", project], env))
  const humanDoctor = run(["doctor", "--project", project], env)

  assert.equal(statusPayload.data.operatingAgreements.primaryCount, 1)
  assert.equal(doctorPayload.data.operatingAgreements.primary[0].id, "private-agreement")
  assert.doesNotMatch(JSON.stringify(statusPayload), /PRIVATE CLI STATUS AGREEMENT TEXT/u)
  assert.doesNotMatch(JSON.stringify(doctorPayload), /PRIVATE CLI STATUS AGREEMENT TEXT/u)
  assert.match(humanDoctor, /Operating agreements/u)
  assert.doesNotMatch(humanDoctor, /PRIVATE CLI STATUS AGREEMENT TEXT/u)
})
```

- [ ] **Step 2: Run CLI tests and verify missing command/formatter failures**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: FAIL because `agreements` is unknown or formatter support is missing.

- [ ] **Step 3: Add formatter imports and `formatOperatingAgreements()`**

In `packages/cli/src/formatters.ts`, update the core import to include:

```ts
  type OperatingAgreementList, type OperatingAgreementSummary,
```

Add this helper near `formatFreshnessSummary()`:

```ts
function isOperatingAgreementSummary(value: unknown): value is OperatingAgreementSummary {
  return typeof value === "object" && value !== null
    && typeof (value as OperatingAgreementSummary).primaryCount === "number"
    && typeof (value as OperatingAgreementSummary).relatedCandidateCount === "number"
    && Array.isArray((value as OperatingAgreementSummary).workflowAreas)
}

function formatOperatingAgreementSummary(value: unknown): string | undefined {
  if (!isOperatingAgreementSummary(value)) return undefined
  const areas = value.workflowAreas.length ? value.workflowAreas.join(", ") : "none"
  return `Operating agreements: ${value.primaryCount} primary, ${value.relatedCandidateCount} related candidates (areas: ${areas}). Use memory-lane agreements to inspect agreement text.`
}

export function formatOperatingAgreements(result: OperatingAgreementList, json: boolean): string {
  if (json) {
    return JSON.stringify({ ok: true, data: result, meta: meta({ count: result.primary.length, relatedCount: result.relatedCandidates.length }) }, null, 2)
  }

  const lines = [
    "Operating agreements",
    `Project scope: ${result.projectScope}`,
  ]

  if (!result.primary.length) {
    lines.push("No operating agreements found.")
  } else {
    lines.push("", "Primary:")
    for (const item of result.primary) {
      const kind = item.memory.kind ?? "misc"
      const recommended = item.recommendedKind ? `; recommended kind: ${item.recommendedKind}` : ""
      lines.push(
        `- [${item.memory.id}] ${item.workflowArea} · ${item.memory.scope.type}/${item.memory.category}/${kind} · ${item.matchReason}${recommended}`,
        `  ${item.memory.text}`,
      )
    }
  }

  lines.push("", `Related candidates: ${result.relatedCandidates.length}${result.omittedRelatedCandidateCount ? ` (${result.omittedRelatedCandidateCount} omitted)` : ""}`)
  for (const item of result.relatedCandidates) {
    const kind = item.memory.kind ?? "misc"
    const recommended = item.recommendedKind ? `; recommended kind: ${item.recommendedKind}` : ""
    lines.push(`- [${item.memory.id}] ${item.workflowArea} · ${item.memory.scope.type}/${item.memory.category}/${kind} · ${item.matchReason}${recommended}`)
  }

  if (result.notes.length) {
    lines.push("", "Notes:", ...result.notes.map((note) => `- ${note}`))
  }

  return lines.join("\n")
}
```

Then update `formatDoctor()` so the `detailLines` mapping handles operating agreements before generic object rendering:

```ts
      if (k === "freshness") return formatFreshnessSummary(v) ?? "freshness: unavailable"
      if (k === "operatingAgreements") return formatOperatingAgreementSummary(v) ?? "operatingAgreements: unavailable"
```

- [ ] **Step 4: Add CLI handler parsing**

In `packages/cli/src/index.ts`, update formatter imports to include:

```ts
  formatCompact, formatDashboard, formatDoctor, formatFreshnessSummary, formatImportPlan, formatOperatingAgreements, formatError, usage,
```

Update the core import to include `isWorkflowArea`:

```ts
import { MemoryEngine, readRawConfig, writeConfig, getDefaultConfigPath, DEFAULT_CONFIG, loadConfig, createOpenAIEmbeddingProvider, initProjectLocalStorage, isMetaTaskPromptText, resolveWritableMemoryPaths, isWorkflowArea, type MemoryPaths } from "@memory-lane/core"
```

Add these helpers near other arg helpers:

```ts
function optionalWorkflowArea(argv: string[]): import("@memory-lane/core").WorkflowArea | undefined {
  const value = flag(argv, "area")
  if (!value) return undefined
  if (value === "true" || !isWorkflowArea(value)) {
    throw new Error(`Invalid workflow area: ${value}. Expected one of: project-loop, review-gate, pr-process, release-process, tooling-preference, other`)
  }
  return value
}

function optionalNonNegativeInteger(argv: string[], name: string): number | undefined {
  const value = flag(argv, name)
  if (!value) return undefined
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Invalid --${name}: ${value}. Expected a non-negative integer.`)
  }
  return parsed
}
```

Add this handler near `handleDashboard()`:

```ts
function handleAgreements(ctx: CliContext): void {
  const result = ctx.engine.operatingAgreements({
    all: hasFlag(ctx.argv, "all"),
    area: optionalWorkflowArea(ctx.argv),
    limit: optionalNonNegativeInteger(ctx.argv, "limit"),
    relatedLimit: optionalNonNegativeInteger(ctx.argv, "related-limit"),
  })
  console.log(formatOperatingAgreements(result, ctx.json))
}
```

Add the command to `commandHandlers`:

```ts
  agreements: handleAgreements,
```

- [ ] **Step 5: Update usage text**

In `packages/cli/src/formatters.ts`, add this command after `dashboard` in `usage()`:

```text
  agreements [--area <area>] [--limit <n>] [--related-limit <n>] [--all]
                  Show approved operating agreements for the current project and global scope
```

Update the flags block so `--all` mentions both list and agreements:

```text
  --all            (list, agreements) Show all memories, bypassing project scope
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add packages/cli/src/index.ts packages/cli/src/formatters.ts packages/cli/test/cli.test.ts
git commit -m "feat: add agreements cli command"
```

---

### Task 4: MCP status coverage

**Files:**
- Modify: `packages/mcp-server/test/handlers.test.ts`
- Source change only if tests prove `engine.doctor()` summary is not passed through.

- [ ] **Step 1: Add failing MCP status tests**

Append these tests near existing `memory_status` tests in `packages/mcp-server/test/handlers.test.ts`:

```ts
test("memory_status includes text-free operating agreement summary", async () => {
  const engine = engineInTemp(tempDir())
  engine.save({
    text: "PRIVATE MCP AGREEMENT TEXT Project workflow loop: spec before implementation.",
    status: "approved",
    category: "project",
    scopeType: "project",
    kind: "project_fact",
  })
  engine.save({
    text: "User prefers concise answers.",
    status: "approved",
    category: "preference",
    scopeType: "global",
    kind: "preference",
  })

  const result = parseToolResult(await handleMemoryStatus(engine, {}))
  const serialized = JSON.stringify(result)
  const summary = result.data.status.operatingAgreements

  assert.equal(result.ok, true)
  assert.equal(summary.primaryCount, 1)
  assert.equal(summary.primary[0].workflowArea, "project-loop")
  assert.equal(summary.primary[0].recommendedKind, "workflow_rule")
  assert.doesNotMatch(serialized, /PRIVATE MCP AGREEMENT TEXT/u)
  assert.doesNotMatch(serialized, /User prefers concise answers/u)
})

test("memory_status applies projectPath before computing operating agreements", async () => {
  const projectA = tempDir()
  const projectB = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "agreement-status-a" }))
  fs.writeFileSync(path.join(projectB, ".memory-lane-scope"), JSON.stringify({ id: "agreement-status-b" }))

  const engine = engineInTemp(projectA)
  engine.save({ text: "Project workflow loop for A.", status: "approved", category: "project", scopeType: "project", kind: "project_fact" })
  engine.refreshScope(projectB)
  engine.save({ text: "Project workflow loop for B.", status: "approved", category: "project", scopeType: "project", kind: "project_fact" })

  const result = parseToolResult(await handleMemoryStatus(engine, { projectPath: projectA }))
  const summary = result.data.status.operatingAgreements

  assert.equal(result.ok, true)
  assert.equal(result.data.status.projectScope, "agreement-status-a")
  assert.equal(summary.projectScope, "agreement-status-a")
  assert.equal(summary.primaryCount, 1)
  assert.equal(summary.primary[0].scope.key, "agreement-status-a")
})
```

- [ ] **Step 2: Run MCP tests**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected: PASS if Task 2 doctor integration is sufficient. If it fails because the status envelope strips fields, update only `packages/mcp-server/src/handlers.ts` to preserve `engine.doctor()` as it currently does for freshness.

- [ ] **Step 3: Commit Task 4**

Run:

```bash
git add packages/mcp-server/test/handlers.test.ts packages/mcp-server/src/handlers.ts
git commit -m "test: cover operating agreements in mcp status"
```

If `packages/mcp-server/src/handlers.ts` did not change, omit it from `git add` or allow Git to ignore the unchanged path.

---

### Task 5: Documentation, roadmap, and handoff

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update README command documentation**

Find the CLI command list or usage section in `README.md`. Add a concise entry:

```md
### Operating agreements

Use `memory-lane agreements` to explicitly inspect approved workflow/process memories that should guide the current project. By default it considers the current project plus global scope, returns selected agreement text, and reports related overlap without changing memories.

```bash
memory-lane agreements
memory-lane agreements --json
memory-lane agreements --area project-loop
memory-lane agreements --all
```

`memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` include text-free operating agreement metadata so clients can notice that agreements exist without injecting the agreement bodies.
```

- [ ] **Step 2: Update the Memory Lane skill**

In `skills/memory-lane/SKILL.md`, add guidance near recall/review/status instructions:

```md
## Operating agreements

When you need the current project workflow, review gates, PR process, release process, or tooling workflow rules, prefer the explicit command:

```bash
memory-lane agreements
memory-lane agreements --area project-loop
```

The command returns approved operating agreement text for the current project plus global scope. `memory-lane status --json` and MCP `memory_status` only expose text-free agreement metadata.
```

- [ ] **Step 3: Update ROADMAP Phase 16**

In `ROADMAP.md`, update Phase 16 status so it says Slice 2 is complete after implementation. Replace the extension slice line for Slice 2 with wording like:

```md
2. **Complete — canonical workflow / operating-agreement memories:** added a read-only operating agreement convention, selector, CLI `memory-lane agreements`, and text-free status/doctor/MCP status metadata for current project/global workflow contracts. Revision/supersede operations remain a later slice.
```

Keep Slice 3 as the next incomplete item.

- [ ] **Step 4: Update HANDOFF recent changes**

At the top of `HANDOFF.md` recent changes, add:

```md
- Phase 16 Slice 2 operating agreement discovery is implemented: approved workflow-like memories can now be selected as primary/related operating agreements by workflow area, `memory-lane agreements` explicitly returns selected agreement text, and status/doctor/MCP status expose text-free agreement metadata. No lifecycle injection, automatic cleanup, revision fields, or MCP full-text agreement tool were added. Next recommended Phase 16 slice: update/replace/supersede primitives.
```

- [ ] **Step 5: Run docs-friendly checks**

Run:

```bash
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add README.md skills/memory-lane/SKILL.md ROADMAP.md HANDOFF.md
git commit -m "docs: document operating agreements"
```

---

### Task 6: Whole-slice verification and PR preparation

**Files:**
- No source files required unless verification reveals a defect.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
```

Expected: all pass.

- [ ] **Step 2: Run full tests and build**

Run:

```bash
pnpm test
pnpm build
git diff --check
```

Expected: all pass and no whitespace errors.

- [ ] **Step 3: Manually inspect the new command against local approved memories**

Run:

```bash
memory-lane agreements --json | jq '{projectScope:.data.projectScope, primary:[.data.primary[]? | {id:.memory.id, area:.workflowArea, reason:.matchReason, recommendedKind:.recommendedKind}], relatedCount:(.data.relatedCandidates | length), notes:.data.notes}'
memory-lane status --json | jq '{operatingAgreements:.data.operatingAgreements}'
```

Expected:

- `agreements --json` includes the current loop operating agreements as primary or related candidates.
- `status --json` includes `operatingAgreements` metadata.
- The status output does not include full memory text.

- [ ] **Step 4: Review scope boundaries**

Run:

```bash
git diff --stat main...HEAD
git diff --name-only main...HEAD
rg -n "SessionStart|UserPromptSubmit|session-start|user-prompt-submit|memory_agreements|supersedes|supersededBy|revisionOf|canonical" packages docs README.md skills/memory-lane/SKILL.md
```

Expected:

- Changed files match this plan.
- No lifecycle adapter changes unless only documentation mentions the out-of-scope terms.
- No `memory_agreements` MCP tool.
- No new revision/canonical schema fields.

- [ ] **Step 5: Open PR and wait**

Open a PR from the feature branch with a summary containing:

- core selector/helper and engine summary
- CLI `agreements` command
- status/doctor/MCP status text-free metadata
- docs updates
- verification commands and outcomes

Do not merge locally. Wait for user review/merge. After the user says the PR is merged, sync `main`, delete local/remote feature branches, save a compact checkpoint memory if explicitly requested, recommend Phase 16 Slice 3, and stop until the user approves the next slice.
