# Phase 21 Slice 7 — Orchestrator/Session Summary Hygiene Design

Date: 2026-06-26
Branch: `docs/phase-21-slice-7-summary-hygiene`

## Status

Draft design for review. Implementation should begin only after user approval and a separate implementation plan.

## Goal

Reduce durable continuity noise from orchestrator, subagent, and parallel-agent task chatter so Memory Lane records one useful workstream trail instead of many operational summaries.

This slice combines:

1. **Future prevention:** deterministic filters that prevent obvious noisy session-summary candidates from being written.
2. **Read-only review hints:** metadata on review surfaces that identifies existing pending memories likely to be subagent/task chatter, without mutating them.

## Background

Phase 21 Slice 6 completed read-only workstream discovery and follow-up routing/hygiene hardening through `v0.2.33`. Dogfooding and cross-harness review exposed another continuity risk: parallel-agent or orchestrator workflows can produce multiple pending summaries about the mechanics of review, delegated subagent tasks, acceptance finalization, or memory review queues rather than durable project progress.

Existing protections already help:

- `isMetaTaskPromptText()` skips raw delegated-subagent and acceptance-finalization prompts at the storage boundary.
- Phase 20 Slice 2 debounces duplicate session summaries by provenance/content and removes obvious Memory Lane review-management chatter from generated summaries.
- Review surfaces group by project/source/kind/provenance.

The remaining gap is summaries that are not exact raw task prompts and not exact duplicates, but are still operational chatter. Examples:

- “Subagent A reviewed the plan and reported APPROVED.”
- “Acceptance finalization compared the work to the contract.”
- “Next step: approve/reject these memory IDs.”
- “Worker 2 completed task 3 only; coordinator should collect results.”

These are useful inside an orchestration run, but poor durable continuity records unless they include a durable project outcome.

## Product principles

- Keep Memory Lane review-first: new generated records stay pending unless explicitly approved.
- Prevent only obvious noise before write; do not infer broad semantic duplicates.
- Existing records must not be auto-rejected, deleted, superseded, or rewritten.
- Prefer deterministic local heuristics over LLM classification.
- Keep the first slice schema-light and harness-neutral.
- Do not add first-class workstream IDs in this slice.

## Domain terms

**Operational summary chatter**: Generated memory text whose durable content is primarily about agent orchestration mechanics, delegated subagent instructions/results, acceptance-finalization mechanics, review-status labels, or Memory Lane review queue management, rather than project decisions, completed code/docs, blockers, follow-up work, or user preferences.

**Durable workstream outcome**: A compact fact useful across sessions: shipped release, merged PR, implemented/fixed feature, design decision, blocker/root cause, next user-valuable step, or project/user preference.

**Review hygiene hint**: Read-only metadata on existing review surfaces indicating that a pending memory may be operational summary chatter. It is not a deletion/rejection command and does not change memory status.

## Recommended approach

Implement **Phase 21 Slice 7a — deterministic session-summary hygiene and review hints**.

Add a small shared classifier in core or lifecycle that detects likely operational summary chatter. Use it in two places:

1. **Pre-write filtering in `handleSessionEnd`:** after LLM summary cleanup and before duplicate filtering/save candidate return. If the cleaned summary is primarily operational chatter and has no durable workstream outcome signal, return no candidate.
2. **Read-only review hints:** expose `reviewHygiene` metadata for pending memories that look like operational summary chatter, especially `kind: "session_summary"` / `source: "session-summary"` records and existing meta-task-like pending records.

The classifier should be deterministic and conservative: only flag when operational signals dominate and durable outcome signals are absent.

## Alternatives considered

### Option A — Future prevention only

Pros:
- Smallest behavior change.
- Directly stops new noise.

Cons:
- Existing pending noise remains hard to triage.
- Does not help the user see why old records look suspect.

Rejected because the user chose read-only hints as well.

### Option B — Future prevention plus read-only review hints

