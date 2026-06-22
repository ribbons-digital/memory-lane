# Phase 21 Slice 2 — Review-Mode Handoff Proposals Design

## Status

Draft for review.

Opus 4.8 planning review recommended a thin read-only behavior slice instead of a docs-only slice: make `memory.handoffMode: "review"` observable by surfacing a bounded handoff proposal through existing continuity surfaces, while adding no lifecycle injection, no new tools, and no writes.

## Context

Phase 21 Slice 1 added the shared handoff-mode contract:

- `manual` is the default and behavior-active mode.
- `review` and `automatic` are valid declared values.
- Slice 1 kept `review` and `automatic` inert; they behaved like `manual` outside diagnostics.

Slice 2 intentionally supersedes the Slice 1 canonical review-mode diagnostic strings. After Slice 2, `review` becomes behavior-active only for read-only handoff proposals on explicit continuity surfaces. `manual` remains active for inspection-first behavior; `automatic` remains inactive.

Existing Memory Lane behavior already captures continuity-like records as pending review candidates:

- Session-end summaries are saved pending when confirmed/configured.
- Checkpoint/progress candidates are captured pending-by-default.
- `memory-lane review`, `memory_review`, `memory-lane continuity`, and `memory_continuity` already expose review and continuity information.

Slice 2 should not invent another capture path. It should make review mode mean: "show me a read-only proposal assembled from pending continuity candidates so I can approve or ignore it deliberately."

## Problem

Without a behavior slice, `review` mode remains a no-op. But implementing generation or injection now would be risky because:

- pending review-first continuity already exists;
- new lifecycle generation could double-write;
- SessionStart injection belongs to later `automatic` behavior;
- new commands/tools would expand the surface before the existing continuity surfaces are proven insufficient.

Users need one safe observable distinction: in `review` mode, Memory Lane should gather existing pending continuity candidates into a bounded handoff proposal on existing continuity surfaces.

## Goals

1. Make `memory.handoffMode: "review"` behavior-active in a read-only way.
2. Add a deterministic `handoffProposal` block to the continuity read model only in review mode.
3. Reuse existing pending continuity selection; do not add another classifier or capture path.
4. Surface the proposal through existing surfaces only:
   - `memory-lane continuity`
   - `memory-lane continuity --json`
   - MCP `memory_continuity`
5. Keep proposal output bounded, review-first, and safe:
   - no writes;
   - no approvals;
   - no lifecycle context injection;
   - no memory bodies in status/MCP diagnostics;
   - only bounded previews in continuity surfaces, consistent with existing continuity output.
6. Update docs and tests so users and future implementers understand that review mode proposes a handoff; it does not apply one.

## Non-goals

- No new lifecycle generation.
- No SessionStart/UserPromptSubmit injection of handoff bodies.
- No automatic approval, rejection, deletion, cleanup, consolidation, or refresh behavior.
- No new CLI command.
- No new MCP tool.
- No adapter payload changes.
- No schema migration.
- No raw transcript or tool-output capture.
- No recall/retrieval/ranking rewrite.
- No token budget retuning.
- No behavior for `automatic`; it remains declared but inactive in Slice 2.
- No per-project/global disable override beyond the existing `memory.handoffMode` config.

## Domain Terms

Add or refine in `CONTEXT.md`:

**Review-mode handoff proposal**:
A read-only aggregation of pending project-scoped continuity candidates assembled when `memory.handoffMode` is `review`. It helps a user inspect what Memory Lane would use as the next handoff trail if approved. It is not an approved fact, lifecycle injection, automatic summary, or cleanup recommendation.

**Handoff proposal item**:
A bounded preview and metadata pointer to an existing pending continuity candidate. Items are selected from the same pending continuity set already used by the continuity read model.

## Data Contract

Add types in `packages/core/src/types.ts`:

```ts
export interface HandoffProposalItem extends ContinuityMemoryPreview {}

export interface HandoffProposal {
  mode: "review"
  status: "pending-review"
  projectScope: string | "none"
  pendingCount: number
  items: HandoffProposalItem[]
  omittedCount: number
  suggestedActions: string[]
  notes: string[]
}
```

Add optional field to `ContinuityReadModel`:

```ts
handoffProposal?: HandoffProposal
```

Add `handoffMode?: HandoffMode` to `ContinuityReadModelOptions`.

### Proposal content

For Slice 2, a handoff proposal is present only when all are true:

