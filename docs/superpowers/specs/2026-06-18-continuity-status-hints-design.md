# Continuity Status Hints Design

## Status

Draft for review. This spec covers **Phase 16 Slice 4 — continuity/status hints for duplicates and stale guidance**.

## Goal

Add a shared, read-only continuity hint layer that helps users and harnesses notice possible stale or duplicated continuity state without mutating memories, changing recall ranking, hiding historical records, or injecting additional context.

Slice 4 is a small deterministic step toward the broader Memory Lane experience where a user can ask natural-language questions such as “resume building X” or “find where we implemented X,” and the system can point to relevant project state, session summaries, checkpoints, and revision relationships without requiring thread ids, branch names, or dates.

## Background

Phase 16 has been building canonical continuity primitives in small slices:

1. Slice 1 added read-only freshness/status detection.
2. Slice 2 added operating-agreement discovery.
3. Slice 3 added explicit update/replace/supersede revision primitives.

Slice 4 uses those foundations to surface **signals** that a session or user should inspect continuity state. It does not decide or fix anything automatically. The first implementation should be deterministic, metadata-only, and useful in dashboard/status/MCP surfaces.

## Domain terminology

`CONTEXT.md` now defines **workstream**:

> The user-meaningful unit of ongoing work across one or more manual threads, harness sessions, orchestrator threads, subagent runs, branches, PRs, and session summaries. In Phase 16 Slice 4 this is a domain/spec concept only; Memory Lane should infer continuity hints from existing memory metadata rather than adding a first-class workstream id or thread metadata.

Slice 4 uses this term to guide product intent, but it does **not** add `workstreamId`, `threadId`, or any new record metadata.

## Design decisions

### 1. Shared core helper

Add a shared core helper, likely in `packages/core/src/continuity-hints.ts`:

```ts
export function buildContinuityHints(
  memories: MemoryRecord[],
  options?: ContinuityHintOptions,
): ContinuityHintSummary
```

The helper owns the rules so CLI dashboard/status, CLI doctor, MCP `memory_status`, and later lifecycle bounded notices can use the same deterministic logic.

The helper must be read-only. It must not write memories, invalidate embeddings, run mirror sync, or call semantic/LLM providers.

### 2. Text-free structured output

Continuity hints may include ids and metadata, but not memory text.

Allowed metadata includes:

- `id`
- `status`
- `category`
- `scope`
- `source`
- `kind`
- `createdAt`
- `updatedAt`
- `provenance`
- `revision.supersededBy`
- workflow area labels from operating-agreement selection

Disallowed output:

- full memory text
- text previews
- raw transcripts
- hook payloads
- tool outputs
- subagent task prompts

### 3. Hint type: superseded approved memories are still visible

Detect approved visible memories with `revision.supersededBy`.

This hint means: the memory remains an approved historical record, but a newer approved successor exists. It should help users notice stale guidance without hiding or deleting history.

Output should include:

- count
- affected memory ids
- successor ids
- scope/category/kind/source/provenance/updatedAt metadata
- inspection-oriented suggested action such as `memory-lane list --json`

It must not suggest destructive cleanup by default. In particular, do not suggest `delete` as the default action.

### 4. Hint type: multiple operating-agreement candidates

Reuse existing operating-agreement selection.

If a workflow area has a primary operating agreement and related candidates, emit a hint that multiple applicable candidates exist for that area. This helps users find duplicated or overlapping project-loop, review-gate, PR-process, release-process, or tooling-preference guidance.

Output should include:

- workflow area
- primary ids
- related candidate ids
- counts
- suggested inspection command: `memory-lane agreements --area <area>`

This is informational only. Related candidates are not automatically stale or wrong.

### 5. Hint type: project/global preference overlap

Detect when project-scoped and global operating-agreement/preference candidates appear in the same workflow area.

This hint means a project-specific agreement may refine or conflict with a global preference. It should invite inspection, not replacement.

Output should include:

- workflow area
- project candidate ids
- global candidate ids
- counts
- suggested inspection command: `memory-lane agreements --all`

### 6. Hint type: newer approved state since timestamp

When a `since` timestamp is provided, reuse existing freshness status to include a compact continuity hint for newer approved memories visible to the current project/global scope.

This hint should summarize newer approved state using freshness metadata only. It should not duplicate memory text.

Suggested inspection action may include:

```bash
memory-lane status --json --since <timestamp>
```

### 7. Suggested actions are inspection-first

Suggested actions should help users inspect or review continuity state without nudging mutation.

Allowed default suggestions:

- `memory-lane dashboard --json`
- `memory-lane status --json --since <timestamp>`
- `memory-lane agreements --area <area>`
- `memory-lane agreements --all`
- `memory-lane list --json`
- `memory-lane recall <query>`

Do not suggest mutation commands such as `delete`, `update`, `replace`, or `supersede` as default dashboard/status actions in Slice 4. Documentation may mention that explicit revision commands exist for manual cleanup after inspection.

### 8. Surfaces

#### Dashboard

`memory-lane dashboard` should include a compact human-readable continuity section. It should show counts and short id lists, not memory text.

`memory-lane dashboard --json` should include the full structured `continuityHints` summary.

#### Status and doctor

`memory-lane status --json` and `memory-lane doctor --json` should include `continuityHints`.

Human `status`/`doctor` output may remain unchanged or include a compact count-only line if that can be done without noise. JSON parity is required; human output is optional for this slice.

#### MCP status

MCP `memory_status` should include the same text-free `continuityHints` summary so MCP clients can notice hints without calling CLI dashboard.

#### Lifecycle

No lifecycle injection changes in Slice 4. Lifecycle bounded notices remain Phase 16 Slice 5.

## Proposed types

Exact names may change during implementation, but the shape should stay text-free and stable enough for CLI/MCP consumers.

```ts
export type ContinuityHintCode =
  | "superseded-visible"
  | "operating-agreement-overlap"
  | "project-global-overlap"
  | "newer-approved"

export interface ContinuityHintMemoryMetadata {
  id: string
  status: "approved"
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

## Scope boundaries

Slice 4 must not add:

- semantic duplicate detection
- LLM stale-memory analysis
- new memory record fields
- `workstreamId` or thread metadata
- recall/retrieval filtering changes
- recall deprioritization for superseded memories
- lifecycle notices or injection changes
- automatic cleanup
- MCP mutation tools
- automatic `update`, `replace`, `supersede`, or `delete` suggestions
- Obsidian-specific behavior changes
- compaction changes

## Testing requirements

Core tests should cover:

- superseded approved visible hint
- operating-agreement overlap hint
- project/global overlap hint
- newer-approved hint when `since` is provided
- no text leakage in continuity hint output
- project scope filtering: current project plus global by default
- no hints for pending/rejected/deleted memories except where existing operating-agreement/freshness helpers already exclude them

CLI tests should cover:

- `dashboard --json` includes continuity hints
- dashboard human output includes compact continuity counts/actions without memory text
- `status --json` and `doctor --json` include continuity hints

MCP tests should cover:

- `memory_status` includes continuity hints
- MCP continuity hints remain text-free
- `projectPath` affects project-scoped hints consistently with existing status/freshness behavior

## Documentation requirements

Update README and skill docs to explain:

- what continuity hints are
- that they are read-only and text-free in status/MCP surfaces
- that superseded memories remain approved and visible in this slice
- that hints invite inspection, not automatic cleanup
- that workstream discovery is a future direction, while Slice 4 only adds deterministic metadata hints

Update ROADMAP/HANDOFF when implementation completes.
