# Phase 21 Slice 5 — Automatic Handoff Mode Design and Safety Contract

## Status

Draft for review.

This is a design/spec slice only. It must not implement automatic mode behavior until the spec is reviewed by Opus 4.8 with high thinking effort and explicitly approved by the user.

## Context

Phase 21 so far:

- Slice 1 added the `memory.handoffMode` config contract and diagnostics.
- Slice 2 made `review` behavior-active only through read-only handoff proposals on explicit continuity surfaces.
- Slice 3 added a per-project continuity baseline marker so existing SessionStart newer-approved notices can work across sessions.
- Slice 4 validated Slice 2/3 behavior and returned verdict: **Proceed to automatic-mode design**.

Roadmap Todo #4 says:

> In `automatic` mode, approved session summaries, checkpoint memories, and relevant global preferences are eligible for budgeted injection at the next `SessionStart` alongside baseline memories.

However, current `selective` SessionStart baseline selection already makes approved visible session summaries/checkpoints eligible in a generic recency-ordered baseline. A naive implementation of Todo #4 would add little or nothing.

The actual gap is crowd-out and labeling: the latest approved handoff-relevant record can be pushed out of a small baseline budget by other recent approved memories. Automatic mode should provide a safe, observable continuity posture by reserving a bounded handoff layer inside the existing SessionStart budget.

## Design Decision

Define `memory.handoffMode: "automatic"` as a SessionStart-only, policy-subordinate continuity posture:

- It prioritizes a small approved handoff layer during SessionStart selection.
- It does not increase context budgets.
- It does not inject pending records.
- It does not approve, reject, delete, refresh, consolidate, or mutate memories.
- It does not run on UserPromptSubmit, Stop, PostToolUse, SessionEnd, MCP tools, or CLI continuity surfaces.
- It remains fully governed by `memory.contextPolicy`.

## Goals

1. Give automatic mode one clear, safe behavior distinct from `manual` and `review`.
2. Ensure the latest approved project handoff pointer is not accidentally crowded out of SessionStart context when automatic mode is enabled.
3. Keep automatic mode budget-neutral and privacy-safe.
4. Preserve review-first semantics: pending records still require approval before automatic mode can use them.
5. Add text-free diagnostics/decision metadata so users can see when automatic behavior was active and why records were selected/omitted.
6. Keep implementation harness-neutral and centered in core/lifecycle selection.

## Non-goals

- No implementation in this spec slice.
- No activation unless user explicitly configures `memory.handoffMode: "automatic"`.
- No behavior when `memory.contextPolicy.mode === "off"`.
- No pending-memory injection.
- No auto approval/reject/delete/cleanup/consolidation/refresh.
- No new CLI commands.
- No new MCP tools.
- No adapter payload changes.
- No raw transcript or tool-output capture.
- No recall/retrieval/ranking rewrite.
- No token-budget retuning.
- No natural-language workstream discovery.
- No orchestrator/subagent thread distinction.
- No per-project/global automatic disable override in this slice; roadmap Todo #9 remains future work.

## Domain Terms

Add/refine in `CONTEXT.md` when implemented:

**Automatic handoff mode**:
An explicit opt-in handoff mode where SessionStart may reserve part of the existing context budget for the latest approved project handoff pointer. It uses approved records only, does not expand budgets, and remains disabled by context policy `off`.

**Automatic handoff layer**:
The SessionStart selection layer used only in automatic mode to prioritize a bounded approved `session_summary` or `project_checkpoint` pointer before generic recency selection. It is a budgeted context selection layer, not a memory status, summary generator, or approval mechanism.

**Handoff pointer**:
An approved project-visible memory that helps identify where project work left off. In the first implementation this means the latest approved `session_summary` or `project_checkpoint`, subject to visibility, freshness, and safety filters.

## Core Contract

1. **Explicit opt-in**
   - `manual` remains the default.
   - `automatic` acts only when configured.

2. **Context-policy subordinate**
   - `memory.contextPolicy.mode === "off"` wins: no automatic behavior, no handoff layer, no SessionStart context.
   - `policy-only` emits no memory bodies; it may include a stronger text-free continuity notice/guidance that an approved handoff pointer is available.
   - `selective` may render the approved handoff pointer body inside existing SessionStart budget.

3. **Approved-only**
   - Automatic mode selects only approved memories.
   - Pending review-mode proposals and pending session summaries/checkpoints are never injected.

4. **Project-visible**
   - Handoff pointers must be visible to the active project scope.
   - First implementation should select current-project handoff pointers only.
   - Global preferences remain governed by existing global preference caps and layering, not the handoff pointer layer.

