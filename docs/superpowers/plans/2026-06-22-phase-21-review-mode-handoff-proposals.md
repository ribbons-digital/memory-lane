# Phase 21 Slice 2 — Review-Mode Handoff Proposals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `memory.handoffMode: "review"` behavior-active in exactly one read-only way: bounded handoff proposals on existing continuity surfaces, assembled from existing pending continuity candidates.

**Architecture:** Extend the existing continuity read model with an optional `handoffProposal` field gated by `handoffMode === "review"`. Pass the active handoff mode from `MemoryEngine.continuity()`. Update doctor diagnostics to mark review active with a new canonical note. Render the proposal in existing CLI continuity output and rely on existing JSON/MCP continuity passthroughs. No lifecycle, adapter, command, or MCP tool expansion.

**Tech Stack:** TypeScript monorepo, Node test runner, pnpm workspace.

---

## File Structure

- Modify: `packages/core/src/types.ts`
  - Add `HandoffProposalItem`, `HandoffProposal`, `ContinuityReadModel.handoffProposal?`, `ContinuityReadModelOptions.handoffMode?`.
- Modify: `packages/core/src/continuity-read-model.ts`
  - Build review-mode proposal from existing `pendingContinuityCandidates`/`pendingContinuity`.
- Modify: `packages/core/src/engine.ts`
  - Pass handoff mode into continuity builder; update doctor behavior matrix and canonical notes.
- Modify: `packages/cli/src/formatters.ts`
  - Render compact human `Review-mode handoff proposal` block.
- Modify tests:
  - `packages/core/test/continuity-read-model.test.ts`
  - `packages/core/test/engine.test.ts`
  - `packages/cli/test/cli.test.ts`
  - `packages/mcp-server/test/handlers.test.ts`
  - `packages/lifecycle/test/injection.test.ts` or `packages/lifecycle/test/handlers.test.ts` if practical.
- Modify docs:
  - `CONTEXT.md`
  - `README.md`
  - `ROADMAP.md`
  - `HANDOFF.md`

