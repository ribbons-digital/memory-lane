# Phase 20 Slice 1 — Expiration Metadata Design

## Goal

Add a small, non-breaking time-awareness foundation to Memory Lane records so later Phase 20 slices can identify stale memories, propose refreshes, and consolidate noisy overlap without silently deleting or hiding user data.

This slice covers only optional metadata and first-class validation/rendering. It does not implement automatic cleanup, refresh scans, consolidation, or recall/injection filtering.

## Problem

Memory Lane now captures more durable project state: session summaries, checkpoint candidates, workflow corrections, procedure candidates, preferences, and decisions. Some memories are timeless, but others become misleading over time:

- temporary status: “the build is broken”
- plans tied to a period: “I am traveling next week”
- pending project facts that should be revisited after a release
- summaries/checkpoints that need a stable event time for future refresh/consolidation

Today Memory Lane has `createdAt` and `updatedAt`, but no way to distinguish when a memory’s content should be considered stale or expired. Phase 20 needs a minimal metadata base before adding refresh/consolidation behavior.

## Non-goals

- No automatic deletion.
- No automatic rejection of pending memories.
- No refresh command in this slice.
- No consolidation command in this slice.
- No LLM stale-memory classifier.
- No recall or lifecycle injection filtering in this slice.
- No migration required for existing JSONL records.
- No new memory status such as `expired` or `stale`.
- No native MCP mutation tools beyond existing save/suggest inputs.

## Terminology

### Memory freshness metadata

Optional time metadata on a memory record that describes when the content should be treated as expired or stale. It is advisory metadata until later slices add refresh or selection behavior.

### `expiresAt`

An optional ISO timestamp. Once the current time is at or after `expiresAt`, future slices may treat the memory as expired for recall/injection/refresh purposes. This slice only stores, validates, and surfaces it.

### `staleAfterDays`

An optional positive integer day count. Future slices may calculate staleness relative to the memory’s event/reference time. This slice only stores, validates, and surfaces it.

### `capturedAt`

An optional ISO timestamp representing the event or session date the memory is about, distinct from storage `createdAt`. For user-created memories it is usually omitted. For generated session summaries and checkpoint candidates it can preserve the summarized session/progress date for future refresh/consolidation.

## Proposed data model

Add an optional `freshness` object to `MemoryRecord` and `SaveInput`:

```ts
interface MemoryFreshness {
  expiresAt?: string
  staleAfterDays?: number
  capturedAt?: string
}

interface MemoryRecord {
  // existing fields...
  freshness?: MemoryFreshness
}

interface SaveInput {
  // existing fields...
  freshness?: MemoryFreshness
}
```

Rationale for a nested object:

- Keeps time-awareness grouped and optional.
- Avoids crowding the top-level record as Phase 20 grows.
- Leaves room for future freshness metadata without changing the record shape repeatedly.

## Validation rules

- `freshness` is optional.
- `expiresAt`, if present, must be an ISO timestamp accepted by the existing strict timestamp validator.
- `capturedAt`, if present, must be an ISO timestamp accepted by the existing strict timestamp validator.
- `staleAfterDays`, if present, must be a positive integer (`>= 1`).
- At least one freshness field must be present if `freshness` is provided.
- Invalid freshness metadata should fail `save`, `suggest`, JSONL normalization, and MCP/CLI save attempts with a clear error.

## CLI scope

Extend existing save/suggest commands only:

```bash
memory-lane save "..." --expires-at 2026-07-01T00:00:00.000Z
memory-lane save "..." --stale-after-days 30
memory-lane suggest "..." --captured-at 2026-06-21T00:00:00.000Z
```

Rules:

- `--expires-at <iso>` maps to `freshness.expiresAt`.
- `--stale-after-days <n>` maps to `freshness.staleAfterDays`.
- `--captured-at <iso>` maps to `freshness.capturedAt`.
- Human list/review output may show compact freshness labels when present.
- JSON output should include the stored `freshness` object naturally as part of each memory record.

No new CLI command is added in this slice.

## MCP scope

Extend existing `memory_save` and `memory_suggest` inputs with optional freshness fields:

```ts
{
  text: string,
  category?: MemoryCategory,
  scope?: MemoryScopeType,
  kind?: MemoryKind,
  expiresAt?: string,
  staleAfterDays?: number,
  capturedAt?: string,
}
```

Handlers should pass these fields into `engine.save` / `engine.suggest` through `SaveInput.freshness`.

No new MCP tool is added in this slice.

## Lifecycle scope

Generated memories do not set `capturedAt` in this slice unless an existing lifecycle input already exposes a trustworthy event timestamp without expanding adapter payloads. Existing session-summary and checkpoint-capture inputs do not consistently expose such timestamps, so lifecycle auto-population is deferred.

This slice should not infer `expiresAt`, `staleAfterDays`, or `capturedAt` automatically from memory text.

## Read/rendering scope

- `memory-lane list`, `memory-lane review`, and JSON output should preserve freshness metadata.
- Human formatters may add a short suffix such as `expires 2026-07-01` or `stale after 30d` when present.
- `memory_status`/doctor do not need new counters in this slice unless trivial and text-free.
- Continuity/read-model behavior remains unchanged; freshness metadata can appear on memory previews only if those previews already include the full record/metadata.

## Backward compatibility

- Existing JSONL records without `freshness` remain valid.
- Existing embeddings remain valid because freshness metadata does not change memory text.
- Existing save/suggest calls remain valid.
- Existing CLI/MCP clients are unaffected unless they opt into the new fields.
- No migration is required.

## Acceptance criteria

1. `MemoryRecord` and `SaveInput` support optional `freshness` metadata.
2. JSONL normalization accepts records without freshness and rejects malformed freshness metadata.
3. `engine.save` and `engine.suggest` can persist valid freshness metadata.
4. CLI `save` and `suggest` accept `--expires-at`, `--stale-after-days`, and `--captured-at`.
5. MCP `memory_save` and `memory_suggest` accept `expiresAt`, `staleAfterDays`, and `capturedAt`.
6. Human CLI list/review output surfaces freshness metadata compactly when present.
7. No recall, lifecycle injection, automatic cleanup, refresh, or consolidation behavior changes in this slice.
8. Tests cover valid metadata, invalid timestamps, invalid day counts, historical records without metadata, CLI flags, and MCP inputs.
9. `pnpm build`, `pnpm test`, and `git diff --check` pass.

## Deferred Phase 20 work

- `memory-lane refresh` stale/expired-memory proposals.
- Recall/injection deprioritization or filtering for expired memories.
- Consolidation proposals and apply flow.
- Duplicate/debounce handling for generated summaries/checkpoints.
- Session-summary prompt cleanup for self-referential review chatter.
