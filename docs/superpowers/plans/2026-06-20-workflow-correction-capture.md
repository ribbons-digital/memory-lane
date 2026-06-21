# Phase 19 Slice 1 Plan: Review-First Workflow Correction Capture

## Spec

- `docs/superpowers/specs/2026-06-20-workflow-correction-capture-design.md`

## Goal

Implement narrow, review-first workflow correction capture:

- add non-breaking `correction` and `procedure` memory kinds,
- detect explicit user workflow/process corrections from bounded Stop context,
- save compact pending project-scoped correction candidates,
- surface them through existing review/continuity/operating-agreement paths,
- preserve privacy and low-noise behavior.

## Constraints

- No new CLI commands.
- No new MCP tools.
- No LLM classifier.
- No automatic approvals.
- No prompt-time/UserPromptSubmit writes in this slice.
- No raw transcript, raw tool output, harness wrappers, memory ids, or long quotes in saved correction text.
- No recall ranking or automatic context-injection special treatment for corrections beyond existing behavior after approval.
- Keep behavior harness-neutral in `@memory-lane/lifecycle`.

## Task 1 — Add non-breaking kinds and schema/test coverage

Files likely involved:

- `packages/core/src/types.ts`
- `packages/core/src/storage-validation.ts`
- `packages/core/test/engine.test.ts`
- MCP/schema/type files if they enumerate `MemoryKind`
- Obsidian mirror/import validators/tests if they enumerate `MemoryKind`
- CLI kind-filter docs/help/tests if applicable

Steps:

1. Add `correction` and `procedure` to `MemoryKind`.
2. Update runtime validators/enums that reject unknown kinds.
3. Update any generated/handwritten MCP schemas that enumerate allowed kinds.
4. Update Obsidian mirror/import handling if kind validation is duplicated there.
5. Add tests proving:
   - `correction` and `procedure` records save/load/list/review successfully.
   - invalid kinds are still rejected.
   - historical records without these kinds remain valid.

Verification:

- focused core tests
- focused MCP/import/mirror tests as needed
- `pnpm build`

## Task 2 — Implement lifecycle correction candidate extraction

Files likely involved:

- `packages/lifecycle/src/correction-capture.ts` (new)
- `packages/lifecycle/src/handlers.ts`
- `packages/lifecycle/src/types.ts` if helper types are needed
- `packages/lifecycle/test/handlers.test.ts` or new focused test file

Steps:

1. Add a pure `extractCorrectionCandidatesFromStop(input)` helper.
2. Require explicit user correction signal in `lastUserMessage`.
3. Require workflow/process target terms.
4. Reject generic factual corrections and generic retries.
5. Reject explicit preference-save phrasing so existing explicit memory paths remain authoritative.
6. Reuse existing secret/meta-task protections where available.
7. Generate compact normalized `Workflow correction: ...` text with bounded length.
8. Return pending project-scoped `kind: "correction"`, `category: "project"`, `scopeType: "project"`, `source: "agent-suggested"` candidates.
9. Integrate into `handleStop` before/alongside checkpoint/stop candidates without changing other lifecycle events.

Tests:

- PR-protected workflow correction saves one pending project correction.
- Review-gate/spec-approval correction saves one pending project correction.
- Candidate has `agent-suggested` source and `turn_stop` provenance after persistence.
- Generic factual correction creates no candidate.
- Explicit preference request creates no correction duplicate.
- acceptance-finalization/subagent wrapper text is ignored.
- likely-secret correction is discarded/skipped.

Verification:

- `cd packages/lifecycle && pnpm test`
- `pnpm build`

## Task 3 — Add dedup/debounce for correction candidates

Files likely involved:

- `packages/lifecycle/src/correction-capture.ts`
- `packages/lifecycle/src/handlers.ts`
- `packages/lifecycle/test/handlers.test.ts`

Steps:

1. Add normalized correction keys using existing memory text normalization.
2. Suppress candidate if a visible pending/approved project memory with kind `correction`, `procedure`, or `workflow_rule` has the same correction key.
3. Suppress same-turn duplicates if explicit/user-suggested candidates produce the same correction key.
4. Keep dedup exact/normalized only; no semantic dedup in this slice.

Tests:

- existing pending correction suppresses duplicate.
- existing approved workflow_rule suppresses duplicate.
- unrelated correction still saves.
- same-turn explicit candidate suppresses duplicate correction capture.

Verification:

- focused lifecycle tests
- `pnpm build`

## Task 4 — Surface corrections in review/continuity/operating agreements

Files likely involved:

- `packages/core/src/review.ts` or checkpoint/review helpers if labeling is centralized
- `packages/cli/src/formatters.ts`
- `packages/cli/test/cli.test.ts`
- `packages/core/src/continuity-read-model.ts`
- `packages/core/src/operating-agreements.ts`
- `packages/core/test/continuity-hints.test.ts` or `engine.test.ts`
- `packages/mcp-server/test/handlers.test.ts` if MCP grouped metadata needs assertions

Steps:

1. Ensure existing review/list/MCP surfaces accept and group `kind: "correction"` and `kind: "procedure"` normally.
2. Add lightweight human review label for pending correction candidates if consistent with existing checkpoint labels.
3. Ensure continuity read model includes pending correction candidates through existing pending continuity candidate path; add test coverage if not already implicit.
4. Allow approved workflow-like `correction`/`procedure` memories to participate in operating-agreement related/primary selection only when workflow/process-like.
5. Preserve priority: explicit `workflow_rule` remains preferred over correction/procedure.

Tests:

- CLI review displays pending correction candidate with compact label or at least correctly typed pending entry.
- MCP `memory_review` grouped output includes correction kind without schema break.
- pending correction appears in continuity pending state when project-scoped.
- approved workflow-like correction/procedure is considered by operating-agreement discovery.
- explicit workflow_rule wins over correction/procedure for primary agreement.

Verification:

- focused core/CLI/MCP tests
- `pnpm build`

## Task 5 — Docs and final verification

Files:

- `CONTEXT.md`
- `README.md`
- `ROADMAP.md`
- `HANDOFF.md`
- possibly the spec/plan if implementation decisions differ

Steps:

1. Add domain language for correction candidate and procedure memory.
2. Update Phase 19 roadmap status to show Slice 1 implemented locally.
3. Document lifecycle correction capture in README, emphasizing pending-by-default and review-first.
4. Update HANDOFF with current branch, changed behavior, verification, and next recommended item.
5. Run full verification.
6. Request final implementation review.
7. Fix required findings, if any.
8. Commit, push, open PR, then stop for user merge.

Verification:

- `pnpm build`
- `pnpm test`
- `git diff --check`
- `git status --short`

## Review gates

1. Plan approval before implementation.
2. Focused task review after implementation tasks if subagents identify risk.
3. Final implementation review before commit/PR.
4. PR-protected merge gate: open PR and wait for user merge.

## Open implementation choices

- Prefer adding only `correction` and `procedure` kinds in this slice.
- Prefer Stop-only detection.
- Prefer normalized compact candidate text over exact user quote.
- Prefer exact/normalized dedup only.
