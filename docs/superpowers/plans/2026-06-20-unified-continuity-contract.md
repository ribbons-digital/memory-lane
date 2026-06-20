# Unified Continuity Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a canonical Memory Lane continuity read model and expose it through CLI and MCP so continuity questions use the same authoritative surface across harnesses.

**Architecture:** Add a pure core read-model builder in `packages/core/src/continuity-read-model.ts`, then route `MemoryEngine.continuity()` through it. CLI and MCP call that same engine method. Lifecycle prompt guidance is updated to point continuity questions at this canonical surface first.

**Tech Stack:** TypeScript, Node test runner, existing Memory Lane core/CLI/MCP packages, pnpm workspace.

---

## File Structure

- Create: `packages/core/src/continuity-read-model.ts`
  - Owns continuity read-model types/helpers, selection, bounded previews, warnings, suggested actions, and harness guidance.
- Modify: `packages/core/src/types.ts`
  - Adds exported continuity read-model interfaces and warning code union.
- Modify: `packages/core/src/index.ts`
  - Exports `buildContinuityReadModel`.
- Modify: `packages/core/src/engine.ts`
  - Imports builder and exposes `continuity(): ContinuityReadModel`.
- Create: `packages/core/test/continuity-read-model.test.ts`
  - TDD coverage for project approved continuity, pending continuity, warnings, no scope, bounded/secret-filtered previews.
- Modify: `packages/cli/src/index.ts`
  - Adds `continuity` command handler and command map entry.
- Modify: `packages/cli/src/formatters.ts`
  - Adds `formatContinuityReadModel` and help entry.
- Modify: `packages/cli/test/cli.test.ts`
  - Adds CLI JSON/human/help tests.
- Modify: `packages/mcp-server/src/types.ts`
  - Adds `ContinuityToolInput`.
- Modify: `packages/mcp-server/src/handlers.ts`
  - Adds `handleMemoryContinuity`.
- Modify: `packages/mcp-server/src/server.ts`
  - Registers `memory_continuity` and includes it in exported tool names.
- Modify: `packages/mcp-server/test/handlers.test.ts`
  - Adds MCP continuity tests.
- Modify: `packages/lifecycle/src/injection.ts`
  - Updates prompt continuity guidance to point to `memory-lane continuity --json` / `memory_continuity` first.
- Modify: `packages/lifecycle/test/injection.test.ts` or `packages/lifecycle/test/handlers.test.ts`
  - Updates/adds guidance string tests.
- Modify: `README.md`
  - Documents CLI and MCP continuity surfaces and recall-not-authoritative guidance.
- Modify: `ROADMAP.md`
  - Marks the unified continuity contract slice complete when done.

---

### Task 1: Core continuity read model

