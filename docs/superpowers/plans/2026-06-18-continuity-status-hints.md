# Continuity Status Hints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add read-only, text-free continuity hints for superseded-visible memories, operating-agreement overlaps, project/global preference overlaps, and newer approved state.

**Architecture:** Implement hint rules once in `@memory-lane/core`, expose them through `MemoryEngine`, then render the same text-free summary in CLI dashboard/status/doctor and MCP `memory_status`. Keep all hints advisory and inspection-oriented; do not mutate memories or change recall behavior.

**Tech Stack:** TypeScript, Node test runner, pnpm workspaces, existing CLI formatter patterns, existing MCP handler envelope patterns.

---

## Acceptance Criteria

- Core exposes a shared `buildContinuityHints(memories, options)` helper and `MemoryEngine.continuityHints(opts?)` method.
- Hints include ids/metadata only, never memory text/previews/transcripts/tool outputs.
- Detected hint types:
  - `superseded-visible`
  - `operating-agreement-overlap`
  - `project-global-overlap`
  - `newer-approved`
- `memory-lane dashboard --json`, `memory-lane status --json`, and `memory-lane doctor --json` include `continuityHints`.
- Human `memory-lane dashboard` includes compact continuity counts/actions without memory text.
- MCP `memory_status` includes the same text-free `continuityHints` through `engine.doctor()`.
- No lifecycle injection changes, retrieval filtering changes, new memory fields, workstream ids, MCP mutation tools, automatic cleanup, or mutation command suggestions.
- Tests pass: focused core, CLI, MCP, full build/test before PR.

## File Map

Create:
- `packages/core/src/continuity-hints.ts` — shared read-only hint detection logic.
- `packages/core/test/continuity-hints.test.ts` — unit tests for hint detection and text-free output.

Modify:
- `packages/core/src/types.ts` — continuity hint type definitions.
- `packages/core/src/index.ts` — export helper/types.
- `packages/core/src/engine.ts` — expose `continuityHints()` and include it in `doctor()`.
- `packages/core/test/engine.test.ts` — engine/doctor integration tests.
- `packages/cli/src/formatters.ts` — dashboard summary/output and doctor human formatting.
- `packages/cli/test/cli.test.ts` — dashboard/status/doctor JSON and dashboard human tests.
- `packages/mcp-server/test/handlers.test.ts` — MCP `memory_status` continuity hints tests.
- `README.md` — document continuity hints.
- `skills/memory-lane/SKILL.md` — add usage guidance.
- `ROADMAP.md` — mark Slice 4 complete after implementation.
- `HANDOFF.md` — record completion and next recommended Slice 5.

Do not modify:
- lifecycle adapters or `@memory-lane/lifecycle`.
- recall/retrieval/scoring behavior.
- MCP tool definitions except tests that observe `memory_status` output.
- storage schema beyond type additions for returned summaries.

---

## Task 1: Core continuity hint helper

**Files:**
- Create: `packages/core/src/continuity-hints.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/continuity-hints.test.ts`

- [ ] **Step 1: Add failing core tests**

Create `packages/core/test/continuity-hints.test.ts` with these tests:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { buildContinuityHints, type MemoryRecord } from "../src/index.js"

function memory(overrides: Partial<MemoryRecord> & { id: string; text?: string }): MemoryRecord {
  return {
    id: overrides.id,
    text: overrides.text ?? `PRIVATE TEXT ${overrides.id}`,
    category: overrides.category ?? "project",
    scope: overrides.scope ?? { type: "project", key: "project-a" },
    status: overrides.status ?? "approved",
    source: overrides.source ?? "manual",
    kind: overrides.kind ?? "project_fact",
    createdAt: overrides.createdAt ?? "2026-06-18T08:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-18T08:00:00.000Z",
    provenance: overrides.provenance,
    revision: overrides.revision,
    project: overrides.project,
  }
}

function json(value: unknown): string {
  return JSON.stringify(value)
}

