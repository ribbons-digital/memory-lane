# Operating Agreement Memories Design

## Status

Draft for review. This spec covers **Phase 16 Slice 2 — Canonical workflow / operating-agreement memories**.

## Goal

Let users and agents explicitly discover the current operating agreements that should guide work in a project, without lifecycle injection, memory mutation, new revision fields, or broad preference layering.

## Background

Phase 16 Slice 1 added read-only freshness/status detection so sessions can see whether approved visible memories changed after a checkpoint timestamp. Slice 2 builds on that foundation by giving agents an authoritative way to find small working contracts such as project loops, review gates, PR processes, release processes, and tooling workflow preferences.

The concrete product driver is the loop-memory refinement failure: when the user refined the existing working loop, Memory Lane had multiple approved workflow-like memories with overlapping content and different `kind` values. Slice 2 should make the applicable agreements visible and make overlap obvious, while leaving explicit update/supersede semantics to a later slice.

## Domain terminology

`CONTEXT.md` now defines:

- **Operating agreement memory** — an approved memory describing how agents should work for a user, project, or workflow.
- **Workflow area** — a coarse label for the kind of agreement, initially `project-loop`, `review-gate`, `pr-process`, `release-process`, `tooling-preference`, or `other`.
- **Primary operating agreement** — the best currently applicable agreement for a workflow area.
- **Related operating agreement candidate** — an approved visible agreement-like memory that overlaps with a primary agreement or was matched heuristically.

These terms are deliberately separate from future revision/supersede concepts. Slice 2 must not claim that related candidates are superseded or safe to delete.

## Decisions

### 1. Convention-first, no new record fields

Slice 2 uses existing memory fields:

- `status`
- `kind`
- `scope`
- `category`
- `source`
- `updatedAt`
- `provenance`
- `text`

It does not add schema fields such as `canonical`, `supersedes`, `supersededBy`, or `revisionOf`. Those belong to Phase 16 Slice 3.

### 2. Explicit kind first, heuristic compatibility second

Operating agreement candidates are selected from approved visible memories in two ways:

1. **Explicit match:** `kind === "workflow_rule"`
2. **Heuristic match:** `kind` is `preference` or `project_fact` and the text contains operating-agreement language.

Heuristic matches should expose `recommendedKind: "workflow_rule"` so future cleanup/revision tooling can help migrate them deliberately.

### 3. Workflow areas

The first selector recognizes these workflow areas:

- `project-loop` — loop, workflow, working preference, collaboration workflow, operating agreement
- `review-gate` — review gate, code review, spec review, quality review, approval gate
- `pr-process` — PR, pull request, branch, merge, worktree cleanup
- `release-process` — release, tag, version, publish
- `tooling-preference` — package manager, installer/onboarding, harness setup, command preference
- `other` — agreement-like but not classified by the earlier areas

The area classifier is intentionally simple and deterministic. It is not semantic search and does not call an LLM.

### 4. Primary plus related candidates

The selector returns:

- `primary`: best agreements likely to apply now
- `relatedCandidates`: overlapping or heuristic candidates that should remain visible
- omitted counts for each list

Primary selection prefers:

1. explicit `workflow_rule` over heuristic matches
2. project scope over global scope for the same workflow area
3. newer `updatedAt` over older records

The selector should choose at most one primary agreement per workflow area where possible. It must not silently hide overlap; non-primary candidates for the same area should appear in `relatedCandidates` when within the related limit.

### 5. Scoping follows `list`

By default, operating agreements are selected from memories visible to the current project scope:

- matching project-scoped memories
- global memories

`--all` is an admin/debug mode that bypasses project scoping. If no project scope is active, the default selection is global-only and should include a note recommending `--project <path>` for project-aware agreements.

### 6. Text in explicit command only

`memory-lane agreements` returns selected agreement text by default because the command is explicitly for reading operating contracts.

Status surfaces remain text-free:

- `memory-lane status --json`
- `memory-lane doctor --json`
- MCP `memory_status`

These surfaces should expose counts and metadata only.

### 7. No lifecycle injection in this slice

Slice 2 does not change `SessionStart`, `UserPromptSubmit`, pi lifecycle handling, Claude hooks, Codex hooks, or context injection. Lifecycle bounded notices remain Phase 16 Slice 5.

### 8. No cleanup commands or suggestions

Slice 2 may report `relatedCandidates` and overlap metadata, but it must not suggest destructive cleanup commands. It should not recommend `delete`, `reject`, or automatic `update` operations. Explicit update/replace/supersede primitives are Phase 16 Slice 3.

## Proposed API shape

### Core types

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
  scope: MemoryScope
  category: MemoryCategory
  kind?: MemoryKind
  source: MemorySource
  updatedAt: string
  createdAt: string
  provenance?: MemoryProvenance
  workflowArea: WorkflowArea
  matchReason: OperatingAgreementMatchReason
  recommendedKind?: "workflow_rule"
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

