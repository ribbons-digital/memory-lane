# Project-First SessionStart Selection Design

## Status

Draft — Slice B of cross-harness continuity explainability work.

## Context

Manual Sitewright testing showed that SessionStart baseline injection can include useful current-project context, but broad global memories may appear before project-specific progress. After readable memory context labels, users can now see which memories are current-project versus global, but the ordering can still feel wrong: when opening a project, the latest project state should be prominent before broad global preferences.

Current SessionStart selection uses `selectBaselineMemories`, which sorts primarily by `updatedAt` and only uses project scope as a tie-breaker. A recently updated global memory can therefore outrank an older but more important current-project checkpoint.

This slice changes SessionStart baseline selection to be project-first while preserving existing policy budgets, approved-only behavior, deduplication, and secret filtering.

## Goals

1. Make current-project approved memories appear before global memories in SessionStart baseline selection when a current project scope is known.
2. Keep selected-memory rendering readable through the existing grouped `Relevant Memory` block.
3. Preserve existing SessionStart max item/char budgets and continuity notice budget behavior.
4. Preserve selected order within each applicability tier by recency.
5. Keep the change SessionStart-only; prompt-time recall/selection remains unchanged.
6. Avoid new config flags or preference-specific budget policy in this slice.

## Non-goals

- Do not change `UserPromptSubmit` recall ranking or semantic search behavior.
- Do not change which memories are visible to a project.
- Do not include pending memories in automatic injection.
- Do not add global preference-specific budgets or override rules; that belongs to Phase 18.
- Do not add memory cleanup, rescoping, or duplicate/debounce behavior.
- Do not change lifecycle continuity notice generation or rendering.
- Do not change MCP explicit tools.

## Proposed behavior

For SessionStart baseline selection, when `projectScope` is known, Memory Lane should prioritize candidates in this order:

1. Current-project memories: `scope.type === "project" && scope.key === projectScope`
2. Global memories: `scope.type === "global"`
3. Other project-scoped memories: `scope.type === "project" && scope.key !== projectScope`
4. Other/legacy visible memories

Within each tier, keep existing recency ordering: newer `updatedAt` first.

If no current project scope is known, selection should preserve the old recency-first behavior except for stable handling of global/project scopes as needed. Desktop MCP/no-cwd behavior is not part of lifecycle SessionStart selection here, but the function should behave safely when no project scope is provided.

### Example

Given a SessionStart budget of 4 items:

- `global-1`, updated 2026-06-19
- `global-2`, updated 2026-06-18
- `project-checkpoint`, current project, updated 2026-06-16
- `project-fact`, current project, updated 2026-06-15
- `global-3`, updated 2026-06-14

Old order could start with globals because they are newer.

New order should be:

1. `project-checkpoint`
2. `project-fact`
3. `global-1`
4. `global-2`

This does not hide global memories; it uses remaining existing budget after current-project memories.

## API shape

Extend `selectBaselineMemories` with an optional project scope parameter while keeping source compatibility:

```ts
interface BaselineSelectionOptions extends Partial<MemoryInjectionLimits> {
  projectScope?: string
}

selectBaselineMemories(memories: MemoryRecord[], options?: BaselineSelectionOptions): MemoryRecord[]
```

`handleSessionStart` already knows the current project scope via `engine.getProjectScope()?.key`, so it should pass that value into `selectBaselineMemories` as well as `renderMemoryContext`.

## Budget behavior

- Keep existing `maxItems`, `hardMaxChars`, `targetChars`, and `absoluteMaxChars` semantics.
- Keep continuity notice budget subtraction unchanged.
- Apply project-first tiering before the existing selection loop.
- Continue fitting memory text within the remaining character budget using existing truncation logic.
- Continue deduplicating normalized text across tiers.

This means a large current-project memory can still consume the remaining char budget; that is current behavior and not redesigned here.

## Harness behavior

All hook adapters that use shared `handleSessionStart` benefit automatically:

- Claude Code `SessionStart`
- Codex `SessionStart`
- Any future adapter using lifecycle `handleSessionStart`

No changes are required for MCP explicit tools or write hooks.

## Acceptance criteria

1. SessionStart baseline selection prefers current-project approved memories over newer global memories when `projectScope` is provided.
2. Within each applicability tier, newer memories still come first.
3. Global memories remain eligible after current-project memories if item/char budget remains.
4. No-project-scope behavior remains recency-first and does not unexpectedly demote global memories.
5. Secret filtering, deduplication, approved-only filtering, truncation, and existing budget behavior remain intact.
6. `handleSessionStart` passes the current project scope into baseline selection.
7. Prompt-time `selectMemoriesForInjection` behavior is unchanged.
8. README documents that SessionStart baseline injection is project-first, while prompt-time recall remains relevance-based.
9. Tests cover project-first selection, recency within tiers, fallback no-scope behavior, and lifecycle handler integration.

## Risks and mitigations

- **Risk:** Important global preferences may be omitted when a project has many current-project memories.
  - **Mitigation:** This slice intentionally uses existing budgets. Phase 18 will add preference-specific layering/budgets if needed.

- **Risk:** Project-first ordering could be mistaken for a relevance score.
  - **Mitigation:** Docs should describe this as SessionStart baseline applicability ordering, not semantic relevance.

- **Risk:** Other project-scoped memories appearing at all would be surprising.
  - **Mitigation:** Existing visibility rules are not changed here. Readable labels already make other-project memory visible; scope hygiene can be addressed separately.

## Follow-up slices

1. Phase 18 global preference layering/budgets so essential preferences can remain available even when project memory fills the SessionStart budget.
2. Global memory hygiene hints for global memories that look project-specific.
3. Duplicate/debounce logic for pending checkpoint candidates.