Pros:
- Stops new obvious noise at the source.
- Helps triage existing pending noise without mutating data.
- Fits current review-first workflow and existing review grouping.

Cons:
- Adds a small metadata surface to review outputs.
- Requires careful wording so hints do not feel like automatic cleanup.

Chosen.

### Option C — Metadata/schema-first orchestration model

Pros:
- Cleaner long-term modeling for parent/child sessions and orchestrator runs.

Cons:
- Premature for current evidence.
- Requires schema migration/design across harnesses.
- Risks expanding scope into first-class workstream IDs.

Deferred.

### Option D — Auto-consolidation or cleanup command

Pros:
- Could clean old noise aggressively.

Cons:
- Violates current review-first posture.
- Too risky without evals and stronger user controls.

Rejected.

## Detection model

### Operational chatter signals

Initial deterministic patterns should cover:

- Delegated subagent framing:
  - “delegated subagent”
  - “subagent session”
  - “worker/agent completed task N only”
  - “coordinator should collect”
- Acceptance/review mechanics:
  - “acceptance finalization”
  - “compare the current work to the acceptance contract”
  - “report status as APPROVED / CHANGES_REQUESTED / DONE_WITH_CONCERNS / BLOCKED / NEEDS_CONTEXT”
- Memory review queue management:
  - “approve/reject these memory IDs”
  - “run/use/open memory-lane review”
  - lists dominated by memory IDs rather than durable decisions
- Orchestration status-only summaries:
  - “Task N only”
  - “reviewer returned approved”
  - “subagent reported status”

### Durable outcome signals

A candidate should not be suppressed solely because it mentions subagents if it also includes durable project outcomes such as:

- Merged PR / release / tag / commit / branch completion.
- Implemented, fixed, validated, or shipped a feature.
- Concrete design decision or user preference.
- Root cause and future prevention procedure.
- Next step with clear user/project value.
- Explicit blocker that should persist.

### Conservative rule

Suppress before write only when:

1. The candidate is a generated `session_summary` or equivalent lifecycle summary candidate.
2. Operational chatter signals are present.
3. Durable outcome signals are absent or too weak.
4. The remaining cleaned text would not be useful as a project continuity memory.

For review hints, flag more broadly but still label as “possible” / “likely” rather than asserting deletion.

## API and surface design

### Shared helper

Add a helper with a contract similar to:

```ts
export interface SummaryHygieneAnalysis {
  operationalChatter: boolean
  durableOutcome: boolean
  action: "keep" | "suppress" | "hint"
  reasons: string[]
}

export function analyzeSummaryHygiene(text: string, options?: {
  kind?: MemoryKind
  source?: MemorySource
}): SummaryHygieneAnalysis
```

Location can be decided during planning. Prefer core if review surfaces need it directly; lifecycle-only would duplicate logic in CLI/MCP.

### Session-end handling

`handleSessionEnd` should call the helper after `cleanGeneratedSummary(raw)` and before constructing/returning candidates.

If action is `suppress`, return `[]` with no user-facing hook noise, matching current duplicate/NO_DURABLE_MEMORY behavior. Existing debug-count paths may show zero candidates, but no new prominent message is needed.

### Review hints

Add optional metadata to review outputs for pending memories:

```ts
reviewHygiene?: {
  operationalChatter: boolean
  reasons: string[]
  suggestedAction: "inspect" | "consider-rejecting"
}
```

Human output should be compact, for example:

```text
[review hint: likely operational chatter — delegated subagent task, no durable outcome]
```

MCP/JSON output should expose structured fields and keep memory text behavior unchanged.

This is read-only. It must not change counts, status, approvals, rejection, deletion, recall, continuity selection, or storage.

## Scope

### In scope

