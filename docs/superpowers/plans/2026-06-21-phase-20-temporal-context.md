# Phase 20 Slice 3 Plan — Temporal Context for Continuity Records

Spec: `docs/superpowers/specs/2026-06-21-phase-20-temporal-context-design.md`
Branch: `feature/phase-20-temporal-context`

## Definition of done

- Generated session summaries can carry advisory `freshness.capturedAt` derived from existing valid message timestamps as a session-end/as-of anchor.
- Candidate freshness passes through CLI, Claude, Codex, and pi session-summary save paths.
- Checkpoint capture remains behaviorally unchanged and does not set `capturedAt` in this slice because current Stop/PostToolUse inputs expose no timestamp.
- No recall/injection/status semantics change beyond normal rendering of stored freshness metadata.
- No new commands/tools/config flags and no destructive memory mutation are introduced.
- Verification passes with `pnpm build`, `pnpm test`, and `git diff --check`.

## Implementation steps

### 1. Add session-summary candidate freshness plumbing

Files:
- `packages/lifecycle/src/session-end.ts`

Tasks:
1. Import/use `MemoryFreshness` type for session-end candidates.
2. Add optional `freshness?: MemoryFreshness` to `SessionEndCandidate`.
3. Keep `MemoryCandidate` and `persistCandidates` unchanged in this slice because checkpoint/event timestamp plumbing is deferred.
4. Keep all existing candidate behavior unchanged when freshness is absent.

### 2. Derive session-summary capturedAt from existing message timestamps

Files:
- `packages/lifecycle/src/session-end.ts`
- `packages/lifecycle/test/session-end.test.ts`

Tasks:
1. Add helper to choose latest valid ISO timestamp from `input.messages[].timestamp`.
2. Treat that latest timestamp as the session-end/as-of anchor for the generated summary.
3. Ignore invalid/non-parseable timestamps.
4. Attach `freshness: { capturedAt }` to `SessionEndCandidate` only when a valid timestamp exists.
5. Leave the visible `## Session Summary (<date>)` heading as generation/write date; document that it may differ from `capturedAt`.
6. Add tests:
   - latest valid message timestamp is used;
   - invalid timestamps are ignored;
   - no timestamps means no freshness metadata;
   - existing duplicate debounce still works with freshness present.

### 3. Pass session-summary freshness through all save helpers

Files:
- `packages/cli/src/index.ts`
- `packages/claude-adapter/src/runner.ts`
- `packages/codex-adapter/src/runner.ts`
- `packages/pi-adapter/src/index.ts`
- relevant tests, likely `packages/codex-adapter/test/runner.test.ts` and/or CLI tests

Tasks:
1. Include `freshness: candidate.freshness` in each session-summary save call.
2. Add at least one integration/path test proving saved session-summary memory includes `freshness.capturedAt` when input messages have timestamps.
3. Confirm no raw transcript or new debug payload is introduced.

### 4. Document checkpoint timestamp deferral

Files:
- `packages/lifecycle/src/checkpoint-capture.ts` only if comments are useful; otherwise docs only.

Tasks:
1. Do not change checkpoint candidate structures in this slice.
2. Document that current `StopInput` and `PostToolUseInput` expose no timestamp, so checkpoint `capturedAt` remains unset under the no-payload-expansion rule.
3. Leave deliberate checkpoint timestamp plumbing for a later slice.

### 5. Update docs

Files:
- `CONTEXT.md`
- `README.md`
- `ROADMAP.md`
- `HANDOFF.md`

Tasks:
1. Add or refine glossary term for temporal context / captured-at time.
2. Update README to explain that generated session summaries may include capturedAt when source messages provide timestamps.
3. Update roadmap status for Phase 20 Slice 3.
4. Update handoff with branch, scope, and out-of-scope behavior.

### 6. Review and verification

Tasks:
1. Run targeted tests while implementing.
2. Run full verification:
   ```bash
   pnpm build
   pnpm test
   git diff --check
   ```
3. Request independent reviewer focused on:
   - no payload expansion;
   - no recall/injection behavior changes;
   - no new commands/tools/config flags;
   - capturedAt accuracy and validation;
   - all save paths passing candidate freshness.
4. Repair any blockers.
5. Commit, push, open PR, and stop for merge.

## Out-of-scope reminders

- Do not use current time as a fallback for `freshness.capturedAt`.
- Do not add `memory-lane refresh`.
- Do not add `memory-lane consolidate`.
- Do not add recall/injection expiry behavior.
- Do not add adapter payload fields just to get timestamps.
- Do not add `freshness` to checkpoint `MemoryCandidate` until lifecycle timestamp fields are deliberately introduced.
- Do not migrate or backfill existing memories.