1. `options.handoffMode === "review"`.
2. A project scope is active.
3. There is at least one pending project-scoped continuity candidate selected by the existing pending continuity logic.

When no project scope is active, omit `handoffProposal`; the existing `no-project-scope` warning remains the guidance. This avoids implying a global handoff proposal.

When no pending continuity candidates exist, omit `handoffProposal`; the continuity model remains compact.

`pendingCount` should be the total count of matching pending continuity candidates before preview/limit filtering.

`items` should reuse the same bounded preview objects as `pendingContinuity` and therefore share the existing `maxPendingContinuity` cap, defaulting to 5.

`omittedCount` should be `Math.max(0, pendingCount - items.length)`, covering both records omitted by the cap and records filtered out by preview safety.

`suggestedActions` must use existing commands only, for example:

```ts
[
  "memory-lane review --json",
  ...items.map((item) => `memory-lane approve ${item.id}`),
]
```

Bound approve suggestions to the visible `items`. Do not include reject/delete/cleanup suggestions.

`notes` should be deterministic strings, for example:

```ts
[
  "Review-mode handoff proposals are read-only; inspect and approve pending memories before relying on them as handoff state.",
  "No lifecycle context injection or automatic approval is performed.",
]
```

### Preview safety

The proposal must reuse existing `preview()` behavior in `continuity-read-model.ts`, including secret filtering through `containsLikelySecret`. If a pending candidate is filtered out by preview safety, it should not appear in `items`; `omittedCount` can cover it.

Slice 2 does not add new memory body output to status/doctor/MCP status surfaces. Continuity human/JSON already include bounded previews; proposal previews must use the same policy and cap.

## Behavior Contract

### `manual`

- Existing behavior remains unchanged.
- No `handoffProposal` is emitted.
- `MemoryEngine.doctor()` reports:
  - `handoffMode: "manual"`
  - `handoffModeBehaviorActive: true`
  - `handoffModeNote: "Current inspection-first behavior is active."`

### `review`

- Existing capture/review behavior remains unchanged.
- `MemoryEngine.continuity()` passes `handoffMode: "review"` into the read model.
- `buildContinuityReadModel()` emits a bounded `handoffProposal` when pending project continuity candidates exist.
- `MemoryEngine.doctor()` reports:
  - `handoffMode: "review"`
  - `handoffModeBehaviorActive: true`
  - `handoffModeNote: "Review mode is active for read-only handoff proposals; approve pending memories before relying on them as handoff state."`

### `automatic`

- Remains declared but inactive in Slice 2.
- No `handoffProposal` is emitted.
- No lifecycle injection behavior is added.
- `MemoryEngine.doctor()` reports:
  - `handoffMode: "automatic"`
  - `handoffModeBehaviorActive: false`
  - `handoffModeNote: "Declared for Phase 21; currently behaves like manual mode."`

## Integration Points

### Core

- `packages/core/src/types.ts`
  - Add `HandoffProposal`, `HandoffProposalItem`, optional `ContinuityReadModel.handoffProposal`, and `ContinuityReadModelOptions.handoffMode`.
- `packages/core/src/continuity-read-model.ts`
  - Build proposal from existing `pendingContinuityCandidates` and `pendingContinuity` only when `handoffMode === "review"` and project scope exists.
  - Do not mutate input memories.
- `packages/core/src/engine.ts`
  - Pass `this.getHandoffMode()` into `buildContinuityReadModel()`.
  - Update `handoffModeDoctor()` notes/behavior-active matrix.

### CLI

- `packages/cli/src/formatters.ts`
  - Human `memory-lane continuity` renders a compact `Review-mode handoff proposal` block after `Pending continuity` and before warnings/suggested actions.
  - JSON output automatically includes the `handoffProposal` field via the model.
  - Human output should not duplicate approve actions already listed in `suggestedActions` excessively; prefer a short block with count, visible ids/previews, and existing review/approve actions.

No `memory-lane status` or `memory-lane doctor` human expansion is required beyond the updated handoff-mode note already shown by `doctor`.

### MCP

- `memory_continuity` should include `handoffProposal` because it returns `engine.continuity({ caller: "mcp" })`.
- No new MCP tool.
- `memory_status` remains doctor/status diagnostics only; it does not include proposal previews.

### Lifecycle