export interface OperatingAgreementList {
  projectScope: string | "none"
  primary: OperatingAgreementSelection[]
  relatedCandidates: OperatingAgreementSelection[]
  omittedPrimaryCount: number
  omittedRelatedCandidateCount: number
  notes: string[]
}
```

The summary type is used for status/doctor/MCP and must not include memory text. The list type is used by the CLI command and may include full memory records because `agreements` is an explicit retrieval command.

### Core helper

Add a helper such as:

```ts
selectOperatingAgreements(memories, {
  projectScopeKey,
  all,
  area,
  limit,
  relatedLimit,
})
```

The helper should be pure and read-only.

### Engine methods

Add methods such as:

```ts
engine.operatingAgreements(opts?: {
  all?: boolean
  area?: WorkflowArea
  limit?: number
  relatedLimit?: number
}): OperatingAgreementList

engine.operatingAgreementSummary(opts?: {
  all?: boolean
  area?: WorkflowArea
  limit?: number
  relatedLimit?: number
}): OperatingAgreementSummary
```

`doctor()` should include `operatingAgreements: engine.operatingAgreementSummary()` with text-free metadata.

## CLI surface

### New command

```bash
memory-lane agreements
memory-lane agreements --json
memory-lane agreements --area project-loop
memory-lane agreements --area pr-process --json
memory-lane agreements --all
memory-lane agreements --limit 5 --related-limit 10
```

Defaults:

- `limit`: 5
- `relatedLimit`: 10
- scope: current project + global
- text: included, because this is the explicit retrieval command

Human output should show:

- project scope
- primary agreements by workflow area
- scope, kind, match reason, recommended kind where applicable
- full selected agreement text
- related candidate count and compact related candidate entries
- a note that related candidates are not superseded and no cleanup is performed

JSON output should include full selected memory records in `primary` and `relatedCandidates`, plus metadata fields.

### Status and doctor

`memory-lane status --json` and `memory-lane doctor --json` should include text-free operating agreement summary metadata.

Human `doctor` may show a compact section such as:

```text
Operating agreements:
  primary: 3
  related candidates: 2
  areas: project-loop, pr-process, tooling-preference
  Use `memory-lane agreements` to inspect agreement text.
```

Human `status` may remain concise and include counts only if easy to read. It should not print agreement text.

## MCP surface

MCP `memory_status` should include text-free operating agreement summary metadata through the existing status payload.

Slice 2 does not add a `memory_agreements` MCP tool. Full-list MCP parity can follow after CLI semantics are proven.

## Privacy and safety

- Only approved memories are eligible.
- Status/doctor/MCP status output must not include memory text or previews.
- `memory-lane agreements` includes text because it is an explicit retrieval command.
- No writes, updates, deletes, rejects, approvals, compaction, embedding changes, lifecycle injection, or autosave behavior are added.
- Related candidates are informational only.

## Testing requirements

Core tests should cover:

- explicit `workflow_rule` selection
- heuristic compatibility selection from `preference` and `project_fact`
- exclusion of generic global preferences
- workflow area classification
- project + global default visibility
- global-only behavior when no project scope exists
- `--all`/all-scope behavior through helper options
- primary ranking: explicit kind, project scope, recency
- related candidates for overlap
- limits and omitted counts
- text-free summary metadata

CLI tests should cover:

- `memory-lane agreements --json` returns primary and related candidates with text
- `memory-lane agreements --area project-loop --json` filters by area
- `memory-lane agreements --all --json` bypasses project scope
- human output is readable and includes agreement text for primary agreements
- status/doctor JSON include operating agreement summary without memory text
- invalid area/limit values fail clearly

MCP tests should cover:

- `memory_status` includes text-free operating agreement summary
- `projectPath` is applied before agreement summary computation
- generic memory text does not leak into status output

Docs tests are not required unless existing docs test patterns make them cheap.

## Documentation updates

Update:

- `README.md` — document `memory-lane agreements` and status summary behavior
- `skills/memory-lane/SKILL.md` — add command and guidance for explicit agreement retrieval
- `ROADMAP.md` — mark Slice 2 complete after implementation
- `HANDOFF.md` — record completed slice and next recommended Slice 3
- `CONTEXT.md` — already updated during grill-with-docs with operating agreement terminology

## Out of scope

- New memory record fields such as `canonical`, `revisionOf`, `supersedes`, or `supersededBy`
- CLI update/replace/supersede commands
- MCP full-text `memory_agreements` tool
- Lifecycle injection or bounded notices
- Search/indexing changes
- Broad preference layering
- Automatic cleanup, consolidation, or duplicate deletion
- LLM/semantic classification of agreements

## Open decisions

None. The user approved the core design decisions during grill-with-docs.
