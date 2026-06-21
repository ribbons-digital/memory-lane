# Phase 20 Slice 2 Plan — Pending Continuity Candidate Debounce

Spec: `docs/superpowers/specs/2026-06-21-phase-20-duplicate-debounce-design.md`
Branch: `feature/phase-20-duplicate-debounce`

## Definition of done

- Duplicate `session_summary` candidates are filtered deterministically before save across CLI, Claude, Codex, and pi paths because filtering lives in shared lifecycle code.
- Existing checkpoint duplicate suppression remains intact and is narrowly strengthened only for high-signal existing checkpoint categories.
- Session summaries avoid obvious Memory Lane review-management chatter.
- No new commands/tools/config flags and no destructive memory mutation are introduced.
- Docs explain the low-noise debounce behavior and deferred consolidation/refresh work.
- Verification passes with `pnpm build`, `pnpm test`, and `git diff --check`.

## Implementation steps

### 1. Add session-summary debounce helpers in lifecycle

Files:
- `packages/lifecycle/src/session-end.ts`
- `packages/lifecycle/test/session-end.test.ts`

Tasks:
1. Add a deterministic normalizer for generated session-summary text:
   - strip leading `## Session Summary (...)` heading/date noise;
   - compact whitespace;
   - remove obvious Memory Lane review-management lines about review queues, memory IDs, `memory-lane review`, `/memory review`, approval, rejection, or pending-memory commands;
   - do not remove durable project decisions, blockers, next steps, or completed outcomes.
2. Add a session-summary key helper:
   - provenance key: adapter + `session_end` + non-empty `sessionId`;
   - content key: normalized durable summary body.
3. Add visible existing summary lookup over `engine.list({ all: true })` scoped to current project/global visibility, pending/approved status, and `kind === "session_summary"`.
4. Filter generated candidates before returning from `handleSessionEnd`.
5. Add lifecycle tests for:
   - same session id duplicate skipped;
   - equivalent content with different heading date skipped;
   - no duplicate when session id differs and content differs;
   - review-management chatter line removed or not represented in candidate text.

### 2. Keep adapter/CLI/pi save behavior unchanged but cover shared seam

Files:
- `packages/cli/test/cli.test.ts`
- `packages/claude-adapter/test/runner.test.ts`
- `packages/codex-adapter/test/runner.test.ts`
- `packages/pi-adapter/test/extension.test.ts` if needed

Tasks:
1. Prefer lifecycle-level tests as primary proof.
2. Add at least one integration/path test proving a duplicate session-summary request results in no new saved memory through a real caller path.
3. Do not duplicate debounce logic in adapter save helpers.

### 3. Narrowly strengthen checkpoint candidate debounce

Files:
- `packages/lifecycle/src/checkpoint-capture.ts`
- existing lifecycle/handler tests, likely `packages/lifecycle/test/tool-outcomes.test.ts` and/or `packages/lifecycle/test/handlers.test.ts`

Tasks:
1. Preserve release and PR merge keys exactly.
2. If needed, expose stable keys for recognized verification/docs-sync/roadmap-decision/major-fix checkpoint matches that currently already produce `CheckpointMatch.key` internally.
3. Add tests confirming repeated recognized checkpoint candidates are skipped against existing pending/approved records in the same visible project.
4. Add tests confirming unrelated checkpoint text is not skipped by fuzzy matching.

### 4. Update default session-summary prompt and docs

Files:
- `packages/lifecycle/src/session-end.ts`
- `README.md`
- `ROADMAP.md`
- `HANDOFF.md`
- `CONTEXT.md`

Tasks:
1. Update default prompt rules to exclude self-referential Memory Lane review queue operations, memory IDs, and approval/rejection instructions unless the user explicitly asked to preserve review decisions.
2. Add glossary entry for candidate debounce / pending continuity candidate if needed.
3. Update roadmap Phase 20 status:
   - Slice 1 released in `v0.2.15`;
   - Slice 2 is pending continuity candidate debounce.
4. Update handoff with current branch and release state.
5. Keep docs clear that refresh, consolidation, recall/injection filtering, cleanup, and migration of existing duplicate pending memories remain deferred.

### 5. Review and verification

Tasks:
1. Run targeted tests while implementing.
2. Run full verification:
   ```bash
   pnpm build
   pnpm test
   git diff --check
   ```
3. Request independent reviewer focused on:
   - no new commands/tools/config flags;
   - no destructive mutation;
   - no recall/injection behavior drift;
   - deterministic duplicate logic only;
   - summary chatter filter not over-broad.
4. Repair any blockers.
5. Commit, push, open PR, and stop for user merge.

## Out-of-scope reminders

- Do not add `memory-lane consolidate` in this slice.
- Do not add `memory-lane refresh` in this slice.
- Do not automatically reject/delete/supersede old pending records.
- Do not use an LLM to classify duplicates.
- Do not store raw transcripts or tool output.
- Do not change recall ranking or lifecycle injection.
