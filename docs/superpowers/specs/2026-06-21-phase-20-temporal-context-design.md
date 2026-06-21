# Phase 20 Slice 3 Design — Temporal Context for Continuity Records

Date: 2026-06-21
Branch: `feature/phase-20-temporal-context`

## Goal

Strengthen Memory Lane continuity by attaching trustworthy temporal context to generated continuity records, especially `session_summary` and `project_checkpoint` memories.

This slice should make future “what happened when?”, “what changed since?”, “resume from latest progress,” refresh, and consolidation flows more reliable without changing recall, injection, cleanup, or review behavior yet.

## Background

Phase 20 Slice 1 added optional advisory `freshness` metadata with `expiresAt`, `staleAfterDays`, and `capturedAt`.

Phase 20 Slice 2 reduced continuity noise by debouncing duplicate pending session summaries and checkpoint candidates.

The next continuity foundation is making generated continuity records carry event/session time when Memory Lane already has trustworthy timestamps. Today, generated records have `createdAt`/`updatedAt`, but that is the write time. For session summaries and checkpoint candidates, write time is not always the same as the event time or represented session time.

## Terminology

- **Temporal context**: Advisory time metadata attached to a generated continuity memory that describes the source/as-of time represented by the record.
- **Captured-at time**: The advisory `freshness.capturedAt` timestamp on a memory record. For generated continuity records in this slice, it means “the best known source/as-of timestamp for the summarized session content,” not expiration time and not Memory Lane write time.
- **Write time**: The normal `createdAt` / `updatedAt` timestamp produced when Memory Lane appends a memory record.
- **Trustworthy timestamp**: A timestamp already present in lifecycle inputs or session messages and parseable as an ISO date/time, without adding new adapter payload fields.

## Recommendation

Populate `freshness.capturedAt` for generated `session_summary` candidates when trustworthy message timestamps already exist. Checkpoint candidates remain unchanged in this slice because current lifecycle checkpoint inputs do not expose event timestamps.

Keep the behavior advisory and metadata-only. Do not filter, sort, inject, refresh, consolidate, delete, or auto-approve based on the new metadata in this slice.

## Design decisions

### 1. What should get `capturedAt`?

In scope:

- `session_summary` candidates created by `handleSessionEnd`.
- `project_checkpoint` candidates created by lifecycle checkpoint capture from Stop/PostToolUse.

Out of scope:

- Manual `memory-lane save` / `suggest` defaults beyond the existing explicit freshness flags.
- Correction/procedure candidates.
- Existing historical memories.
- Imported Obsidian notes.

### 2. What timestamps are trustworthy enough?

Use only timestamps already exposed by current types/payloads:

- Session summary:
  - Use the latest valid `SessionMessage.timestamp` from the included messages.
  - This is an explicit **session-end/as-of anchor**: the summary represents the session content up to the latest timestamped message.
  - If no valid message timestamp is available, leave `freshness.capturedAt` unset in this slice.
  - Do not use current clock as a fallback because that would conflate Memory Lane write time with source/session time.
- Checkpoint from Stop:
  - Current `StopInput` does not expose an event timestamp. Under the no-payload-expansion rule, Stop checkpoint `capturedAt` remains unset in this slice.
- Checkpoint from PostToolUse:
  - Current `PostToolUseInput` does not expose an event timestamp. Under the no-payload-expansion rule, tool checkpoint `capturedAt` remains unset in this slice.

Important: this slice must not expand adapter payload contracts just to get timestamps. A later slice may add timestamp plumbing deliberately if needed.

### 3. Why not use current generation time?

`createdAt` and `updatedAt` already represent write time. Setting `freshness.capturedAt` to `new Date()` when no trustworthy source/session timestamp exists would create a misleading second timestamp. For continuity, inaccurate temporal context is worse than absent temporal context.

For session summaries, latest message timestamp can still differ from write time when a summary is generated later from an existing transcript. That is the useful distinction this slice preserves.

### 4. Should recall or injection use capturedAt?

No. This slice stores and validates metadata only. Recall/injection behavior remains unchanged.

### 5. Should status/continuity surfaces change?

Only if an existing surface already includes record freshness metadata through normal memory rendering/list/review/status behavior. Do not add new CLI commands, MCP tools, or behavior-changing status logic. Documentation is enough for this slice.

### 6. How should candidates carry metadata internally?

Add optional `freshness` metadata only to the internal candidate shapes where needed now:

- `SessionEndCandidate` in `packages/lifecycle/src/session-end.ts` should allow optional freshness so CLI/Claude/Codex/pi save helpers can pass it through.
- `MemoryCandidate` checkpoint freshness plumbing is deferred because Stop/PostToolUse inputs do not currently expose timestamps. Add that later together with deliberate timestamp payload plumbing.

This preserves existing save validation as the source of truth.

## Scope

### In scope

1. Add optional freshness metadata to `SessionEndCandidate`.
2. Populate `freshness.capturedAt` for session summaries from the latest valid message timestamp as the session-end/as-of anchor.
3. Pass candidate freshness through CLI, Claude, Codex, and pi session-summary save paths.
4. Explicitly leave checkpoint candidate `capturedAt` unset because current Stop/PostToolUse inputs do not expose trustworthy timestamps.
5. Add tests proving session-summary capturedAt is stored and invalid/missing timestamps are ignored.
6. Update README, ROADMAP, HANDOFF, and CONTEXT glossary.

### Out of scope

- New CLI commands or MCP tools.
- New config flags.
- Adapter payload expansion for timestamps.
- Current-clock fallback for capturedAt when event/session time is unknown.
- Recall/injection filtering, sorting, deprioritization, or expiry behavior.
- Refresh command.
- Consolidation command.
- Automatic deletion, rejection, approval, supersede, or cleanup.
- LLM stale classifier.
- Migration/backfill of historical memories.

## Acceptance criteria

1. `handleSessionEnd` returns a `session_summary` candidate with `freshness.capturedAt` set to the latest valid message timestamp when messages include timestamps.
2. Session summary save paths in CLI, Claude, Codex, and pi pass candidate freshness through to `MemoryEngine.save`.
3. Missing, invalid, or non-ISO session message timestamps do not throw and do not set `capturedAt`.
4. Session-summary heading date remains the generation/write date; `freshness.capturedAt` may differ and represents source/session as-of time.
5. Checkpoint capture behavior remains unchanged and checkpoint candidates do not get capturedAt in this slice.
6. No recall/injection behavior changes.
7. No new CLI/MCP/config surfaces.
8. Full verification passes:
   - `pnpm build`
   - `pnpm test`
   - `git diff --check`

## Risks and mitigations

- **Risk:** Misleading capturedAt if current time is used as event time.
  - **Mitigation:** Do not use current clock fallback in this slice.
- **Risk:** Adapters lose freshness metadata because save helpers omit it.
  - **Mitigation:** Add explicit tests for at least shared lifecycle plus one adapter/CLI path and inspect all save helpers.
- **Risk:** Timestamp parsing accepts invalid strings.
  - **Mitigation:** Reuse core freshness validation by passing only ISO-valid timestamps, and test invalid strings are ignored.
- **Risk:** This feels too small for continuity.
  - **Mitigation:** It is intentionally foundational; it makes later cross-session freshness, refresh, and consolidation reliable without behavior drift.
