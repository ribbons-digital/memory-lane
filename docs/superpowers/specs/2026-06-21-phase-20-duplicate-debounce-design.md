# Phase 20 Slice 2 Design — Pending Continuity Candidate Debounce

Date: 2026-06-21
Branch: `feature/phase-20-duplicate-debounce`

## Goal

Reduce review-queue noise from repeated pending continuity candidates, especially back-to-back `session_summary` memories and repeated `project_checkpoint` captures for the same release/merge/progress event.

This slice keeps Memory Lane review-first and non-destructive: duplicate candidates are skipped before writing new pending records. Existing memories are not modified, merged, deleted, approved, rejected, superseded, or re-ranked.

## Background

Phase 17 added first-slice checkpoint dedupe for inferred checkpoint candidates. Phase 20 Slice 1 added optional freshness metadata but intentionally did not change recall, injection, refresh, consolidation, cleanup, or lifecycle behavior.

Real cross-harness review showed a remaining high-noise path: session summaries and checkpoint candidates can be queued repeatedly from the same session or review flow. That creates unnecessary pending memories and makes continuity harder to inspect.

## Terminology

- **Pending continuity candidate**: a pending `session_summary` or `project_checkpoint` memory created by lifecycle/session-summary capture before human approval.
- **Candidate debounce**: deterministic suppression of a newly generated pending continuity candidate when an equivalent pending or approved memory is already visible for the same project/scope.
- **Same-session summary duplicate**: a `session_summary` candidate with the same provenance session id and adapter/event as an existing visible pending or approved `session_summary`.
- **Equivalent summary duplicate**: a `session_summary` candidate whose normalized durable content matches an existing visible pending or approved `session_summary` after removing generated heading/date noise and review-management chatter.
- **Review-management chatter**: self-referential text about Memory Lane review queues, memory IDs, approval/rejection instructions, or commands such as `memory-lane review`, when that text is not itself the durable work outcome.

## Resolved design questions

### 1. Is this a consolidation command?

Recommendation: No.

This slice should not add `memory-lane consolidate`, `refresh`, cleanup, or apply/dry-run surfaces. It only prevents obvious duplicate pending writes at lifecycle/session-summary generation time.

### 2. Should duplicate candidates be auto-rejected or deleted?

Recommendation: No.

A duplicate candidate should simply not be written. Existing pending/approved records remain untouched. This preserves append-only auditability and avoids surprising review-queue mutation.

### 3. Should approved memories participate in debounce?

Recommendation: Yes, but only as blockers for new duplicate pending candidates.

If a pending/approved visible project summary or checkpoint already represents the same event/session/content, Memory Lane should not queue another pending copy. It should not change the approved memory.

### 4. Should `session_summary` debounce happen in adapters or lifecycle?

Recommendation: Lifecycle.

`handleSessionEnd` already receives the engine and refreshes project scope. Putting deterministic filtering there keeps CLI, Claude, Codex, and pi behavior consistent without duplicating logic in each adapter save helper.

### 5. What keys are safe for session-summary debounce?

Recommendation: Use two deterministic keys, with no LLM classifier:

1. **Provenance session key** when candidate and existing memory both have:
   - `kind: "session_summary"`
   - visible current project/global scope
   - pending or approved status
   - `provenance.lifecycleEvent: "session_end"`
   - same `provenance.adapter` when available
   - same non-empty `provenance.sessionId`
2. **Normalized content key** after stripping generated session-summary headings/dates, compacting whitespace, and removing review-management chatter lines.

If neither key is available, write the candidate normally.

### 6. Should checkpoint debounce be broadened?

Recommendation: Yes, narrowly.

The existing checkpoint key logic already handles release and PR merge well. This slice may add deterministic keys for high-signal repeated verification/docs/roadmap/fix checkpoint sentences when they are already recognized by existing checkpoint extraction. It should not attempt broad semantic duplicate detection.

### 7. Should session-summary prompt/filtering reduce review chatter?

Recommendation: Yes, narrowly.

Update the default summarization prompt to tell the provider not to include Memory Lane review queue management, memory IDs, or approval/rejection instructions unless the user explicitly made review decisions that are themselves the durable outcome. Add deterministic post-generation filtering for obvious review-management chatter lines before constructing the candidate.

### 8. Should skipped duplicate candidates be surfaced to users?

Recommendation: Keep quiet for normal hook flows.

Existing hooks are intentionally low-noise. Returning no candidate should behave like “no durable memory generated.” Tests can assert no new save occurs. Debug logging may continue to report count-only metadata where existing debug paths already do so, but this slice should not add user-facing notices.

## Scope

### In scope

1. Add shared lifecycle helpers for deterministic `session_summary` duplicate keys.
2. Filter duplicate session-summary candidates in `handleSessionEnd` before adapters/CLI/pi save them.
3. Strengthen deterministic checkpoint debounce where existing checkpoint extraction already identifies a stable event key.
4. Update default session-summary prompt and/or post-generation cleanup to avoid self-referential review chatter.
5. Add tests across lifecycle and adapter/CLI seams proving duplicate candidates are skipped without changing existing memories.
6. Update README/ROADMAP/HANDOFF and glossary docs.

### Out of scope

- New CLI commands or MCP tools.
- `memory-lane refresh`.
- `memory-lane consolidate`.
- Automatic approval, rejection, deletion, cleanup, supersede, or replacement.
- Recall ranking or lifecycle injection changes.
- LLM duplicate/stale classifier.
- Transcript storage or raw tool-output storage.
- First-class workstream/thread/session schema.
- Migration of existing duplicate pending memories.

## Acceptance criteria

1. A second session-summary generation for the same visible project/session id does not write another pending `session_summary`.
2. A repeated summary with equivalent durable content but different generated date heading does not write another pending `session_summary`.
3. Review-management chatter such as “approve memory IDs” or “run memory-lane review” is not preserved in generated session-summary candidates unless it is part of explicit durable review decisions.
4. Existing pending or approved checkpoint memories continue to suppress repeated release/PR checkpoint candidates.
5. Any broadened checkpoint debounce remains deterministic and limited to existing high-signal checkpoint extraction categories.
6. Existing save/review/list/continuity behavior for non-duplicate memories is unchanged.
7. Full verification passes:
   - `pnpm build`
   - `pnpm test`
   - `git diff --check`

## Risks and mitigations

- **Risk:** Over-aggressive normalization skips genuinely new summaries.
  - **Mitigation:** Use same-session provenance first and exact normalized durable-content matching second; avoid fuzzy similarity.
- **Risk:** Review chatter filtering removes meaningful decisions.
  - **Mitigation:** Filter only obvious Memory Lane review-management lines; keep durable decisions and completed outcomes.
- **Risk:** Debounce becomes hidden behavior users cannot inspect.
  - **Mitigation:** Keep behavior limited to non-writing duplicate candidates; document it and preserve review surfaces for records that are written.
- **Risk:** Checkpoint key expansion accidentally treats unrelated verification events as identical.
  - **Mitigation:** Only derive keys from already recognized high-signal checkpoint categories and keep fallback behavior unchanged.