**Files:**
- Create: `packages/core/src/continuity-read-model.ts`
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/engine.ts`
- Test: `packages/core/test/continuity-read-model.test.ts`

- [ ] **Step 1: Write failing core tests**

Create `packages/core/test/continuity-read-model.test.ts` with tests for latest approved project continuity, pending continuity, newer-pending warning, no-project warning, and secret/bounded previews:

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { buildContinuityReadModel, type MemoryRecord } from "../src/index.js"

function memory(overrides: Partial<MemoryRecord> & { id: string; text?: string }): MemoryRecord {
  return {
    id: overrides.id,
    text: overrides.text ?? `Memory ${overrides.id}`,
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

test("continuity read model selects latest approved project continuity with bounded preview", () => {
  const result = buildContinuityReadModel([
    memory({ id: "old", text: "Old project fact", kind: "project_fact", updatedAt: "2026-06-18T08:00:00.000Z" }),
    memory({ id: "checkpoint", text: "Released v0.2.11 with unified release assets and checks passing.", kind: "project_checkpoint", updatedAt: "2026-06-18T10:00:00.000Z" }),
    memory({ id: "global", text: "Global workflow preference", category: "preference", scope: { type: "global" }, kind: "workflow_rule", updatedAt: "2026-06-18T11:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  assert.equal(result.projectScope, "project-a")
  assert.equal(result.latestApproved.project?.id, "checkpoint")
  assert.equal(result.latestApproved.project?.preview, "Released v0.2.11 with unified release assets and checks passing.")
  assert.equal(result.latestApproved.global?.id, "global")
  assert.equal(result.status.visibleApprovedCount, 3)
})

test("continuity read model includes pending checkpoint and session-summary candidates", () => {
  const result = buildContinuityReadModel([
    memory({ id: "approved", text: "Approved checkpoint", kind: "project_checkpoint", updatedAt: "2026-06-18T08:00:00.000Z" }),
    memory({ id: "pending-checkpoint", text: "Merged PR #18 adding global hygiene hints.", status: "pending", kind: "project_fact", updatedAt: "2026-06-18T09:00:00.000Z" }),
    memory({ id: "pending-summary", text: "## Session Summary\nNext action: cut release.", status: "pending", source: "session-summary", kind: "session_summary", updatedAt: "2026-06-18T10:00:00.000Z" }),
    memory({ id: "pending-random", text: "Remember maybe something", status: "pending", kind: "misc" }),
  ], { projectScopeKey: "project-a" })

  assert.deepEqual(result.pendingContinuity.map((item) => item.id), ["pending-summary", "pending-checkpoint"])
  assert.equal(result.status.pendingContinuityCount, 2)
  assert.equal(result.pendingContinuity[1].checkpointCandidate?.kind, "merge")
  assert.ok(result.suggestedActions.includes("memory-lane review --json"))
})

test("continuity read model warns when pending continuity is newer than approved project continuity", () => {
  const result = buildContinuityReadModel([
    memory({ id: "approved", text: "Approved checkpoint", kind: "project_checkpoint", updatedAt: "2026-06-18T08:00:00.000Z" }),
    memory({ id: "pending", text: "Pending newer session summary", status: "pending", kind: "session_summary", source: "session-summary", updatedAt: "2026-06-18T11:00:00.000Z" }),
  ], { projectScopeKey: "project-a" })

  const warning = result.warnings.find((item) => item.code === "pending-continuity-newer-than-approved")
  assert.equal(warning?.severity, "review")
  assert.deepEqual(warning?.memoryIds, ["pending"])
})

test("continuity read model warns when no project scope is active", () => {
  const result = buildContinuityReadModel([
    memory({ id: "global", text: "Global preference", category: "preference", scope: { type: "global" }, kind: "preference" }),
  ])

  assert.equal(result.projectScope, "none")
  assert.ok(result.warnings.some((item) => item.code === "no-project-scope"))
  assert.match(result.answerGuidance.join("\n"), /Pass projectPath/u)
})

test("continuity previews are bounded and omit likely secrets", () => {
  const longText = `${"A".repeat(260)} end`
  const result = buildContinuityReadModel([
    memory({ id: "long", text: longText, kind: "project_checkpoint" }),
    memory({ id: "secret", text: "api_key = sk-1234567890abcdef1234567890abcdef", status: "pending", kind: "session_summary", updatedAt: "2026-06-18T10:00:00.000Z" }),
  ], { projectScopeKey: "project-a", previewMaxChars: 80 })

  assert.equal(result.latestApproved.project?.preview.length, 80)
  assert.equal(result.latestApproved.project?.preview.endsWith("…"), true)
  assert.equal(result.pendingContinuity.some((item) => item.id === "secret"), false)
  assert.doesNotMatch(JSON.stringify(result), /sk-1234567890/u)
})
```

- [ ] **Step 2: Run core test to verify RED**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/continuity-read-model.test.ts
```

Expected: FAIL because `buildContinuityReadModel` does not exist.

- [ ] **Step 3: Add types**

In `packages/core/src/types.ts`, add interfaces near existing continuity types:

```ts
export type ContinuityWarningCode =
  | "pending-continuity-newer-than-approved"
  | "no-project-scope"
  | "scope-hygiene-candidate"
  | "operating-agreement-overlap"
  | "mcp-explicit-tools-only"