## Task 1: Core Types and Read Model

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/continuity-read-model.ts`
- Modify: `packages/core/test/continuity-read-model.test.ts`

- [ ] **Step 1: Add proposal types**

In `packages/core/src/types.ts`, near `ContinuityMemoryPreview` / `ContinuityReadModel`, add:

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

Add to `ContinuityReadModel`:

```ts
handoffProposal?: HandoffProposal
```

Add to `ContinuityReadModelOptions`:

```ts
handoffMode?: HandoffMode
```

If `HandoffMode` is declared later in `types.ts`, move it above `ContinuityReadModelOptions` or use a compatible local type without circular declaration issues.

- [ ] **Step 2: Build proposal helper**

In `packages/core/src/continuity-read-model.ts`, add constants:

```ts
const HANDOFF_PROPOSAL_NOTES = [
  "Review-mode handoff proposals are read-only; inspect and approve pending memories before relying on them as handoff state.",
  "No lifecycle context injection or automatic approval is performed.",
]
```

Add a helper after `requiredContinuityActions` or near read-model construction:

```ts
function buildHandoffProposal(input: {
  handoffMode?: "manual" | "review" | "automatic"
  projectScope?: string
  pendingCount: number
  items: ContinuityMemoryPreview[]
}): HandoffProposal | undefined {
  if (input.handoffMode !== "review") return undefined
  if (!input.projectScope) return undefined
  if (input.pendingCount <= 0 || !input.items.length) return undefined

  return {
    mode: "review",
    status: "pending-review",
    projectScope: input.projectScope,
    pendingCount: input.pendingCount,
    items: input.items,
    omittedCount: Math.max(0, input.pendingCount - input.items.length),
    suggestedActions: [
      "memory-lane review --json",
      ...input.items.map((item) => `memory-lane approve ${item.id}`),
    ],
    notes: HANDOFF_PROPOSAL_NOTES,
  }
}
```

Import needed types.

- [ ] **Step 3: Include proposal in read model**

In `buildContinuityReadModel`, after `pendingContinuity` is computed, build:

```ts
const handoffProposal = buildHandoffProposal({
  handoffMode: options.handoffMode,
  projectScope,
  pendingCount: pendingContinuityCandidates.length,
  items: pendingContinuity,
})
```

Include it conditionally in the return object:

```ts
...(handoffProposal ? { handoffProposal } : {}),
```

Update `suggestedActions` so proposal actions are included only when proposal exists:

```ts
const suggestedActions = unique([
  ...requiredContinuityActions(Boolean(pendingContinuityCandidates.length)),
  ...(handoffProposal?.suggestedActions ?? []),
  ...continuityHints.suggestedActions,
])
```

Ensure no writes/mutations occur.

- [ ] **Step 4: Add core read-model tests**

In `packages/core/test/continuity-read-model.test.ts`, add tests for:

1. No `handoffProposal` for `manual` or `automatic` with pending project continuity.
2. `handoffProposal` for `review` with active project scope and pending continuity candidate.
3. Proposal includes `pendingCount`, bounded `items`, `omittedCount`, `memory-lane review --json`, and bounded `memory-lane approve <id>` suggestions.
4. Proposal omitted with no project scope.
5. Proposal omitted with no pending continuity candidates.
6. Secret candidate text is filtered out by existing preview behavior; if all items are filtered, proposal is omitted.
7. `suggestedActions` contains proposal actions only in review mode.

Use existing memory fixture patterns in this test file. Use deterministic timestamps and project scope key.

- [ ] **Step 5: Run targeted core tests**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: core tests pass or fail only because engine doctor tests still need Task 2 updates.

## Task 2: Engine Diagnostics and No-Write Contract

**Files:**
- Modify: `packages/core/src/engine.ts`
- Modify: `packages/core/test/engine.test.ts`

- [ ] **Step 1: Pass handoff mode to continuity**

In `MemoryEngine.continuity()`, update builder call:

```ts
return buildContinuityReadModel(this.store.list(), {
  projectScopeKey: this.scope?.key,
  caller: opts?.caller,
  handoffMode: this.getHandoffMode(),
})
```

- [ ] **Step 2: Update doctor matrix**

Update `handoffModeDoctor()`:

```ts
private handoffModeDoctor(): Record<string, unknown> {
  const mode = this.getHandoffMode()
  const note = mode === "manual"
    ? "Current inspection-first behavior is active."
    : mode === "review"
      ? "Review mode is active for read-only handoff proposals; approve pending memories before relying on them as handoff state."
      : "Declared for Phase 21; currently behaves like manual mode."
  return {
    handoffMode: mode,
    handoffModeBehaviorActive: mode === "manual" || mode === "review",
    handoffModeNote: note,
  }
}
```

- [ ] **Step 3: Update engine tests**

In `packages/core/test/engine.test.ts`:

- Update valid-mode matrix: review active true + new note.
- Update cross-mode doctor test: do not assert review inactive; compare automatic and manual outside `handoffMode*` fields, and compare review similarly after deleting `handoffMode*` fields. Since doctor does not include proposals, normalized doctor reports should remain equal across all modes.
- Add assertion that `JSON.stringify(e.doctor())` does not include `handoffProposal`.
- Add no-write/read-only test: create pending project continuity memory, count/list store before and after `engine.continuity()` in review mode, assert identical ids/statuses/counts.

- [ ] **Step 4: Run core tests**

Run:

```bash
pnpm --filter @memory-lane/core test
```

Expected: all core tests pass.

- [ ] **Step 5: Commit Task 1-2**

Run:

```bash
git add packages/core/src/types.ts packages/core/src/continuity-read-model.ts packages/core/src/engine.ts packages/core/test/continuity-read-model.test.ts packages/core/test/engine.test.ts
git commit -m "feat(core): add review-mode handoff proposals"
```

## Task 3: CLI and MCP Continuity Surfaces

**Files:**
- Modify: `packages/cli/src/formatters.ts`
- Modify: `packages/cli/test/cli.test.ts`
- Modify: `packages/mcp-server/test/handlers.test.ts`

- [ ] **Step 1: Render human continuity proposal**

In `packages/cli/src/formatters.ts`, inside `formatContinuityReadModel`, after pending continuity rendering and before warnings, add:

```ts
if (model.handoffProposal) {
  lines.push("", colorize("Review-mode handoff proposal", "bold"))
  lines.push(`  Pending candidates: ${model.handoffProposal.pendingCount}${model.handoffProposal.omittedCount ? ` (${model.handoffProposal.omittedCount} omitted)` : ""}`)
  for (const item of model.handoffProposal.items) lines.push(`  [${item.id}] ${item.preview}`)
  lines.push("  Actions:")
  for (const action of model.handoffProposal.suggestedActions) lines.push(`    ${figures.pointerSmall} ${action}`)
}
```

Keep output compact. Do not render reject/delete/cleanup suggestions.

- [ ] **Step 2: Update CLI tests**

In `packages/cli/test/cli.test.ts`:

- Update Slice 1 doctor review-mode tests to active true and new note.
- Add temp config with `memory.handoffMode: "review"`, pending project continuity memory, and assert:
  - `memory-lane continuity` includes `Review-mode handoff proposal` and approve/review actions.
  - `memory-lane continuity --json` includes `data.handoffProposal`.
- Add manual/automatic assertions that `handoffProposal` is absent in continuity JSON.
- Assert `status --json` / MCP status equivalent not needed here, but `doctor --json` should not include `handoffProposal` if convenient.

- [ ] **Step 3: Update MCP tests**

In `packages/mcp-server/test/handlers.test.ts`:

- Add `memory_continuity` review-mode test that configures review mode, creates pending project continuity candidate, calls `handleMemoryContinuity`, and asserts `structuredContent.data.continuity.handoffProposal` exists.
- Add manual or default mode assertion that `handoffProposal` is absent.
- Add `memory_status` assertion that `handoffProposal` is absent from status diagnostics.

- [ ] **Step 4: Run CLI/MCP tests**

Run:

```bash
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
```

Expected: all pass.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add packages/cli/src/formatters.ts packages/cli/test/cli.test.ts packages/mcp-server/test/handlers.test.ts
git commit -m "feat(cli): show review-mode handoff proposals"
```

