# Phase 18 Slice 1 Design: Global Preference Layering for Context Rendering

Date: 2026-06-20
Status: Draft for review

## Goal

Make Memory Lane's automatic context rendering treat global preferences as a distinct, bounded layer instead of letting them compete indistinguishably with current-project memories. This first Phase 18 slice improves SessionStart and UserPrompt context quality across Claude Code, Codex, pi, and future lifecycle adapters without introducing a broad new API surface.

## Background

Memory Lane currently has durable scope and category concepts:

- `scope.type`: `global` or `project`
- `category`: `preference`, `personal`, or `project`
- `kind`: includes `preference`, `workflow_rule`, `project_fact`, `project_checkpoint`, `session_summary`, and others

Context rendering already groups selected records into readable groups, including `Current project`, `Global preferences and workflow rules`, and `Global memory`. However, selection is still mostly one shared budget. This means global preferences can be over-selected, under-selected, or mixed into project progress context in ways that make continuity noisy.

Phase 18 starts by making preference selection explicit before rendering.

## User-approved slice choice

The first Phase 18 slice is **Option B: Selection/rendering first**.

Deferred from this slice:

- **Option A: Metadata/inspection first** — richer status/doctor/MCP omitted-count diagnostics are deferred to a later Phase 18 slice. This slice may expose minimal internal metadata only where needed for tests or lifecycle decisions.
- **Option C: Full Phase 18 in one slice** — rejected as too broad for safe review-first delivery.

## Definitions

### Preference-like memory

A memory is preference-like when it is approved, visible in the current scope, and any of the following is true:

- `category === "preference"`
- `kind === "preference"`
- `kind === "workflow_rule"`

### Global preference layer

Approved preference-like memories with `scope.type === "global"`. These are user-wide preferences, workflow rules, and operating preferences that may apply across projects.

### Project preference layer

Approved preference-like memories with `scope.type === "project"` and `scope.key` matching the current project scope.

### Project content layer

Approved current-project memories that are not preference-like, such as project facts, checkpoints, decisions, and session summaries.

### Other visible layer

Approved visible memories that do not fit the layers above. Other-project memories remain low priority for automatic context unless already returned by prompt recall and within budget.

## Desired behavior

### SessionStart

SessionStart context should prioritize continuity for the current project while still carrying globally applicable preferences.

Selection order:

1. Current project preference layer
2. Current project content layer
3. Global preference layer
4. Other global memory
5. Other visible project memory, only if budget remains and current-project/global layers did not fill the budget

Important constraints:

- Operating agreements already injected through continuity notices or operating-agreement summaries must not be duplicated in baseline memories.
- Project-scoped preference-like records should be selected before global preference-like records.
- Global preference-like records should have their own bounded allowance so they do not crowd out project checkpoints/session progress.
- If project scope is unavailable, global preferences may still be selected, but project-specific memories must not be treated as current-project memories.

### UserPromptSubmit

Prompt-time context should continue to be relevance-driven, but selection should recognize preference layering.

Selection behavior:

1. Use the existing prompt recall query behavior, including continuity-intent topic narrowing.
2. From recalled approved memories, separate current-project preference-like, current-project content, global preference-like, global non-preference, and other-visible records.
3. Select relevant current-project records first when lexical/semantic recall already surfaced them.
4. Include relevant global preference-like records within a bounded preference allowance.
5. Preserve existing skip behavior for generic prompts and secret filtering.

Prompt-time global preferences should not be injected merely because they are global; they must still come from the recall result and pass existing relevance/filtering rules unless the event is SessionStart baseline selection.

### Project override/narrowing behavior

This slice does not add explicit supersede metadata or a preference override DSL. Instead, it applies conservative layering rules:

- A current-project preference-like memory should appear before global preference-like memories.
- If current-project and global preference-like memories are both selected, rendering should make scope grouping clear enough for the model to follow the project-scoped preference first.
- Slice 1 should only omit global preference-like memories for exact normalized duplicate text already selected from the current project. Deeper semantic or workflow-area conflict resolution is deferred.
- No automatic rejection, deletion, rescoping, superseding, or approval changes happen.

### Rendering

Rendered context should remain readable and harness-neutral.

- Keep the existing `<memory-context>` envelope.
- Keep readable group headings.
- Ensure global preferences appear under a distinct heading from current-project content.
- Do not expose raw diagnostics, hidden memory text, rejected/deleted memories, or pending records. Existing automatic lifecycle injection remains approved-memory-first for this slice.

## Context policy additions

This slice extends `memory.contextPolicy` with preference-specific budgets in a non-breaking way.