No lifecycle behavior changes. SessionStart/UserPromptSubmit output must remain unchanged across `manual`, `review`, and `automatic` for a fixed store/config except existing diagnostic surfaces outside lifecycle.

## Suggested Actions

When a proposal exists, add existing review-first actions to continuity `suggestedActions`:

1. `memory-lane review --json`
2. Bounded visible-item approvals: `memory-lane approve <id>`

Do not add reject/delete/cleanup/consolidation actions.

## Tests

Add or update tests for:

1. Core read model emits no `handoffProposal` for `manual` or `automatic`.
2. Core read model emits `handoffProposal` for `review` with active project scope and pending continuity candidates.
3. Proposal uses existing pending continuity candidates, includes pending count, bounded items, omitted count, and existing review/approve actions.
4. Proposal is omitted when there is no project scope.
5. Proposal is omitted when there are no pending continuity candidates.
6. Proposal output excludes likely-secret candidate text by reusing preview filtering.
7. Building/reading proposal does not mutate or write memories; store contents remain unchanged after `engine.continuity()`.
8. Doctor handoff-mode matrix:
   - `manual`: active true, current inspection note.
   - `review`: active true, read-only proposal note.
   - `automatic`: active false, declared/inactive note.
9. Update existing Slice 1 review-mode doctor assertions to the new Slice 2 behavior:
   - `packages/core/test/engine.test.ts` valid-mode matrix should expect review active true and the new review note.
   - `packages/core/test/engine.test.ts` cross-mode doctor comparison should no longer assert review inactive.
   - `packages/cli/test/cli.test.ts` human/JSON doctor review-mode assertions should expect active true and the new review note.
10. Assert doctor/status/MCP `memory_status` diagnostics do not include `handoffProposal`; proposals belong only to continuity surfaces.
11. CLI human `memory-lane continuity` renders the proposal block in review mode and not in manual/automatic.
12. CLI `memory-lane continuity --json` includes `handoffProposal` only in review mode.
13. MCP `memory_continuity` includes the proposal only in review mode.
14. Lifecycle/session-start context output remains unchanged for configs differing only by `handoffMode`. Current lifecycle injection helpers receive context-policy config, not the full `memory` block, so this regression should prove no handoff-mode plumbing was introduced into lifecycle injection.

Run at least:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
pnpm --filter @memory-lane/lifecycle test
pnpm build
git diff --check
```

## Documentation

Update:

- `CONTEXT.md`
  - Add review-mode handoff proposal terms.
  - Update review handoff mode from inert/generated framing to read-only proposal behavior assembled from existing pending continuity candidates.
- `README.md`
  - Explain that `review` mode surfaces read-only handoff proposals on continuity surfaces.
  - Clarify approval remains through existing review/approve commands.
  - Clarify no lifecycle injection happens in review mode.
- `ROADMAP.md`
  - Mark Phase 21 Slice 2 as read-only review-mode handoff proposals.
  - Rewrite Phase 21 Todo #3 so it does not imply this slice generates new summaries; review mode assembles proposals from pending continuity candidates created by existing capture paths.
  - Keep automatic mode as future work.
- `HANDOFF.md`
  - Record the slice and guardrails.

Do not edit personal/global skill files in this repository slice.

## Acceptance Criteria

The slice is complete when:

1. `review` mode has one read-only behavior: bounded handoff proposals on continuity surfaces.
2. `manual` behavior remains unchanged.
3. `automatic` remains declared but inactive.
4. No lifecycle context output changes across modes.
5. No new CLI commands or MCP tools are added.
6. No writes, approvals, or mutations occur while viewing proposals.
7. Proposal previews are bounded and secret-filtered using existing continuity preview behavior.
8. Doctor/status diagnostics accurately report the new review-mode active boundary.
9. README, ROADMAP, CONTEXT, and HANDOFF are updated.
10. Required tests/build/diff-check pass.

## Risks and Mitigations

- **Risk: Proposal becomes a parallel review system.** Mitigation: use existing pending continuity candidates and existing review/approve commands only.
- **Risk: Review mode is confused with automatic handoff injection.** Mitigation: docs and notes state no lifecycle injection or automatic approval.
- **Risk: Context pollution through previews.** Mitigation: proposal appears only on explicit continuity surfaces and reuses bounded preview/secret filtering.
- **Risk: Surface sprawl.** Mitigation: no new command or MCP tool.
- **Risk: Behavior leak across modes.** Mitigation: cross-mode regression tests.