test("continuity hints report superseded approved visible memories without text", () => {
  const result = buildContinuityHints([
    memory({ id: "old-loop", text: "SECRET OLD LOOP TEXT", revision: { supersededBy: "new-loop", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
    memory({ id: "new-loop", text: "SECRET NEW LOOP TEXT", kind: "workflow_rule" }),
    memory({ id: "pending-old", status: "pending", revision: { supersededBy: "new-loop", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.projectScope, "project-a")
  assert.equal(result.supersededVisible.length, 1)
  assert.equal(result.supersededVisible[0].id, "old-loop")
  assert.equal(result.supersededVisible[0].supersededBy, "new-loop")
  assert.ok(result.hints.some((hint) => hint.code === "superseded-visible"))
  assert.match(result.suggestedActions.join("\n"), /memory-lane list --json/u)
  assert.doesNotMatch(json(result), /SECRET OLD LOOP TEXT|SECRET NEW LOOP TEXT/u)
})

test("continuity hints report operating agreement overlap by workflow area", () => {
  const result = buildContinuityHints([
    memory({ id: "project-loop-current", text: "Project workflow loop: spec approval then implementation", kind: "workflow_rule", updatedAt: "2026-06-18T10:00:00.000Z" }),
    memory({ id: "project-loop-related", text: "Project workflow loop: older spec approval process", kind: "project_fact", updatedAt: "2026-06-18T09:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.operatingAgreementOverlaps, [{
    workflowArea: "project-loop",
    primaryIds: ["project-loop-current"],
    relatedIds: ["project-loop-related"],
  }])
  assert.ok(result.hints.some((hint) => hint.code === "operating-agreement-overlap" && hint.workflowArea === "project-loop"))
  assert.match(result.suggestedActions.join("\n"), /memory-lane agreements --area project-loop/u)
})

test("continuity hints report project global preference overlap", () => {
  const result = buildContinuityHints([
    memory({ id: "project-pr", text: "PR process: open a pull request and wait for merge", kind: "workflow_rule", category: "project", scope: { type: "project", key: "project-a" } }),
    memory({ id: "global-pr", text: "PR process: use feature branch and pull request", kind: "workflow_rule", category: "preference", scope: { type: "global" } }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.projectGlobalPreferenceOverlaps, [{
    workflowArea: "pr-process",
    projectIds: ["project-pr"],
    globalIds: ["global-pr"],
  }])
  assert.ok(result.hints.some((hint) => hint.code === "project-global-overlap" && hint.workflowArea === "pr-process"))
  assert.match(result.suggestedActions.join("\n"), /memory-lane agreements --all/u)
})

test("continuity hints include newer approved metadata when since is provided", () => {
  const result = buildContinuityHints([
    memory({ id: "newer-project", updatedAt: "2026-06-18T10:00:00.000Z", provenance: { adapter: "pi", lifecycleEvent: "session_end" } }),
    memory({ id: "old-project", updatedAt: "2026-06-17T10:00:00.000Z" }),
  ], { projectScopeKey: "project-a", since: "2026-06-18T09:00:00.000Z" })

  assert.deepEqual(result.newerApproved, {
    referenceTime: "2026-06-18T09:00:00.000Z",
    count: 1,
    newestIds: ["newer-project"],
  })
  assert.ok(result.hints.some((hint) => hint.code === "newer-approved"))
  assert.match(result.suggestedActions.join("\n"), /memory-lane status --json --since 2026-06-18T09:00:00.000Z/u)
})

test("continuity hints respect project scope plus global visibility", () => {
  const result = buildContinuityHints([
    memory({ id: "visible-old", revision: { supersededBy: "new", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
    memory({ id: "other-project-old", scope: { type: "project", key: "project-b" }, revision: { supersededBy: "new", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
    memory({ id: "global-old", scope: { type: "global" }, revision: { supersededBy: "new", revisedAt: "2026-06-18T09:00:00.000Z", revisedBy: "cli" } }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.supersededVisible.map((item) => item.id), ["visible-old", "global-old"])
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/continuity-hints.test.ts
```

Expected: FAIL because `continuity-hints.ts` and exported types/functions do not exist.

- [ ] **Step 3: Add continuity hint types**

Modify `packages/core/src/types.ts` after `FreshnessStatusOptions`:

```ts
export type ContinuityHintCode =
  | "superseded-visible"
  | "operating-agreement-overlap"
  | "project-global-overlap"
  | "newer-approved"

export interface ContinuityHintMemoryMetadata {
  id: string
  status: Extract<MemoryStatus, "approved">
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  supersededBy?: string
}

export interface ContinuityHint {
  code: ContinuityHintCode
  severity: "info" | "review"
  message: string
  count: number
  memoryIds: string[]
  workflowArea?: WorkflowArea
  suggestedActions: string[]
}

export interface ContinuityHintSummary {
  projectScope: string | "none"
  hintCount: number
  hints: ContinuityHint[]
  supersededVisible: ContinuityHintMemoryMetadata[]
  operatingAgreementOverlaps: Array<{
    workflowArea: WorkflowArea
    primaryIds: string[]
    relatedIds: string[]
  }>
  projectGlobalPreferenceOverlaps: Array<{
    workflowArea: WorkflowArea
    projectIds: string[]
    globalIds: string[]
  }>
  newerApproved?: {
    referenceTime: string
    count: number
    newestIds: string[]
  }
  suggestedActions: string[]
  notes: string[]
}

export interface ContinuityHintOptions {
  projectScopeKey?: string
  since?: string
  maxIds?: number
}
```

- [ ] **Step 4: Implement helper**

Create `packages/core/src/continuity-hints.ts`:

```ts
import { buildFreshnessStatus } from "./freshness.js"
import { selectOperatingAgreements } from "./operating-agreements.js"
import type {
  ContinuityHint,
  ContinuityHintMemoryMetadata,
  ContinuityHintOptions,
  ContinuityHintSummary,
  MemoryRecord,
  OperatingAgreementSelection,
  WorkflowArea,
} from "./types.js"

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function visibleApproved(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.status !== "approved") return false
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memory.scope.key === projectScopeKey
}

function memoryMetadata(memory: MemoryRecord): ContinuityHintMemoryMetadata {
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
    supersededBy: memory.revision?.supersededBy,
  }
}

function action(values: string[]): string[] {
  return unique(values)
}

function selectionsByArea(selections: OperatingAgreementSelection[]): Map<WorkflowArea, OperatingAgreementSelection[]> {
  const map = new Map<WorkflowArea, OperatingAgreementSelection[]>()
  for (const selection of selections) {
    const existing = map.get(selection.workflowArea) ?? []
    existing.push(selection)
    map.set(selection.workflowArea, existing)
  }
  return map
}

function ids(selections: OperatingAgreementSelection[]): string[] {
  return selections.map((selection) => selection.memory.id)
}

export function buildContinuityHints(memories: MemoryRecord[], options: ContinuityHintOptions = {}): ContinuityHintSummary {
  const maxIds = options.maxIds ?? 5
  const projectScope = options.projectScopeKey ?? "none"
  const visible = memories.filter((memory) => visibleApproved(memory, options.projectScopeKey))
  const hints: ContinuityHint[] = []

  const supersededVisible = visible
    .filter((memory) => Boolean(memory.revision?.supersededBy))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))
    .slice(0, maxIds)
    .map(memoryMetadata)

  if (supersededVisible.length) {
    hints.push({
      code: "superseded-visible",
      severity: "review",
      message: `${supersededVisible.length} approved ${supersededVisible.length === 1 ? "memory is" : "memories are"} marked superseded and still visible as historical records.`,
      count: supersededVisible.length,
      memoryIds: supersededVisible.map((memory) => memory.id),
      suggestedActions: ["memory-lane list --json"],
    })
  }

  const agreements = selectOperatingAgreements(memories, { projectScopeKey: options.projectScopeKey })
  const mergedOperatingAgreementOverlaps = [...selectionsByArea(agreements.relatedCandidates).entries()]
    .map(([workflowArea, related]) => {
      const primary = agreements.primary.filter((item) => item.workflowArea === workflowArea)
      return {
        workflowArea,
        primaryIds: ids(primary),
        relatedIds: ids(related),
      }
    })
    .filter((overlap) => overlap.primaryIds.length > 0)

  for (const overlap of mergedOperatingAgreementOverlaps) {
    hints.push({
      code: "operating-agreement-overlap",
      severity: "review",
      message: `Multiple operating agreement candidates found for ${overlap.workflowArea}.`,
      count: overlap.primaryIds.length + overlap.relatedIds.length,
      memoryIds: [...overlap.primaryIds, ...overlap.relatedIds].slice(0, maxIds),
      workflowArea: overlap.workflowArea,
      suggestedActions: [`memory-lane agreements --area ${overlap.workflowArea} --json`],
    })
  }

  const allAgreementCandidates = [...agreements.primary, ...agreements.relatedCandidates]
  const projectGlobalPreferenceOverlaps = [...selectionsByArea(allAgreementCandidates).entries()]
    .map(([workflowArea, selections]) => {
      const projectIds = selections
        .filter((selection) => selection.memory.scope.type === "project")
        .map((selection) => selection.memory.id)
      const globalIds = selections
        .filter((selection) => selection.memory.scope.type === "global" && selection.memory.category === "preference")
        .map((selection) => selection.memory.id)
      return { workflowArea, projectIds, globalIds }
    })
    .filter((overlap) => overlap.projectIds.length > 0 && overlap.globalIds.length > 0)

  for (const overlap of projectGlobalPreferenceOverlaps) {
    hints.push({
      code: "project-global-overlap",
      severity: "info",
      message: `Project and global preference guidance both exist for ${overlap.workflowArea}.`,
      count: overlap.projectIds.length + overlap.globalIds.length,
      memoryIds: [...overlap.projectIds, ...overlap.globalIds].slice(0, maxIds),
      workflowArea: overlap.workflowArea,
      suggestedActions: ["memory-lane agreements --all"],
    })
  }

  const freshness = options.since
    ? buildFreshnessStatus(memories, { projectScopeKey: options.projectScopeKey, since: options.since, maxNewerMetadata: maxIds })
    : undefined
  const newerApproved = freshness && freshness.newerApprovedCount > 0
    ? {
      referenceTime: freshness.referenceTime!,
      count: freshness.newerApprovedCount,
      newestIds: freshness.newestNewerApproved.map((memory) => memory.id),
    }
    : undefined

  if (newerApproved) {
    hints.push({
      code: "newer-approved",
      severity: "info",
      message: `${newerApproved.count} approved ${newerApproved.count === 1 ? "memory has" : "memories have"} changed since ${newerApproved.referenceTime}.`,
      count: newerApproved.count,
      memoryIds: newerApproved.newestIds,
      suggestedActions: [`memory-lane status --json --since ${newerApproved.referenceTime}`],
    })
  }

  const suggestedActions = action(hints.flatMap((hint) => hint.suggestedActions))
  const notes = hints.length
    ? ["Continuity hints are read-only inspection signals; no memory cleanup or mutation is performed."]
    : []

  return {
    projectScope,
    hintCount: hints.length,
    hints,
    supersededVisible,
    operatingAgreementOverlaps: mergedOperatingAgreementOverlaps,
    projectGlobalPreferenceOverlaps,
    newerApproved,
    suggestedActions,
    notes,
  }
}
```

- [ ] **Step 5: Export helper**

Modify `packages/core/src/index.ts`:

```ts
export * from "./continuity-hints.js"
```

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/continuity-hints.test.ts
pnpm --filter @memory-lane/core build
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add packages/core/src/types.ts packages/core/src/continuity-hints.ts packages/core/src/index.ts packages/core/test/continuity-hints.test.ts
git commit -m "feat(core): add continuity hint summary"
```

---

## Task 2: Engine doctor integration

**Files:**
- Modify: `packages/core/src/engine.ts`
- Test: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Add failing engine tests**

Add tests near existing freshness/doctor tests in `packages/core/test/engine.test.ts`:

```ts
it("continuityHints reports text-free project scoped hints", () => {
  const { e } = engine()
  const old = e.save({ text: "PRIVATE OLD WORKFLOW TEXT", status: "approved", category: "project", kind: "workflow_rule" })
  const newer = e.save({ text: "PRIVATE NEW WORKFLOW TEXT", status: "approved", category: "project", kind: "workflow_rule" })
  assert.equal(old.status, "saved")
  assert.equal(newer.status, "saved")
  e.supersede(newer.memory.id, [old.memory.id], { reason: "newer guidance", revisedBy: "manual" })

  const hints = e.continuityHints()

  assert.equal(hints.supersededVisible.length, 1)
  assert.equal(hints.supersededVisible[0].id, old.memory.id)
  assert.equal(hints.supersededVisible[0].supersededBy, newer.memory.id)
  assert.doesNotMatch(JSON.stringify(hints), /PRIVATE OLD WORKFLOW TEXT|PRIVATE NEW WORKFLOW TEXT/u)
})

it("doctor includes text-free continuity hints and accepts freshnessSince", () => {
  const { e } = engine()
  const saved = e.save({
    text: "PRIVATE NEW CHECKPOINT TEXT",
    status: "approved",
    category: "project",
    kind: "project_checkpoint",
  })
  assert.equal(saved.status, "saved")

  const report = e.doctor({ freshnessSince: "2000-01-01T00:00:00.000Z" }) as any

  assert.equal(typeof report.continuityHints.hintCount, "number")
  assert.equal(report.continuityHints.newerApproved.count >= 1, true)
  assert.doesNotMatch(JSON.stringify(report.continuityHints), /PRIVATE NEW CHECKPOINT TEXT/u)
})
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/engine.test.ts
```

Expected: FAIL because `MemoryEngine.continuityHints` is not implemented and `doctor()` has no `continuityHints` field.

- [ ] **Step 3: Implement engine method and doctor field**

Modify imports in `packages/core/src/engine.ts`:

```ts
import { buildContinuityHints } from "./continuity-hints.js"
import type { ContinuityHintSummary } from "./types.js"
```

Add method near `freshnessStatus`:

```ts
  continuityHints(opts?: { since?: string }): ContinuityHintSummary {
    return buildContinuityHints(this.store.list(), {
      projectScopeKey: this.scope?.key,
      since: opts?.since,
    })
  }
```

Modify `doctor()` return object after `freshness`:

```ts
      freshness: this.freshnessStatus({ since: opts?.freshnessSince }),
      continuityHints: this.continuityHints({ since: opts?.freshnessSince }),
      operatingAgreements: this.operatingAgreementSummary(),
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/engine.test.ts
pnpm --filter @memory-lane/core test
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add packages/core/src/engine.ts packages/core/test/engine.test.ts
git commit -m "feat(core): expose continuity hints in doctor"
```

---

## Task 3: CLI dashboard/status/doctor surfaces

**Files:**
- Modify: `packages/cli/src/formatters.ts`
- Test: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Add failing CLI tests**

Add fixture helper near existing `agreementFixtureRecords()` in `packages/cli/test/cli.test.ts`:

```ts
function continuityFixtureRecords(projectScope: string): MemoryRecord[] {
  return [
    {
      id: "current-loop",
      text: "PRIVATE CURRENT LOOP TEXT Project workflow loop: spec approval then implementation.",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: "2026-06-18T10:00:00.000Z",
      updatedAt: "2026-06-18T10:00:00.000Z",
      revision: { supersedes: ["old-loop"], revisedAt: "2026-06-18T10:00:00.000Z", revisedBy: "cli" },
    },
    {
      id: "old-loop",
      text: "PRIVATE OLD LOOP TEXT Project workflow loop: older duplicate.",
      category: "project",
      scope: { type: "project", key: projectScope },
      status: "approved",
      source: "manual",
      kind: "project_fact",
      createdAt: "2026-06-18T09:00:00.000Z",
      updatedAt: "2026-06-18T09:00:00.000Z",
      revision: { supersededBy: "current-loop", revisedAt: "2026-06-18T10:00:00.000Z", revisedBy: "cli" },
    },
    {
      id: "global-loop",
      text: "PRIVATE GLOBAL LOOP TEXT Project workflow loop global preference.",
      category: "preference",
      scope: { type: "global" },
      status: "approved",
      source: "manual",
      kind: "workflow_rule",
      createdAt: "2026-06-18T08:00:00.000Z",
      updatedAt: "2026-06-18T08:00:00.000Z",
    },
  ]
}
```

Add tests near dashboard/status tests:

```ts
it("dashboard --json includes text-free continuity hints", () => {
  const dir = tempDir()
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity" }))
  const memoryFile = path.join(dir, "mem.jsonl")
  writeMemoryRecords(memoryFile, continuityFixtureRecords("cli-continuity"))

  const output = run(["dashboard", "--json", "--project", project], { MEMORY_LANE_FILE: memoryFile, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "emb.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") })
  const parsed = JSON.parse(output)

  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.continuityHints.supersededVisible[0].id, "old-loop")
  assert.ok(parsed.data.continuityHints.hints.some((hint: any) => hint.code === "superseded-visible"))
  assert.doesNotMatch(JSON.stringify(parsed.data.continuityHints), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT/u)
})

it("dashboard human output shows compact continuity hints without memory text", () => {
  const dir = tempDir()
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-human" }))
  const memoryFile = path.join(dir, "mem.jsonl")
  writeMemoryRecords(memoryFile, continuityFixtureRecords("cli-continuity-human"))

  const output = run(["dashboard", "--project", project], { MEMORY_LANE_FILE: memoryFile, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "emb.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") })

  assert.match(output, /Continuity hints/u)
  assert.match(output, /superseded-visible/u)
  assert.match(output, /memory-lane list --json/u)
  assert.doesNotMatch(output, /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT/u)
})

it("status and doctor json include text-free continuity hints", () => {
  const dir = tempDir()
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-status" }))
  const memoryFile = path.join(dir, "mem.jsonl")
  writeMemoryRecords(memoryFile, continuityFixtureRecords("cli-continuity-status"))
  const env = { MEMORY_LANE_FILE: memoryFile, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "emb.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") }

  const status = JSON.parse(run(["status", "--json", "--since", "2026-06-18T07:00:00.000Z", "--project", project], env))
  const doctor = JSON.parse(run(["doctor", "--json", "--since", "2026-06-18T07:00:00.000Z", "--project", project], env))

  assert.equal(status.data.continuityHints.newerApproved.count, 3)
  assert.equal(doctor.data.continuityHints.newerApproved.count, 3)
  assert.doesNotMatch(JSON.stringify(status.data.continuityHints), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT/u)
  assert.doesNotMatch(JSON.stringify(doctor.data.continuityHints), /PRIVATE OLD LOOP TEXT|PRIVATE CURRENT LOOP TEXT|PRIVATE GLOBAL LOOP TEXT/u)
})
```

- [ ] **Step 2: Run CLI tests and verify failure**

Run:

```bash
pnpm --filter @memory-lane/cli build
pnpm --filter @memory-lane/cli test -- test/cli.test.ts
```

Expected: FAIL because dashboard summary does not include `continuityHints`, and human dashboard does not render the continuity section.

- [ ] **Step 3: Update dashboard summary type and builder**

Replace the core import in `packages/cli/src/formatters.ts` with this full import line so it includes `buildContinuityHints` and `type ContinuityHintSummary`:

```ts
import ansis from "ansis"
import boxen from "boxen"
import Table from "cli-table3"
import figures from "figures"
import { buildContinuityHints, groupReviewMemories, isMetaTaskPromptText, revisionLabel, type CompactReport, type ContinuityHintSummary, type FreshnessStatus, type MemoryMutationResult, type MemoryRecord, type OperatingAgreementList, type OperatingAgreementSummary, type RecallResult, type ReplaceResult, type SaveResult, type SupersedeResult, type UpdatePreview } from "@memory-lane/core"
import type { ObsidianImportPlan, ObsidianImportResult } from "@memory-lane/obsidian-import"
```

Add `continuityHints: ContinuityHintSummary` to `DashboardSummary` after the `recent` property.

Replace `buildDashboardSummary` with:

```ts
export function buildDashboardSummary(memories: MemoryRecord[], projectScope = "none"): DashboardSummary {
  const pending = memories.filter((memory) => memory.status === "pending")
  const sessionSummaries = pending.filter((memory) => memory.kind === "session_summary")
  const suspectMeta = pending.filter((memory) => isMetaTaskPromptText(memory.text))
  const continuityHints = buildContinuityHints(memories, { projectScopeKey: projectScope === "none" ? undefined : projectScope })
  const suggestedActions: string[] = []
  if (pending.length) suggestedActions.push("memory-lane review")
  if (suspectMeta.length) suggestedActions.push("memory-lane review --suspect-meta")
  for (const action of continuityHints.suggestedActions) suggestedActions.push(action)
  if (!suggestedActions.length) suggestedActions.push("memory-lane recall <query>")

  return {
    projectScope,
    counts: {
      total: memories.length,
      approved: statusCount(memories, "approved"),
      pending: pending.length,
      rejected: statusCount(memories, "rejected"),
      deleted: statusCount(memories, "deleted"),
      global: memories.filter((memory) => memory.scope.type === "global").length,
      project: memories.filter((memory) => memory.scope.type === "project").length,
    },
    review: {
      pending: pending.length,
      sessionSummaries: sessionSummaries.length,
      suspectMeta: suspectMeta.length,
    },
    recent: {
      sessionSummaries: latestByCreatedAt(sessionSummaries, 3).map((memory) => ({
        id: memory.id,
        createdAt: memory.createdAt,
        status: memory.status,
        provenance: provenanceLabel(memory),
        preview: sessionSummaryPreview(memory.text),
      })),
    },
    continuityHints,
    suggestedActions: [...new Set(suggestedActions)],
  }
}
```

- [ ] **Step 4: Add human dashboard continuity section**

In `formatDashboard`, after recent session summaries and before suggested actions, add:

```ts
  if (summary.continuityHints.hintCount) {
    lines.push(
      "Continuity hints:",
      ...summary.continuityHints.hints.map((hint) => `  ${figures.bullet} ${hint.code}: ${hint.count}${hint.workflowArea ? ` (${hint.workflowArea})` : ""}`),
    )
    if (summary.continuityHints.suggestedActions.length) {
      lines.push(
        "Continuity inspection:",
        ...summary.continuityHints.suggestedActions.map((action) => `  ${colorize(figures.arrowRight, "cyan")} ${action}`),
      )
    }
  }
```

- [ ] **Step 5: Add doctor human summary support**

Add type guard and formatter near freshness/agreement formatters:

```ts
function isContinuityHintSummary(value: unknown): value is ContinuityHintSummary {
  return typeof value === "object" && value !== null
    && typeof (value as ContinuityHintSummary).hintCount === "number"
    && Array.isArray((value as ContinuityHintSummary).hints)
}

function formatContinuityHintSummary(value: unknown): string | undefined {
  if (!isContinuityHintSummary(value)) return undefined
  if (!value.hintCount) return "Continuity hints: none"
  const codes = value.hints.map((hint) => hint.workflowArea ? `${hint.code}/${hint.workflowArea}` : hint.code).join(", ")
  return `Continuity hints: ${value.hintCount} (${codes}). Use memory-lane dashboard for inspection actions.`
}
```

Update `formatDoctor` mapping:

```ts
      if (k === "continuityHints") return formatContinuityHintSummary(v) ?? "continuityHints: unavailable"
```

- [ ] **Step 6: Run CLI tests**

Run:

```bash
pnpm --filter @memory-lane/cli build
pnpm --filter @memory-lane/cli test
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

```bash
git add packages/cli/src/formatters.ts packages/cli/test/cli.test.ts
git commit -m "feat(cli): surface continuity hints"
```

---

## Task 4: MCP status coverage

**Files:**
- Test: `packages/mcp-server/test/handlers.test.ts`

Implementation may already be complete through `engine.doctor()`. Only change MCP source if tests reveal `memory_status` strips the field.

- [ ] **Step 1: Add failing MCP test**

Add near existing `memory_status` tests in `packages/mcp-server/test/handlers.test.ts`:

```ts
test("memory_status includes text-free continuity hints", async () => {
  const project = tempDir()
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "mcp-continuity" }))
  const engine = engineInTemp(project)
  const old = engine.save({ text: "PRIVATE MCP OLD LOOP TEXT Project workflow loop old", status: "approved", category: "project", kind: "project_fact" })
  const current = engine.save({ text: "PRIVATE MCP CURRENT LOOP TEXT Project workflow loop current", status: "approved", category: "project", kind: "workflow_rule" })
  assert.equal(old.status, "saved")
  assert.equal(current.status, "saved")
  engine.supersede(current.memory.id, [old.memory.id], { revisedBy: "manual", reason: "newer" })

  const result = parseToolResult(await handleMemoryStatus(engine, { projectPath: project, since: "2000-01-01T00:00:00.000Z" }))

  assert.equal(result.ok, true)
  assert.equal(result.data.status.continuityHints.supersededVisible[0].id, old.memory.id)
  assert.equal(result.data.status.continuityHints.newerApproved.count >= 2, true)
  assert.doesNotMatch(JSON.stringify(result.data.status.continuityHints), /PRIVATE MCP OLD LOOP TEXT|PRIVATE MCP CURRENT LOOP TEXT/u)
})
```

- [ ] **Step 2: Run MCP tests**

Run:

```bash
pnpm --filter @memory-lane/mcp-server test
```

Expected after Task 2: PASS. If it fails because `statusData()` strips fields, modify `packages/mcp-server/src/handlers.ts` only enough to preserve `engine.doctor()` output.

- [ ] **Step 3: Commit Task 4**

If only tests changed:

```bash
git add packages/mcp-server/test/handlers.test.ts
git commit -m "test(mcp): cover continuity hints in status"
```

If source changed too:

```bash
git add packages/mcp-server/src/handlers.ts packages/mcp-server/test/handlers.test.ts
git commit -m "feat(mcp): expose continuity hints in status"
```

---

## Task 5: Documentation and roadmap/handoff

**Files:**
- Modify: `README.md`
- Modify: `skills/memory-lane/SKILL.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Update README**

Add a section after `### Freshness status` or after `### Operating agreements`:

```md
### Continuity hints

`memory-lane dashboard`, `memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` include read-only continuity hints. Hints are metadata-only: they may include memory ids, scope, category, kind, source, provenance, timestamps, and revision relationships, but they do not include memory text in status/MCP surfaces.

Current hints report:

- approved memories that are marked superseded but remain visible as historical records;
- multiple operating-agreement candidates for the same workflow area;
- project/global preference overlap in the same workflow area;
- newer approved memories when `--since <ISO timestamp>` is provided.

Hints invite inspection with commands such as `memory-lane dashboard`, `memory-lane agreements --area <area> --json`, `memory-lane agreements --all`, and `memory-lane list --json`. They do not perform cleanup, hide superseded memories, change recall ranking, or suggest mutation commands by default.
```

- [ ] **Step 2: Update skill doc**

In `skills/memory-lane/SKILL.md`, add a short section:

```md
### Continuity hints

Use `memory-lane dashboard` for a compact human overview of continuity hints. Use `memory-lane status --json`, `memory-lane doctor --json`, or MCP `memory_status` when an agent needs text-free metadata about possible stale/duplicate continuity state. Hints are read-only and inspection-first; do not assume they cleaned up, hid, or deprioritized any memory.
```

- [ ] **Step 3: Update roadmap status**

In Phase 16 status, change Slice 4 from next incomplete to complete and make Slice 5 next.

Replace the Phase 16 status sentence with:

```md
**Status:** Slice 1 complete: read-only freshness/status detection is implemented. Slice 2 complete: read-only canonical workflow/operating-agreement discovery is implemented. Slice 3 complete: CLI-first update/replace/supersede revision primitives are implemented. Slice 4 complete: read-only continuity/status hints for superseded-visible memories, operating-agreement overlaps, project/global overlaps, and newer approved state are implemented. Slice 5 lifecycle bounded notices are the next incomplete item.
```

Change extension slice 4 bullet to begin:

```md
4. **Complete — continuity/status hints for duplicates and stale guidance:** dashboard/status/doctor/MCP status flag possible duplicate workflow memories, superseded-visible memories, project/global preference overlap, and newer approved state without performing silent cleanup.
```

- [ ] **Step 4: Update handoff**

Add a top entry to `HANDOFF.md`:

```md
- Phase 16 Slice 4 complete: added read-only continuity hints across core, CLI dashboard/status/doctor, and MCP memory_status. Hints are text-free metadata for superseded-visible memories, operating-agreement overlaps, project/global overlaps, and newer approved state. No lifecycle notices, recall filtering, automatic cleanup, workstream ids, or MCP mutation tools were added. Next recommended slice: Phase 16 Slice 5 lifecycle bounded notices.
```

- [ ] **Step 5: Run docs check**

Run:

```bash
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add README.md skills/memory-lane/SKILL.md ROADMAP.md HANDOFF.md
git commit -m "docs: document continuity hints"
```

---

## Task 6: Final verification and PR

**Files:**
- No planned file changes unless final review finds a defect.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm test
pnpm build
git diff --check
git status --short
```

Expected:

- all tests pass;
- build passes;
- diff check passes;
- worktree clean after committed changes.

- [ ] **Step 2: Scope audit**

Run:

```bash
rg -n "workstreamId|threadId|memory_update|memory_replace|memory_supersede|history|--force|depriorit|filtering|lifecycle bounded|handleSessionStart|handleUserPromptSubmit" packages docs README.md ROADMAP.md HANDOFF.md CONTEXT.md
```

Expected:

- `workstreamId`/`threadId` appear only in the Slice 4 spec as explicit non-goals.
- MCP mutation tool names do not appear as implemented tools.
- lifecycle hits are pre-existing docs/spec non-goal references only; no lifecycle source changes.
- no retrieval filtering/deprioritization implementation appears.

- [ ] **Step 3: Review against spec**

Check `docs/superpowers/specs/2026-06-18-continuity-status-hints-design.md` section by section:

- shared helper exists;
- all four hint types implemented;
- dashboard/status/doctor/MCP surfaces included;
- output is text-free outside dashboard's pre-existing session summary preview area;
- suggested actions are inspection-first;
- explicit non-goals were respected.

- [ ] **Step 4: Open PR**

Push branch and open PR:

```bash
git push -u origin feature/phase-16-slice-4-continuity-hints
gh pr create --base main --head feature/phase-16-slice-4-continuity-hints --title "feat: add continuity status hints" --body "## Summary
- add read-only continuity hint summary for superseded-visible memories, operating-agreement overlaps, project/global overlaps, and newer approved state
- surface text-free hints in dashboard/status/doctor and MCP memory_status
- document Slice 4 behavior and keep roadmap/handoff aligned

## Verification
- pnpm test
- pnpm build
- git diff --check

## Scope boundaries
- no lifecycle injection changes
- no recall/retrieval filtering changes
- no new memory fields or workstream ids
- no automatic cleanup or mutation suggestions
- no MCP mutation tools
"
```

- [ ] **Step 5: Stop for user merge**

After PR is opened, stop and wait for user review/merge. Do not clean up the worktree or branch until the user says the PR has merged.