export interface ContinuityMemoryPreview {
  id: string
  status: Extract<MemoryStatus, "approved" | "pending">
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  preview: string
  checkpointCandidate?: import("./checkpoint-candidates.js").CheckpointCandidateMetadata
}

export interface ContinuityWarning {
  code: ContinuityWarningCode
  severity: "info" | "review" | "warning"
  message: string
  memoryIds?: string[]
}

export interface ContinuityHarnessGuidance {
  summary: string[]
  cli: string[]
  mcp: string[]
}

export interface ContinuityReadModel {
  projectScope: string | "none"
  generatedAt: string
  status: {
    visibleApprovedCount: number
    pendingReviewCount: number
    pendingContinuityCount: number
  }
  latestApproved: {
    project?: ContinuityMemoryPreview
    global?: ContinuityMemoryPreview
  }
  pendingContinuity: ContinuityMemoryPreview[]
  freshness: FreshnessStatus
  continuityHints: ContinuityHintSummary
  operatingAgreements: OperatingAgreementSummary
  warnings: ContinuityWarning[]
  suggestedActions: string[]
  answerGuidance: string[]
  harnessGuidance: ContinuityHarnessGuidance
  notes: string[]
}

export interface ContinuityReadModelOptions {
  projectScopeKey?: string
  previewMaxChars?: number
  maxPendingContinuity?: number
  generatedAt?: string
  caller?: "cli" | "mcp" | "lifecycle" | "core"
}
```

- [ ] **Step 4: Implement core builder**

Create `packages/core/src/continuity-read-model.ts`:

```ts
import { classifyCheckpointCandidate } from "./checkpoint-candidates.js"
import { containsLikelySecret } from "./secret-detection.js"
import { buildContinuityHints } from "./continuity-hints.js"
import { buildFreshnessStatus } from "./freshness.js"
import { selectOperatingAgreements, summarizeOperatingAgreements } from "./operating-agreements.js"
import type {
  ContinuityMemoryPreview,
  ContinuityReadModel,
  ContinuityReadModelOptions,
  ContinuityWarning,
  MemoryKind,
  MemoryRecord,
} from "./types.js"

const DEFAULT_PREVIEW_MAX_CHARS = 240
const DEFAULT_MAX_PENDING_CONTINUITY = 5
const CONTINUITY_KINDS = new Set<MemoryKind>(["project_checkpoint", "session_summary", "decision", "project_fact"])
const PROJECT_KIND_PRIORITY = new Map<MemoryKind, number>([
  ["project_checkpoint", 0],
  ["session_summary", 1],
  ["decision", 2],
  ["project_fact", 3],
])

function visibleInProject(memory: MemoryRecord, projectScopeKey?: string): boolean {
  if (memory.scope.type === "global") return true
  return Boolean(projectScopeKey) && memory.scope.key === projectScopeKey
}

function projectScoped(memory: MemoryRecord, projectScopeKey?: string): boolean {
  return Boolean(projectScopeKey) && memory.scope.type === "project" && memory.scope.key === projectScopeKey
}

function compactPreview(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/gu, " ").trim()
  if (normalized.length <= maxChars) return normalized
  if (maxChars <= 1) return "…"
  return `${normalized.slice(0, maxChars - 1).trimEnd()}…`
}

function preview(memory: MemoryRecord, maxChars: number): ContinuityMemoryPreview | undefined {
  if (containsLikelySecret(memory.text)) return undefined
  const checkpointCandidate = classifyCheckpointCandidate(memory)
  return {
    id: memory.id,
    status: memory.status as "approved" | "pending",
    category: memory.category,
    scope: memory.scope,
    source: memory.source,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
    kind: memory.kind,
    provenance: memory.provenance,
    preview: compactPreview(memory.text, maxChars),
    ...(checkpointCandidate ? { checkpointCandidate } : {}),
  }
}

function compareNewest(a: MemoryRecord, b: MemoryRecord): number {
  return b.updatedAt.localeCompare(a.updatedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id)
}