5. **Budget-neutral**
   - Automatic mode must not increase `sessionStart` `maxItems` or `maxChars`.
   - Handoff selection consumes part of the existing budget.
   - If budget is too tight, omit or truncate according to existing guarded context rendering rules; do not exceed budget.

6. **Pointer, not authority**
   - Label injected automatic handoff content as historical handoff context or last approved handoff pointer.
   - The output should encourage inspection when needed, not claim perfect current truth.

7. **No writes/mutations**
   - SessionStart automatic behavior writes no memory records and performs no memory mutations.
   - Existing continuity baseline marker behavior remains unchanged.

8. **Harness-neutral**
   - Core/lifecycle owns selection and metadata.
   - Claude/Codex/pi adapters remain thin payload/transport renderers.

## Eligibility Rules

A handoff pointer is eligible when all are true:

- `status === "approved"`.
- `scope.type === "project"` and matches the active project scope key.
- `kind` is `session_summary` or `project_checkpoint`.
- Memory text does not contain likely secrets according to existing secret filtering.
- It is not expired by explicit freshness metadata. Records classified as `expired` are ineligible and must be omitted with an omission reason. Records classified as `stale` remain eligible for the first implementation, but lifecycle metadata should record a warning or advisory reason so the user knows the pointer may need inspection.
- It is not superseded by revision metadata (`revision.supersededBy`).

Implementation note: current freshness classification logic is private to `freshness.ts`, and the baseline selection path does not currently receive a `referenceNow` or freshness classifier. Slice 5a must either export a safe freshness classifier or thread existing freshness status into handoff eligibility; otherwise the expired-record rule cannot be enforced where automatic selection happens.

If no active project scope exists, there is no automatic handoff layer. Automatic mode must fall back to existing behavior and diagnostics should report that no project-scoped handoff pointer was eligible.

Selection order:

1. Prefer newest eligible project handoff pointer by `updatedAt`, then `createdAt`, then stable id.
2. Select at most one handoff pointer in the first implementation.
3. Deduplicate against generic baseline memory selection so the same memory is not rendered twice.

## Behavior by Context Policy

### `contextPolicy.mode: "off"`

- No automatic behavior.
- No additional context.
- No handoff layer diagnostics in lifecycle result beyond ordinary `mode: "off"` context decision if already present.
- Explicit CLI/MCP tools remain available.

### `contextPolicy.mode: "policy-only"`

- No memory bodies are injected.
- Slice 5a must compute handoff eligibility in the `policy-only` branch even though that branch currently does not load approved memories for body selection.
- If an eligible handoff pointer exists, the continuity notice may include text-free guidance such as:

```text
Continuity notice:
- An approved handoff pointer is available for this project. Inspect Memory Lane continuity before relying on older session context.
```

- The notice must not include memory id, memory text, preview, transcript, tool output, or branch name.
- `contextDecision` may include text-free automatic handoff metadata.

### `contextPolicy.mode: "selective"`

- The handoff layer selects at most one approved handoff pointer before generic baseline selection.
- Slice 5a must update the rendering/selection path so the handoff pointer can be labeled distinctly and deduplicated against generic baseline selection, including the existing operating-agreement exclusion in `handleSessionStart`.
- The selected handoff pointer renders within the existing guarded memory context block, with a clear group label such as:

```text
### Latest approved handoff
```

or an equivalent readable label.

- The handoff pointer consumes existing `sessionStart` item/char budget.
- If no eligible handoff pointer exists, automatic mode falls back to normal selective behavior plus diagnostics.

## Diagnostics and Metadata

### Doctor/status/MCP status

Extend existing text-free diagnostics; do not include memory ids, text, previews, or branch names.

Doctor/status/MCP status are not SessionStart events and do not have a concrete selection budget result. They must report static eligibility and policy-derived active state only, not fabricated selected/omitted counts.

Suggested fields:

```ts
automaticHandoffDiagnostics?: {
  mode: "inactive" | "active"
  policyMode: "off" | "policy-only" | "selective"
  eligibleCount: number
  notes: string[]
}
```

`eligibleCount` is a text-free count of approved project-scoped handoff pointers that pass static eligibility checks for the current scope. Event-specific `selectedCount`, `omittedCount`, and `omittedReasons` belong only in lifecycle `contextDecision.automaticHandoff`.

These fields should appear through existing surfaces only:

- `memory-lane doctor --json`
- `memory-lane status --json`
- MCP `memory_status`

Human doctor output may render a compact summary if cheap; generic JSON object rendering is acceptable for first implementation.

### Lifecycle context decision

