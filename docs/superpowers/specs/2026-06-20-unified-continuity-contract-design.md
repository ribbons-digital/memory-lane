# Unified Continuity Contract Design

## Goal

Memory Lane should provide one canonical continuity experience across CLI-hook harnesses, MCP clients, pi, Claude, Codex, and future harnesses. When a user asks “what did we last work on, what was accomplished, and what is next?”, each harness should have the same authoritative Memory Lane read path instead of improvising from recall, injected context, or stale project documents.

## Problem

Current continuity behavior is fragmented by harness capability:

- Claude Code CLI can combine lifecycle-injected Memory Lane context with shell/git inspection.
- MCP clients have explicit tools, but no lifecycle hooks, and may choose recall instead of review/status.
- pi receives read-only lifecycle context and manual tools, but prompt answers may still depend on injected relevant memories.
- Codex hooks can inject context, but answers can still over-trust stale recall or stale documents.

The underlying product issue is not a single stale memory. Memory Lane lacks a first-class, shared continuity read model that all harnesses can call for the same project-scoped continuity facts, warnings, and recommended inspection steps.

## Product principle

Memory Lane owns continuity semantics. Harness adapters own transport and rendering. Models explain the result to the user.

This means the core should produce one structured continuity result. CLI, MCP, lifecycle guidance, and future adapters should expose or point to that result rather than implementing separate continuity rules.

## Canonical term

A **continuity read model** is a read-only, project-scoped summary of Memory Lane continuity state intended for resumption/status questions. It combines approved project state, pending continuity candidates, freshness/hygiene signals, operating-agreement metadata, and harness capability notes into a bounded structured result. It does not mutate memories, approve pending records, run cleanup, or replace repository inspection when current repo access is available.

## First slice scope

Add a canonical continuity read model in `@memory-lane/core`, then expose it through:

```bash
memory-lane continuity --json
```

and MCP:

```ts
memory_continuity({ projectPath })
```

A human CLI formatter may be included if small, but JSON is the authoritative contract for this slice.

## Non-goals

This slice does not:

- auto-capture new checkpoints;
- approve, reject, rescope, supersede, or delete memories;
- change recall ranking;
- inject more lifecycle context by default;
- add workstream/thread ids;
- inspect git history directly from core;
- replace project repo inspection when the harness has shell/file access;
- add new config flags.

## Data contract

The core result should be deterministic and bounded. Proposed shape:

```ts
interface ContinuityReadModel {
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

interface ContinuityMemoryPreview {
  id: string
  status: "approved" | "pending"
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  kind?: MemoryKind
  provenance?: MemoryProvenance
  createdAt: string
  updatedAt: string
  preview: string
  checkpointCandidate?: CheckpointCandidateMetadata
}

interface ContinuityWarning {
  code:
    | "pending-continuity-newer-than-approved"
    | "no-project-scope"
    | "scope-hygiene-candidate"
    | "operating-agreement-overlap"
    | "mcp-explicit-tools-only"
  severity: "info" | "review" | "warning"
  message: string
  memoryIds?: string[]
  workflowAreas?: WorkflowArea[]
  suggestedActions?: string[]
}

interface ContinuityHarnessGuidance {
  summary: string[]
  cli: string[]
  mcp: string[]
}
```

The exact TypeScript names can change during implementation, but the returned semantics should remain stable.

## Selection rules

### Project scope

Use the existing `MemoryEngine` project scope resolution. If no project scope is available, return `projectScope: "none"` and include a `no-project-scope` warning plus MCP guidance to pass `projectPath`.

### Latest approved continuity

Select latest approved project-scoped memory that is useful for continuity, preferring these kinds in order when timestamps are close:

1. `project_checkpoint`
2. `session_summary`
3. `decision`
4. `project_fact`

Also include latest approved global memory metadata/preview separately only when useful for explaining harness/workflow behavior. Global memories must not be presented as project progress.

### Pending continuity candidates

Include bounded pending records that are likely continuity-relevant:

- pending memories classified by `classifyCheckpointCandidate`;
- pending `kind: "project_checkpoint"`;
- pending `kind: "session_summary"`;
- project-scoped pending memories only, plus global pending memories only if the caller asks for all-scope in a later slice.

Default cap: five pending continuity previews.

Pending records must be clearly marked pending. They can inform the agent that newer state may exist, but they are not durable approved facts.

### Text previews

Unlike `status` and `doctor`, this continuity surface may include bounded text previews because its purpose is to answer continuity questions. Previews should be short, secret-filtered, and capped per memory. Suggested first cap: 240 characters per preview.