1. Deterministic hygiene helper for generated summaries and pending review records.
2. Pre-write suppression in `handleSessionEnd` for obvious operational summary chatter without durable outcomes.
3. Read-only review hints in CLI `review` human/JSON output.
4. Matching read-only review hints in MCP `memory_review` output if the CLI metadata is exposed through shared review formatting or handler code.
5. Tests covering suppression, non-suppression when durable outcomes exist, and review hint metadata.
6. Docs updates to `ROADMAP.md`, `HANDOFF.md`, and relevant user docs/help if output changes.

### Out of scope

- Auto-approval, auto-rejection, auto-delete, auto-supersede, or cleanup.
- New CLI cleanup/consolidation commands.
- First-class workstream IDs, session hierarchy schema, or parent/child provenance fields.
- Recall ranking, continuity ranking, lifecycle injection, token retuning, semantic retrieval changes, or embedding behavior.
- Raw transcript indexing or storage.
- LLM classifier for noisy summaries.
- Migration of old pending memories.
- Broad fuzzy duplicate detection.

## Acceptance criteria

1. A generated session summary dominated by delegated subagent/acceptance-finalization chatter with no durable project outcome returns no candidate from `handleSessionEnd`.
2. A generated session summary that mentions subagents but includes a durable outcome, such as a merged PR, shipped release, implementation decision, root cause, or next project step, is kept.
3. Existing duplicate debounce behavior remains intact.
4. CLI `memory-lane review` marks likely operational summary chatter with a compact read-only hint.
5. CLI `memory-lane review --json` exposes structured review hygiene metadata without changing memory text, status, or grouping semantics.
6. MCP `memory_review` exposes equivalent metadata or a documented subset if the MCP surface intentionally stays smaller.
7. Existing `isMetaTaskPromptText()` behavior remains compatible; raw delegated task prompts are still skipped at save/suggest boundaries.
8. Full verification passes:
   - `pnpm build`
   - `pnpm test`
   - `git diff --check`

## Risks and mitigations

### Risk: suppressing a useful summary

Mitigation: suppress only when operational signals are present and durable outcome signals are absent. If uncertain, keep the candidate and add a review hint instead.

### Risk: hint wording nudges users to delete too aggressively

Mitigation: use “likely operational chatter” and “inspect/consider rejecting” language. Do not generate direct reject/delete commands.

### Risk: classifier grows into fragile keyword sprawl

Mitigation: keep pattern groups named and tested. Add examples from real dogfood only. Do not attempt broad semantic interpretation.

### Risk: duplicating logic between lifecycle, CLI, and MCP

Mitigation: place the helper in a shared package consumed by both lifecycle and review handlers.

## Test plan

### Core/helper tests

- Flags delegated subagent and acceptance-finalization summaries with no durable outcome.
- Does not suppress summaries that include concrete project outcomes.
- Flags Memory Lane review-management-only summaries.
- Handles mixed text conservatively.

### Lifecycle tests

- `handleSessionEnd` returns no candidates for operational-only generated summary.
- `handleSessionEnd` keeps durable summary mentioning subagents.
- Existing duplicate debounce tests still pass.

### CLI tests

- Human `review` output includes a compact review hygiene hint for suspect pending summaries.
- JSON `review` output includes structured `reviewHygiene` metadata.
- Normal pending summaries are unchanged.

### MCP tests

- `memory_review` includes review hygiene metadata for suspect pending summaries.
- Filters by kind/source/provenance continue working.

## Documentation updates

- `ROADMAP.md`: mark Slice 7 design accepted/implemented as appropriate during the work.
- `HANDOFF.md`: record current slice, constraints, and release target when implementation lands.
- README/help text: update only if human review output gains visible hint text that needs explanation.

## Implementation plan preview

The implementation plan should be a separate document and likely use this order:

1. Add shared helper and focused tests.
2. Integrate suppression into `handleSessionEnd` with lifecycle tests.
3. Add CLI review metadata/human hint tests and implementation.
4. Add MCP review metadata tests and implementation.
5. Update docs, run full verification, request review, then PR.

## Next step

After user approval of this design, write a detailed implementation plan for Phase 21 Slice 7a. Do not begin implementation from this design document alone.