Add text-free event-specific metadata under `contextDecision`, for example:

```ts
automaticHandoff?: {
  active: boolean
  eligibleCount: number
  selectedCount: number
  omittedCount: number
  omittedReasons: string[]
}
```

This is the only place where selected/omitted counts are reported, because it reflects an actual SessionStart budget decision.

Do not include ids/text/previews.

### Handoff mode doctor note

When automatic mode becomes behavior-active in a future implementation:

- `handoffModeBehaviorActive` should be `true` for `automatic` only when `contextPolicy.mode !== "off"` and automatic behavior can participate in SessionStart.
- Note should change from declared/inactive to something like:
  - `Automatic mode is active for approved, budgeted SessionStart handoff selection; context policy still controls injection.`

This supersedes Slice 1/2 diagnostics for automatic mode.

## Future Implementation Slice Boundary

Future implementation should be split as:

### Slice 5a — Automatic Handoff Layer

Implement only:

- approved project handoff pointer eligibility;
- budget-neutral SessionStart handoff layer;
- policy-only notice enhancement;
- diagnostics/metadata;
- docs/tests.

Do not implement:

- workstream discovery;
- multiple handoff records;
- retrieval/ranking changes;
- token retuning;
- per-project disable;
- automatic approval;
- new CLI/MCP surfaces.

### Slice 5b+ — Later work

Only after 5a validation:

- workstream discovery;
- orchestrator/subagent distinction;
- richer confidence/noise thresholds;
- per-project/global safeguards;
- token-aware reporting if evidence says char budgets are insufficient.

## Tests for Future Implementation

When implementing 5a, add tests for:

1. `manual` behavior unchanged.
2. `review` behavior unchanged: proposal only on continuity surfaces, no SessionStart proposal injection.
3. `automatic` + `off`: no injected context and no automatic handoff metadata beyond inactive decision.
4. `automatic` + `policy-only`: no memory body injection; text-free handoff guidance appears only when eligible approved handoff pointer exists.
5. `automatic` + `selective`: latest approved project `session_summary` or `project_checkpoint` is selected even when generic recency would crowd it out.
6. Budget neutrality: total selected items/chars remain within existing SessionStart caps.
7. Approved-only: pending summaries/checkpoints are not injected.
8. Secret filtering: likely-secret handoff pointer is omitted.
9. Expired freshness filtering: expired handoff pointer is omitted with an omission reason; stale handoff pointer remains eligible but records a warning/advisory reason.
10. Deduplication: handoff pointer does not render twice if also selected by generic baseline.
11. No memory JSONL writes/mutations during SessionStart.
12. Diagnostics text-free in doctor/status/MCP status and report static eligibility only, not event-specific selected/omitted counts.
13. Lifecycle metadata text-free and reports event-specific selected/omitted counts.
14. No active project scope produces no handoff layer.
15. Adapters require no behavior-specific logic beyond existing SessionStart paths.

Run at least:

```bash
pnpm build
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
git diff --check
```

## Documentation Updates for Future Implementation

Update:

- `README.md`: automatic mode behavior, context-policy interaction, budget neutrality, approved-only boundary, how to switch back to manual/review.
- `CONTEXT.md`: automatic handoff mode/layer/pointer terms.
- `ROADMAP.md`: Slice 5a implementation status, keep workstream discovery/per-project safeguards deferred.
- `HANDOFF.md`: recent changes and guardrails.

## Acceptance Criteria for This Spec Slice

This design slice is complete when:

1. The automatic-mode safety contract is documented.
2. Opus 4.8 high-effort review approves the spec or required revisions are incorporated and approved.
3. The user explicitly approves the spec before implementation begins.
4. ROADMAP/HANDOFF are updated only if useful to record the design decision; otherwise leave implementation-status docs unchanged until 5a implementation.

## Risks and Mitigations

- **Risk: Automatic mode becomes unbounded context injection.** Mitigation: budget-neutral sub-layer inside existing SessionStart caps.
- **Risk: Pending review candidates bypass review.** Mitigation: approved-only eligibility.
- **Risk: Stale summaries become authoritative.** Mitigation: pointer labeling, freshness filtering, continuity notice guidance.
- **Risk: Empty-feature confusion.** Mitigation: automatic has a specific crowd-out guarantee and diagnostics.
- **Risk: More surface area.** Mitigation: no new commands/tools; extend existing diagnostics only.
- **Risk: Harness-specific drift.** Mitigation: shared lifecycle/core implementation only.
- **Risk: Per-project disable missing.** Mitigation: keep manual default; document Todo #9 as future before broad rollout.