function compareApprovedProject(a: MemoryRecord, b: MemoryRecord): number {
  const priorityA = a.kind ? PROJECT_KIND_PRIORITY.get(a.kind) ?? 99 : 99
  const priorityB = b.kind ? PROJECT_KIND_PRIORITY.get(b.kind) ?? 99 : 99
  const time = b.updatedAt.localeCompare(a.updatedAt)
  if (time !== 0) return time
  return priorityA - priorityB || a.id.localeCompare(b.id)
}

function isPendingContinuity(memory: MemoryRecord): boolean {
  if (memory.status !== "pending") return false
  if (memory.kind === "project_checkpoint" || memory.kind === "session_summary") return true
  return Boolean(classifyCheckpointCandidate(memory))
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function buildWarnings(input: {
  projectScope?: string
  latestProject?: ContinuityMemoryPreview
  pendingContinuity: ContinuityMemoryPreview[]
  hintCodes: Set<string>
  caller?: string
}): ContinuityWarning[] {
  const warnings: ContinuityWarning[] = []
  if (!input.projectScope) {
    warnings.push({
      code: "no-project-scope",
      severity: "warning",
      message: "No project scope is active; continuity may be global or incomplete. Pass projectPath in MCP clients or run from the project directory.",
    })
  }

  const latestApprovedAt = input.latestProject?.updatedAt
  const newerPending = latestApprovedAt
    ? input.pendingContinuity.filter((memory) => memory.updatedAt > latestApprovedAt)
    : input.pendingContinuity
  if (newerPending.length) {
    warnings.push({
      code: "pending-continuity-newer-than-approved",
      severity: "review",
      message: "Pending continuity candidates are newer than the latest approved project continuity memory; inspect review before answering as fact.",
      memoryIds: newerPending.map((memory) => memory.id),
    })
  }

  if (input.hintCodes.has("scope-hygiene-candidate")) {
    warnings.push({ code: "scope-hygiene-candidate", severity: "review", message: "Some visible global memories look project-specific; inspect scope hygiene before relying on them." })
  }
  if (input.hintCodes.has("operating-agreement-overlap")) {
    warnings.push({ code: "operating-agreement-overlap", severity: "review", message: "Multiple operating agreement candidates overlap; inspect agreements before applying workflow guidance." })
  }
  if (input.caller === "mcp") {
    warnings.push({ code: "mcp-explicit-tools-only", severity: "info", message: "MCP exposes explicit tools only; it does not run lifecycle hooks or automatic context injection." })
  }
  return warnings
}

export function buildContinuityReadModel(memories: MemoryRecord[], options: ContinuityReadModelOptions = {}): ContinuityReadModel {
  const projectScope = options.projectScopeKey
  const previewMaxChars = options.previewMaxChars ?? DEFAULT_PREVIEW_MAX_CHARS
  const maxPendingContinuity = options.maxPendingContinuity ?? DEFAULT_MAX_PENDING_CONTINUITY
  const visibleApproved = memories.filter((memory) => memory.status === "approved" && visibleInProject(memory, projectScope))
  const approvedProject = visibleApproved
    .filter((memory) => projectScoped(memory, projectScope) && (!memory.kind || CONTINUITY_KINDS.has(memory.kind)))
    .sort(compareApprovedProject)
  const approvedGlobal = visibleApproved
    .filter((memory) => memory.scope.type === "global")
    .sort(compareNewest)
  const pendingReview = memories.filter((memory) => memory.status === "pending")
  const pendingContinuity = pendingReview
    .filter((memory) => projectScoped(memory, projectScope) && isPendingContinuity(memory))
    .sort(compareNewest)
    .slice(0, maxPendingContinuity)
    .map((memory) => preview(memory, previewMaxChars))
    .filter((item): item is ContinuityMemoryPreview => Boolean(item))

  const freshness = buildFreshnessStatus(memories, { projectScopeKey: projectScope })
  const continuityHints = buildContinuityHints(memories, { projectScopeKey: projectScope })
  const operatingAgreements = summarizeOperatingAgreements(selectOperatingAgreements(memories, { projectScopeKey: projectScope }))
  const latestProject = approvedProject.map((memory) => preview(memory, previewMaxChars)).find(Boolean)
  const latestGlobal = approvedGlobal.map((memory) => preview(memory, previewMaxChars)).find(Boolean)
  const hintCodes = new Set(continuityHints.hints.map((hint) => hint.code))
  const warnings = buildWarnings({ projectScope, latestProject, pendingContinuity, hintCodes, caller: options.caller })

  const suggestedActions = unique([
    "memory-lane continuity --json",
    ...(pendingContinuity.length ? ["memory-lane review --json"] : []),
    "memory-lane status --json",
    "memory-lane list --json",
    ...(operatingAgreements.primaryCount || operatingAgreements.relatedCandidateCount ? ["memory-lane agreements --json"] : []),
    ...continuityHints.suggestedActions,
  ])

  return {
    projectScope: projectScope ?? "none",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    status: {
      visibleApprovedCount: visibleApproved.length,
      pendingReviewCount: pendingReview.length,
      pendingContinuityCount: pendingContinuity.length,
    },
    latestApproved: {
      ...(latestProject ? { project: latestProject } : {}),
      ...(latestGlobal ? { global: latestGlobal } : {}),
    },
    pendingContinuity,
    freshness,
    continuityHints,
    operatingAgreements,
    warnings,
    suggestedActions,
    answerGuidance: [
      "Use this continuity read model before answering last-worked-on, accomplished, or next-action questions.",
      "Treat pending continuity as review candidates, not approved facts.",
      projectScope ? "If repository access is available, compare this result with current git state and roadmap/docs before finalizing the answer." : "Pass projectPath or run from a project directory for project-scoped continuity.",
    ],
    harnessGuidance: {
      summary: ["Memory Lane owns continuity semantics; harnesses should use this read model rather than recall alone."],
      cli: ["Run memory-lane continuity --json for authoritative continuity inspection."],
      mcp: ["Call memory_continuity with projectPath for project-scoped continuity in desktop MCP clients."],
    },
    notes: ["Continuity is read-only; no memory cleanup, approval, or mutation is performed."],
  }
}
```

- [ ] **Step 5: Export builder and add engine method**

In `packages/core/src/index.ts`, add:

```ts
export { buildContinuityReadModel } from "./continuity-read-model.js"
```

In `packages/core/src/engine.ts`, import the builder/type and add method before `doctor()`:

```ts
import { buildContinuityReadModel } from "./continuity-read-model.js"
// add ContinuityReadModel to the type import list

continuity(opts?: { caller?: "cli" | "mcp" | "lifecycle" | "core" }): ContinuityReadModel {
  return buildContinuityReadModel(this.store.list(), {
    projectScopeKey: this.scope?.key,
    caller: opts?.caller,
  })
}
```

- [ ] **Step 6: Run core test to verify GREEN**

Run:

```bash
pnpm --filter @memory-lane/core test -- test/continuity-read-model.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit core read model**

Run:

```bash
git add packages/core/src/continuity-read-model.ts packages/core/src/types.ts packages/core/src/index.ts packages/core/src/engine.ts packages/core/test/continuity-read-model.test.ts
git commit -m "feat: add continuity read model"
```

---

### Task 2: CLI continuity command

**Files:**
- Modify: `packages/cli/src/index.ts`
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`

- [ ] **Step 1: Write failing CLI tests**

Add tests inside the existing `CLI integration` describe block in `packages/cli/test/cli.test.ts`:

```ts
it("continuity --json returns canonical continuity state", () => {
  const dir = tempDir()
  const project = path.join(dir, "project")
  fs.mkdirSync(project)
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-project" }))
  const mem = path.join(dir, "memory.jsonl")
  const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json") }
  writeMemoryRecords(mem, [
    { id: "approved", text: "Approved project checkpoint", category: "project", scope: { type: "project", key: "cli-continuity-project" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" },
    { id: "pending", text: "Merged PR #18 adding global hygiene hints.", category: "project", scope: { type: "project", key: "cli-continuity-project" }, status: "pending", source: "user-suggested", kind: "project_fact", createdAt: "2026-06-18T09:00:00.000Z", updatedAt: "2026-06-18T09:00:00.000Z" },
  ] as MemoryRecord[])

  const output = runProcess(["continuity", "--json"], { env, cwd: project })
  assert.equal(output.status, 0, output.stderr)
  const parsed = JSON.parse(output.stdout)
  assert.equal(parsed.ok, true)
  assert.equal(parsed.data.projectScope, "cli-continuity-project")
  assert.equal(parsed.data.latestApproved.project.id, "approved")
  assert.deepEqual(parsed.data.pendingContinuity.map((item: any) => item.id), ["pending"])
  assert.ok(parsed.data.warnings.some((item: any) => item.code === "pending-continuity-newer-than-approved"))
})

it("continuity human output is compact and labels pending continuity", () => {
  const dir = tempDir()
  const project = path.join(dir, "project")
  fs.mkdirSync(project)
  fs.writeFileSync(path.join(project, ".memory-lane-scope"), JSON.stringify({ id: "cli-continuity-human" }))
  const mem = path.join(dir, "memory.jsonl")
  const env = { MEMORY_LANE_FILE: mem, MEMORY_LANE_EMBEDDINGS_FILE: path.join(dir, "embeddings.jsonl"), MEMORY_LANE_CONFIG: path.join(dir, "config.json"), NO_COLOR: "1" }
  writeMemoryRecords(mem, [
    { id: "approved", text: "Approved project checkpoint", category: "project", scope: { type: "project", key: "cli-continuity-human" }, status: "approved", source: "manual", kind: "project_checkpoint", createdAt: "2026-06-18T08:00:00.000Z", updatedAt: "2026-06-18T08:00:00.000Z" },
    { id: "pending", text: "## Session Summary\nNext action: inspect review queue.", category: "project", scope: { type: "project", key: "cli-continuity-human" }, status: "pending", source: "session-summary", kind: "session_summary", createdAt: "2026-06-18T09:00:00.000Z", updatedAt: "2026-06-18T09:00:00.000Z" },
  ] as MemoryRecord[])

  const output = runProcess(["continuity"], { env, cwd: project })
  assert.equal(output.status, 0, output.stderr)
  assert.match(output.stdout, /Memory Lane Continuity/u)
  assert.match(output.stdout, /Project: cli-continuity-human/u)
  assert.match(output.stdout, /Latest approved/u)
  assert.match(output.stdout, /Pending continuity/u)
  assert.match(output.stdout, /memory-lane review --json/u)
})
```

Update the existing help test assertion for command listing to expect `continuity` in help output.

- [ ] **Step 2: Run CLI tests to verify RED**

Run:

```bash
pnpm build && pnpm --filter @memory-lane/cli test -- test/cli.test.ts
```

Expected: FAIL because `continuity` command/formatter do not exist.

- [ ] **Step 3: Add formatter and command handler**

In `packages/cli/src/formatters.ts`, import `ContinuityReadModel` and add:

```ts
export function formatContinuityReadModel(model: ContinuityReadModel, json: boolean, extraMeta?: Record<string, unknown>): string {
  if (json) {
    return JSON.stringify({ ok: true, data: model, meta: meta(extraMeta) }, null, 2)
  }

  const lines = [
    boxen([
      `Project: ${model.projectScope}`,
      `${figures.pointerSmall} Approved visible ${model.status.visibleApprovedCount}   Pending continuity ${model.status.pendingContinuityCount}`,
    ].join("\n"), { title: "Memory Lane Continuity", titleAlignment: "center", padding: 1, borderStyle: "round", borderColor: supportsColor() ? "cyan" : undefined }),
  ]

  if (model.latestApproved.project) {
    lines.push("", colorize("Latest approved", "bold"), `  [${model.latestApproved.project.id}] ${model.latestApproved.project.preview}`)
  }
  if (model.pendingContinuity.length) {
    lines.push("", colorize("Pending continuity", "bold"))
    for (const item of model.pendingContinuity) lines.push(`  [${item.id}] ${item.preview}`)
  }
  if (model.warnings.length) {
    lines.push("", colorize("Warnings", "yellow"))
    for (const warning of model.warnings) lines.push(`  ${figures.warning} ${warning.code}: ${warning.message}`)
  }
  lines.push("", colorize("Suggested actions", "bold"), ...model.suggestedActions.map((action) => `  ${figures.pointerSmall} ${action}`))
  return lines.join("\n")
}
```

Also add command to `usage()` output:

```text
memory-lane continuity [--json]    Canonical continuity read model for resumption/status questions
```

In `packages/cli/src/index.ts`, import `formatContinuityReadModel`, add handler:

```ts
function handleContinuity(ctx: CliContext): void {
  console.log(formatContinuityReadModel(ctx.engine.continuity({ caller: "cli" }), ctx.json, { projectScope: ctx.engine.getProjectScope()?.key ?? "none" }))
}
```

Add `continuity: handleContinuity` to `handlers`.

- [ ] **Step 4: Run CLI tests to verify GREEN**

Run:

```bash
pnpm build && pnpm --filter @memory-lane/cli test -- test/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit CLI surface**

Run:

```bash
git add packages/cli/src/index.ts packages/cli/src/formatters.ts packages/cli/test/cli.test.ts
git commit -m "feat: expose continuity CLI command"
```

---

### Task 3: MCP continuity tool

**Files:**
- Modify: `packages/mcp-server/src/types.ts`
- Modify: `packages/mcp-server/src/handlers.ts`
- Modify: `packages/mcp-server/src/server.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Write failing MCP tests**

In `packages/mcp-server/test/handlers.test.ts`, import `handleMemoryContinuity` and add:

```ts
test("memory_continuity applies projectPath and returns continuity read model", async () => {
  const projectA = tempDir()
  fs.writeFileSync(path.join(projectA, ".memory-lane-scope"), JSON.stringify({ id: "mcp-continuity-project" }))
  const engine = engineInTemp(projectA)
  engine.save({ text: "Approved project checkpoint", status: "approved", category: "project", scopeType: "project", kind: "project_checkpoint" })
  engine.save({ text: "Merged PR #18 adding global hygiene hints.", status: "pending", category: "project", scopeType: "project", kind: "project_fact" })

  const result = parseToolResult(await handleMemoryContinuity(engine, { projectPath: projectA }))

  assert.equal(result.ok, true)
  assert.equal(result.data.continuity.projectScope, "mcp-continuity-project")
  assert.equal(result.data.continuity.latestApproved.project.id.length > 0, true)
  assert.equal(result.data.continuity.pendingContinuity.length, 1)
  assert.ok(result.data.notes.some((note: string) => /explicit tools only/u.test(note)))
})
```

In `packages/mcp-server/test/server.test.ts` or existing server test file, update tool-name export assertion to include `memory_continuity`.

- [ ] **Step 2: Run MCP tests to verify RED**

Run:

```bash
pnpm build && pnpm --filter @memory-lane/mcp-server test
```

Expected: FAIL because handler/tool do not exist.

- [ ] **Step 3: Add MCP types, handler, registration**

In `packages/mcp-server/src/types.ts` add:

```ts
export interface ContinuityToolInput extends ProjectPathInput {}
```

In `packages/mcp-server/src/handlers.ts`, import type and add:

```ts
export async function handleMemoryContinuity(engine: MemoryEngine, input: ContinuityToolInput) {
  try {
    applyProjectPath(engine, input.projectPath)
    return jsonContent(envelope(engine, {
      continuity: engine.continuity({ caller: "mcp" }),
      notes: [
        "Use memory_continuity for last-worked-on, accomplished, next-action, resume, and project-status questions.",
        "MCP provides explicit tools only; it does not run lifecycle hooks.",
        ...scopeNotes(engine),
      ],
    }))
  } catch (error) {
    return jsonContent(errorEnvelope(error))
  }
}
```

In `packages/mcp-server/src/server.ts`, import handler, add `memory_continuity` to `MEMORY_LANE_TOOL_NAMES`, and register:

```ts
server.registerTool(
  "memory_continuity",
  {
    title: "Memory Lane Continuity",
    description: "Canonical continuity read model for project resumption, last-worked-on, accomplished, next-action, and project-status questions. Prefer this over memory_recall for continuity questions. Pass projectPath for project-scoped results in desktop MCP clients.",
    inputSchema: { projectPath },
  },
  async (input) => handleMemoryContinuity(engine, input),
)
```

- [ ] **Step 4: Run MCP tests to verify GREEN**

Run:

```bash
pnpm build && pnpm --filter @memory-lane/mcp-server test
```

Expected: PASS.

- [ ] **Step 5: Commit MCP surface**

Run:

```bash
git add packages/mcp-server/src/types.ts packages/mcp-server/src/handlers.ts packages/mcp-server/src/server.ts packages/mcp-server/test/handlers.test.ts packages/mcp-server/test/*.test.ts
git commit -m "feat: expose continuity MCP tool"
```

---

### Task 4: Lifecycle guidance and docs

**Files:**
- Modify: `packages/lifecycle/src/injection.ts`
- Modify: `packages/lifecycle/test/injection.test.ts` and/or `packages/lifecycle/test/handlers.test.ts`
- Modify: `README.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Write failing lifecycle guidance test**

Find existing tests for `renderContinuityIntentGuidance` or prompt continuity guidance. Add/update an assertion:

```ts
const guidance = renderContinuityIntentGuidance({ detected: true, family: "next-work" })
assert.match(guidance, /memory-lane continuity --json/u)
assert.match(guidance, /memory_continuity/u)
assert.match(guidance, /Do not answer from memory_recall alone/u)
```

- [ ] **Step 2: Run lifecycle tests to verify RED**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test
```

Expected: FAIL until guidance text is updated.

- [ ] **Step 3: Update guidance and docs**

In `packages/lifecycle/src/injection.ts`, update `renderContinuityIntentGuidance()` suggested inspection lines to lead with:

```ts
"- CLI: memory-lane continuity --json",
"- MCP: memory_continuity({ projectPath })",
"- Do not answer from memory_recall alone; use recall only for topic-specific follow-up after continuity inspection.",
```

Keep existing topic-specific recall and roadmap/review queue guidance after the canonical continuity surface.

In `README.md`:

- Add `memory-lane continuity [--json]` to CLI command list.
- Add a `### Continuity read model` subsection near continuity hints/prompt-time guidance.
- Add `memory_continuity` to MCP tool list and explain it should be preferred over `memory_recall` for continuity questions.

In `ROADMAP.md`, update Phase 17 status to say unified continuity contract slice is complete.

- [ ] **Step 4: Run lifecycle and docs-adjacent tests to verify GREEN**

Run:

```bash
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test -- test/cli.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit guidance/docs**

Run:

```bash
git add packages/lifecycle/src/injection.ts packages/lifecycle/test/*.test.ts README.md ROADMAP.md
git commit -m "docs: align guidance with continuity read model"
```

---

### Task 5: Final verification and deviation check

**Files:**
- No planned source edits unless verification exposes issues.

- [ ] **Step 1: Run full verification**

Run:

```bash
pnpm build
pnpm test
git diff --check
git status --short
```

Expected: build and tests pass, diff check clean, only expected branch changes present.

- [ ] **Step 2: Deviation check**

Compare implementation against:

- `docs/superpowers/specs/2026-06-20-unified-continuity-contract-design.md`
- this plan

Report:

- what matched;
- what deviated;
- why;
- whether any deviation needs fixing now.

- [ ] **Step 3: Final commit if needed**

If Task 5 produced source/doc fixes, commit them:

```bash
git add <changed-files>
git commit -m "test: verify continuity contract"
```

- [ ] **Step 4: Prepare branch handoff**

Report:

- changed files;
- commits;
- verification commands and output summary;
- residual risks;
- next PR step.