Minimal shape:

```json
{
  "memory": {
    "contextPolicy": {
      "preferenceMaxItems": { "sessionStart": 2, "prompt": 2 },
      "preferenceMaxChars": { "sessionStart": 600, "prompt": 900 }
    }
  }
}
```

Rules:

- These keys are optional.
- Existing configs remain valid.
- Defaults should preserve current approximate behavior while improving layer separation.
- Values are caps, not guarantees.
- Overall `maxItems` and `maxChars` still cap the full rendered memory block.
- Validation should reject invalid non-object or negative/non-integer values consistently with existing `maxItems` and `maxChars` validation.

These config fields ship in Slice 1 because Phase 18 explicitly includes preference-specific context policy. Rich external diagnostics for selected/omitted preference counts remain deferred.

## Shared implementation shape

Add a shared preference-layer selection module/function in `@memory-lane/lifecycle` or `@memory-lane/core` so adapters do not duplicate policy.

Suggested API shape:

```ts
interface PreferenceLayerSelectionResult {
  selected: MemoryRecord[]
  omitted: number
  omittedPreferenceCount: number
  selectedPreferenceCount: number
}
```

The exact type can differ, but the behavior should be centralized and testable.

Candidate functions:

- `selectLayeredBaselineMemories(...)`
- `selectLayeredPromptMemories(...)`
- shared helpers for `isPreferenceLikeMemory`, layer grouping, and preference budget resolution

## MCP and CLI scope for this slice

No new CLI command and no new MCP tool are added in this slice.

Allowed minimal changes:

- Existing lifecycle context behavior changes because adapters use shared handlers.
- Existing tests may inspect `contextDecision` metadata if already available.
- Docs may tell users to use existing `memory-lane list`, `memory-lane review`, `memory-lane status`, `memory-lane continuity`, and MCP equivalents to inspect preferences.

Deferred to later Phase 18 slice:

- Rich status/doctor/MCP selected/omitted preference counts.
- New diagnostics fields whose only purpose is external inspection.
- Any dashboard redesign.

## Non-goals

This slice does not:

- Add new memory categories.
- Add automatic preference learning.
- Auto-approve pending preferences.
- Change recall ranking globally.
- Add explicit override/supersede APIs.
- Delete, rescope, reject, consolidate, or rewrite memories.
- Add raw transcript inspection.
- Add harness-specific preference behavior.
- Make MCP lifecycle hooks run automatically; MCP remains explicit-tools-only.

## Acceptance criteria

1. SessionStart selection separates current-project context from global preference context and keeps global preferences bounded.
2. Prompt-time selection remains relevance-driven while applying the same preference-layer rules to recalled memories.
3. Project-scoped preferences are rendered before overlapping global preferences and are clear enough to act as the narrower guidance.
4. Existing `memory.contextPolicy` configs remain valid; any new optional preference-budget fields are validated and documented.
5. Claude Code, Codex, and pi lifecycle paths benefit through shared lifecycle code, not adapter-specific forks.
6. Tests cover:
   - global preference inclusion at SessionStart,
   - global preference bounding when many global preferences exist,
   - project preference before/over global preference behavior,
   - prompt-time generic prompts still skipping automatic injection,
   - prompt-time relevant global preference inclusion,
   - overall character/item budgets still enforced.
7. Docs explain how to save, inspect, and narrow/override global preferences safely using existing Memory Lane review/list/status/continuity surfaces.

## Risks and mitigations

### Risk: global preferences become too sticky

Mitigation: bound preference count/chars separately and keep prompt-time selection relevance-driven.

### Risk: project progress is crowded out by user preferences

Mitigation: SessionStart selects current-project preference/content before global preference layer and keeps global preference allowance capped.

### Risk: users cannot inspect why a preference was selected

Mitigation: render grouped headings now; defer richer selected/omitted diagnostics to the next Phase 18 slice.

### Risk: apparent override semantics are over-promised

Mitigation: document this as project-first layering and conservative overlap omission, not explicit supersession or policy conflict resolution.

## Design decisions for implementation

1. Preference budget config ships in Slice 1. This keeps the context-policy part of Phase 18 real while deferring richer status/doctor/MCP reporting.
2. Workflow-rule memories are preference-like for prompt selection and rendering. At SessionStart, operating agreements already selected for continuity/operating-agreement notices remain excluded from baseline memory selection to avoid duplicate injection.
3. Project/global overlap behavior is intentionally conservative: project-scoped preferences render first, and exact normalized duplicate global preferences may be omitted. Broader conflict detection waits for a later policy/inspection slice.
