# Global Memory Hygiene Hints Design

## Status

Draft — follow-up slice after readable context labels, pending review visibility, and project-first SessionStart selection.

## Context

Manual cross-harness testing showed that some injected global memories can feel surprising in an unrelated project. The previous slices made the situation more understandable and less disruptive:

- readable memory context labels show whether injected memories are current-project, global, or other visible project memories;
- pending review reminders make background suggestions discoverable;
- project-first SessionStart selection makes current-project memories appear before globals when a project scope exists.

The remaining issue is hygiene: some approved global memories may actually describe a specific project, session, release, checkpoint, or repository workflow. Those memories should not be automatically res scoped or deleted, but users need an authoritative way to find likely cases for manual review.

Existing `continuityHints` are a good fit: they are read-only, text-free, already surfaced through dashboard/status/doctor/MCP, and explicitly avoid mutation.

## Goals

1. Surface approved global memories that look project-specific as read-only hygiene candidates.
2. Keep the signal text-free: expose ids and structured reasons, not memory bodies.
3. Reuse existing authoritative status/dashboard/doctor/MCP surfaces via `continuityHints`.
4. Provide inspection-first suggested actions, not cleanup or mutation commands.
5. Avoid changing recall, injection, selection, ranking, memory scope, or memory status.
6. Keep detection conservative enough to avoid noisy “everything is suspicious” output.

## Non-goals

- Do not automatically change a memory's scope, category, kind, status, or text.
- Do not add `memory-lane cleanup` or rescope commands.
- Do not hide or deprioritize the flagged memories in recall/injection.
- Do not change SessionStart project-first ordering or prompt-time recall ranking.
- Do not flag pending memories; pending records already go through `memory-lane review`.
- Do not expose full memory text in status, doctor, dashboard JSON continuity hints, MCP status, or lifecycle continuity notices.
- Do not add config flags.

## Terminology

Add a glossary term to `CONTEXT.md`:

**Scope hygiene candidate**:
An approved visible memory whose scope metadata may be broader than its content warrants, such as a global memory that appears to describe a specific project, repository, session, checkpoint, release, or implementation detail. It is an inspection signal only; Memory Lane does not automatically rescope, delete, reject, or supersede it.
_Avoid_: Scope error, automatic cleanup, rejected memory, rescope recommendation

## Proposed behavior

Extend `ContinuityHintSummary` with a structured list:

```ts
scopeHygieneCandidates: Array<{
  id: string
  category: MemoryCategory
  scope: MemoryScope
  source: MemorySource
  createdAt: string
  updatedAt: string
  kind?: MemoryKind
  provenance?: MemoryProvenance
  reason: ScopeHygieneReason
}>
```

Add a new continuity hint code:

```ts
"scope-hygiene-candidate"
```

Candidate detection should consider approved global memories only.

### Conservative candidate reasons

Start with high-signal reasons:

1. `project-category-global-scope`
   - `scope.type === "global"` and `category === "project"`.
   - A memory categorized as project but scoped globally is likely worth inspection.

2. `project-kind-global-scope`
   - `scope.type === "global"` and `kind` is one of:
     - `project_fact`
     - `project_checkpoint`
     - `session_summary`
   - These kinds usually describe project/session state.

3. `project-path-global-scope`
   - `scope.type === "global"` and text contains path-like project/repository markers such as:
     - `/Users/.../projects/...`
     - `~/projects/...`
     - `packages/<name>/src/...`
     - `docs/superpowers/...`
   - This reason may inspect text internally, but output must remain text-free.

Do not flag global `preference` or `workflow_rule` records solely because they contain generic words like “project”, “PR”, “roadmap”, “branch”, or “release”. Those may be valid global workflow preferences.

### Output behavior

When candidates exist:

- Add one hint:

```ts
{
  code: "scope-hygiene-candidate",
  severity: "review",
  message: "Some global memories look project-specific and may need manual scope review.",
  count: <candidate count>,
  memoryIds: <candidate ids up to maxIds>,
  suggestedActions: ["memory-lane list --json"]
}
```

- Include `scopeHygieneCandidates` metadata up to `maxIds`.
- Add the normal continuity hint note: no mutation is performed.

When no candidates exist:

- `scopeHygieneCandidates` is an empty array.
- No hint is added.

## Surfaces

Because `continuityHints` already flows through these surfaces, they should expose the new signal automatically once the summary type changes:

- `memory-lane dashboard --json`
- `memory-lane status --json`
- `memory-lane doctor --json`
- human dashboard/doctor continuity hint summaries, as compact hint codes only
- MCP `memory_status`

This slice should not add text-heavy human output. It is enough for human summaries to show the hint code and suggest dashboard/list inspection.

## Acceptance criteria

1. `buildContinuityHints` reports approved global project/category/kind/path-like memories as `scopeHygieneCandidates` with text-free metadata and reason codes.
2. Pending, deleted, rejected, project-scoped, and ordinary global preference/workflow-rule memories are not flagged.
3. A `scope-hygiene-candidate` continuity hint appears only when candidates exist.
4. Suggested actions are inspection-first and non-mutating.
5. Status/dashboard/doctor/MCP JSON expose the candidate metadata without memory text.
6. Human dashboard/doctor output remains compact and text-free.
7. No recall, injection, selection, ranking, save, review, cleanup, config, or MCP mutation behavior changes.
8. README documents scope hygiene hints as inspection signals.
9. `CONTEXT.md` includes the `Scope hygiene candidate` glossary term.

## Risks and mitigations

- **Risk:** Heuristics flag valid global memories.
  - **Mitigation:** Start only with high-signal metadata mismatches and path-like content. Do not flag generic project/process language.

- **Risk:** Users expect automatic cleanup.
  - **Mitigation:** Wording says “manual scope review” and suggested action is `memory-lane list --json`, not mutation commands.

- **Risk:** Text leaks through diagnostics.
  - **Mitigation:** Reuse metadata-only continuity hint patterns and add tests that JSON/human surfaces omit sentinel text.

- **Risk:** More hint noise in projects with many historical memories.
  - **Mitigation:** Respect existing `maxIds` and emit one aggregate hint.

## Follow-up slices

1. A dedicated approved-memory review/audit view for scope hygiene candidates.
2. Optional dry-run rescope/update proposals, only after explicit design.
3. Global preference layering/budgets in Phase 18.