Status/doctor/MCP `memory_status` remain text-free.

### Warnings

The first slice should emit warnings when:

- no project scope is active;
- pending continuity candidates are newer than the latest approved project continuity record;
- existing continuity hints include scope hygiene candidates;
- existing continuity hints include operating agreement overlap;
- the caller is MCP and should understand explicit tools do not run lifecycle hooks.

### Suggested actions

The result should recommend inspection actions without performing mutation:

- `memory-lane continuity --json`
- `memory-lane review --json`
- `memory-lane list --json`
- `memory-lane agreements --json`
- `memory-lane status --json`

MCP guidance should name MCP tools:

- `memory_continuity`
- `memory_review`
- `memory_list`
- `memory_status`

If pending continuity exists, suggested actions should include review first.

## CLI behavior

Add:

```bash
memory-lane continuity [--json]
```

`--json` returns the authoritative envelope. Human output, if included, should be compact:

- project scope;
- latest approved project checkpoint/session summary preview;
- pending continuity count and IDs/previews;
- warnings;
- suggested next inspection commands.

The human formatter must not dump long memory bodies.

## MCP behavior

Add MCP tool `memory_continuity` with optional `projectPath`.
Later workstream-discovery and routing-hygiene slices also added optional `query` for read-only workstream pointers and sharpened the tool description for broad prior-work, next-action, project-status, resume, and handoff-style prompts.

Tool description should be explicit:

> Use this for broad prior-work, project continuity, resumption, “last worked on,” “what was accomplished,” “what is next,” project-status, resume, and handoff-style questions.
> Use this before `memory_recall` for continuity questions.
> Pass `projectPath` for project-scoped results in desktop MCP clients.
> Pass `query` for read-only workstream discovery pointers.

MCP output should use the same core shape as CLI.
It may include a note that MCP provides explicit tools only and does not run lifecycle hooks.

## Lifecycle guidance alignment

Update prompt-time continuity guidance so lifecycle hooks tell agents to use the canonical surface first:

- CLI-capable harnesses: `memory-lane continuity --json`.
- MCP clients: `memory_continuity({ projectPath })`.
- Recall remains useful for topic search, but not as the first authority for continuity status.

This guidance change must remain bounded and policy-governed. It should not inject additional memory bodies beyond existing policy behavior.

## Testing strategy

Follow TDD for implementation.

Core tests:

1. Builds continuity read model with latest approved project checkpoint preview.
2. Includes pending checkpoint/session-summary candidates as pending continuity.
3. Warns when pending continuity is newer than latest approved project continuity.
4. Warns when no project scope is active.
5. Keeps status/doctor text-free; continuity previews are bounded and secret-filtered.

CLI tests:

1. `memory-lane continuity --json` returns the core-shaped result with project scope metadata.
2. Human `memory-lane continuity` output is compact and labels pending vs approved.
3. Help output documents the command.

MCP tests:

1. `memory_continuity` applies `projectPath` before reading scope.
2. MCP result matches CLI/core semantics for the same memory setup.
3. Tool registry exports `memory_continuity` and description directs continuity questions away from recall-only use.

Lifecycle/docs tests if existing tests cover guidance strings:

1. Prompt continuity guidance mentions `memory-lane continuity --json` and MCP `memory_continuity`.
2. Existing policy modes still govern guidance rendering.

## Documentation updates

Update:

- `CONTEXT.md` with the continuity read model term.
- `README.md` CLI command list and MCP tool list.
- Prompt-time continuity guidance docs to say continuity questions should use the continuity surface first.
- `ROADMAP.md` Phase 17 or a new “Unified Continuity Contract” slice to mark this work as the current bridge from review labels to consistent cross-harness continuity.

## Acceptance criteria

This goal slice is complete when:

- CLI exposes `memory-lane continuity --json`.
- MCP exposes `memory_continuity`.
- Both call the same core read model.
- Both produce matching continuity semantics for the same project memory set.
- Pending checkpoint/session-summary candidates are surfaced as pending, not treated as approved facts.
- The result warns when pending continuity is newer than approved project continuity.
- Lifecycle prompt guidance points continuity questions to the canonical surface first.
- Docs explain that recall is not authoritative for continuity questions.
- Tests pass with `pnpm build && pnpm test`.

## Open follow-up after this slice

After this contract exists, the next valuable slice is review-first checkpoint capture from high-confidence evidence. That follow-up should use the continuity read model as the read side and remain pending/review-first on the write side.