## Task 4: Lifecycle Regression and Docs

**Files:**
- Modify if practical: `packages/lifecycle/test/injection.test.ts` or `packages/lifecycle/test/handlers.test.ts`
- Modify: `CONTEXT.md`
- Modify: `README.md`
- Modify: `ROADMAP.md`
- Modify: `HANDOFF.md`

- [ ] **Step 1: Add lifecycle regression if practical**

Current lifecycle injection helpers receive `MemoryContextPolicyConfig`, not the full `memory` block. If there is an existing handler test that can create two full configs differing only by `memory.handoffMode`, assert SessionStart/UserPromptSubmit context output is identical.

If this is impractical without heavy fixture work, document in the final report that lifecycle helpers cannot read `handoffMode` and no lifecycle files changed. Do not add fake plumbing just for the test.

- [ ] **Step 2: Update CONTEXT**

Add/revise:

- Review-mode handoff proposal
- Handoff proposal item
- Review handoff mode now means read-only proposal behavior on continuity surfaces, not generated/injected handoff state.

- [ ] **Step 3: Update README**

In the handoff-mode section:

- `review` now surfaces read-only proposals through `memory-lane continuity` and MCP `memory_continuity`.
- Proposals are assembled from existing pending continuity candidates.
- Approval remains explicit through existing review/approve flows.
- No lifecycle injection or automatic approval happens in review mode.
- `automatic` remains future/inactive.

- [ ] **Step 4: Update ROADMAP**

In Phase 21:

- Status: Slice 2 implements read-only review-mode handoff proposals.
- Rewrite Todo #3 so it does not imply Slice 2 generates summaries. Use wording like:
  - "In review mode, assemble existing pending session-summary/checkpoint/progress continuity candidates into read-only handoff proposals for explicit review/approval."
- Keep automatic mode as future work.

- [ ] **Step 5: Update HANDOFF**

Add a recent-changes bullet describing Slice 2 and its guardrails.

- [ ] **Step 6: Run docs/diff check**

Run:

```bash
git diff --check
```

Expected: pass.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add CONTEXT.md README.md ROADMAP.md HANDOFF.md packages/lifecycle/test/injection.test.ts packages/lifecycle/test/handlers.test.ts
git commit -m "docs: document review-mode handoff proposals"
```

If no lifecycle test file changed, omit it from `git add`.

## Task 5: Final Verification and Review

- [ ] **Step 1: Run full required verification**

Run:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/mcp-server test
pnpm --filter @memory-lane/lifecycle test
pnpm build
git diff --check
```

Expected: all pass.

- [ ] **Step 2: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -8
git diff --stat main...HEAD
```

Expected: working tree clean; changes match spec scope.

- [ ] **Step 3: Independent review**

Request review focused on:

- spec compliance;
- no lifecycle behavior changes;
- review mode only adds read-only continuity proposal;
- manual unchanged, automatic inactive;
- no new commands/tools/silent writes;
- docs/tests adequate.

- [ ] **Step 4: Repair if needed**

If blockers appear, fix, rerun affected tests and `git diff --check`, commit repairs, and re-review.

- [ ] **Step 5: Push/open PR**

After approval:

```bash
git push -u origin feature/phase-21-review-mode-proposals
```

Open PR title:

```text
feat: add review-mode handoff proposals
```

PR body should include:

- summary;
- tests run;
- explicit note that proposals are read-only, no lifecycle injection, no new commands/MCP tools, and automatic remains inactive.
