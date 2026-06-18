# Memory Revision Primitives Design

## Status

Draft for review. This spec covers **Phase 16 Slice 3 — Update / replace / supersede primitives**.

## Goal

Add explicit CLI-first, append-only primitives for revising active memories and marking approved memories as superseded, without automatic cleanup, lifecycle injection, MCP mutation tools, retrieval filtering changes, or broad consolidation behavior.

## Background

Phase 16 Slice 1 added read-only freshness/status detection. Phase 16 Slice 2 added read-only operating agreement discovery. Slice 3 gives users and agents a deliberate way to revise durable memory state when a saved memory is wrong, stale, or replaced by a clearer successor.

The concrete product driver remains the loop-memory refinement failure: when the user refined an existing durable workflow, Memory Lane made it easier to create or leave near-duplicate memories than to update an existing one or mark older versions as superseded. Slice 3 should make the explicit revision path available while preserving append-only auditability and avoiding silent cleanup.

## Domain terminology

`CONTEXT.md` now defines:

- **Same-id update** — an append-only revision of an active memory that keeps the same memory id while changing fields such as text, category, kind, or approved/pending status.
- **Supersede relationship** — explicit revision metadata showing that one approved memory is now replaced by another approved memory. Superseded memories remain approved historical records; they are not rejected, deleted, or assigned a new status.

These terms complement the Slice 2 operating agreement terms. A related operating agreement candidate is not automatically superseded; supersede relationships are written only by explicit commands.

## Decisions

### 1. Separate same-id updates from new-id replacement relationships

Slice 3 has two distinct revision concepts:

1. **Same-id update** — refine or correct one memory while preserving its id.
2. **Replace/supersede** — create or identify a newer memory and mark older approved memories as superseded by it.

This keeps “fix this memory” separate from “this memory replaces those memories.”

### 2. Keep superseded records approved

Slice 3 does not add a `superseded` status. Superseded records remain `status: "approved"` with revision metadata. The existing `status` lifecycle remains review-oriented: `pending`, `approved`, `rejected`, `deleted`.

This avoids breaking existing list/review/recall/status assumptions and preserves the fact that superseded memories were valid historical records.

### 3. Latest revision metadata on folded records

Add optional revision metadata to `MemoryRecord`:

```ts
export type MemoryRevisionActor = "manual" | "cli" | "mcp"

export interface MemoryRevision {
  supersedes?: string[]
  supersededBy?: string
  reason?: string
  revisedAt: string
  revisedBy: MemoryRevisionActor
}

export interface MemoryRecord {
  // existing fields...
  revision?: MemoryRevision
}
```

The folded active record stores only the latest revision metadata. Full revision history remains available in the append-only JSONL log. Slice 3 does not add a user-facing history command.

### 4. Existing successor supersede supports many old memories

`supersede` links an existing approved successor to one or more approved old memories:

```bash
memory-lane supersede <new-id> <old-id...> [--reason "..."] [--dry-run] [--yes]
```

The successor receives:

```ts
revision: {
  supersedes: ["old1", "old2"],
  reason,
  revisedAt,
  revisedBy: "cli"
}
```

Each old memory receives:

```ts
revision: {
  supersededBy: "newId",
  reason,
  revisedAt,
  revisedBy: "cli"
}
```

A single successor may supersede multiple old memories, but the relationship is never inferred automatically.

### 5. Replace always creates a new successor

`replace` creates a new successor memory from explicit text or stdin, then optionally marks old memories as superseded by it:

```bash
memory-lane replace <old-id...> --text "new memory text" [--category ...] [--kind ...] [--status pending|approved] [--reason "..."] [--dry-run] [--yes]
cat new.md | memory-lane replace <old-id...> --stdin --kind workflow_rule --reason "..." --yes
```

`replace` does not support `--from <existing-id>`. Existing successors use `supersede`.

Default successor fields are inherited from the first old memory:

- `scope` from first old memory
- `category` from first old memory unless `--category` is provided
- `kind` from first old memory unless `--kind` is provided
- `status` defaults to `approved`, unless `--status pending|approved` is provided
- `source` is `manual`
- `provenance` is absent
- project metadata follows the inherited scope/current project behavior without introducing scope migration semantics

### 6. Pending successors carry forward intent only

Only approved successors can actively supersede approved old memories.

For `replace --status approved`:

- create the approved successor
- add `revision.supersedes` to the successor
- mark old approved memories with `revision.supersededBy`

For `replace --status pending`:

- create the pending successor with `revision.supersedes`
- do not mutate old memories
- do not mark old memories as superseded until a later explicit approved-successor `supersede` command is run

This keeps approved old memories authoritative while the replacement is still pending review.

### 7. Same-id update is narrow

Expose existing same-id update behavior through CLI:

```bash
memory-lane update <id> --text "new text" [--category ...] [--kind ...] [--status pending|approved] [--reason "..."] [--dry-run]
cat new.md | memory-lane update <id> --stdin --kind workflow_rule --reason "..."
```

`update` may change only:

- `text`
- `category`
- `kind`
- `status` (`pending` or `approved`)

It must not change:

- `scope`
- `source`
- `provenance`
- `project`
- `id`
- `createdAt`

`update` requires at least one real field change. `--reason` is optional and may be recorded as revision metadata only when a real change is present. Metadata-only and no-op updates fail before writing.

### 8. Dry-run and confirmation behavior

All three commands support dry-run:

```bash
memory-lane update <id> ... --dry-run
memory-lane replace <old-id...> ... --dry-run
memory-lane supersede <new-id> <old-id...> --dry-run
```

Dry-run returns the current/proposed records and warnings but performs no writes, embedding invalidations, or mirror sync.

Confirmation behavior:

- `update` does not require `--yes`.
- `supersede <new-id> <old-id>` does not require `--yes`.
- `replace <old-id> --text ...` does not require `--yes`.
- multi-old `supersede` and multi-old `replace` require `--yes` unless `--dry-run` is present.

Slice 3 does not add `--force`.

### 9. All-or-nothing validation

Relationship operations validate all inputs before writing any rows.

`supersede` and approved `replace` fail before writing when:

- successor id is missing
- any old id is missing
- an old id equals successor id
- successor is not approved
- an old memory is not approved
- an old memory is rejected, deleted, pending, or otherwise inactive
- an old memory is already superseded

`replace --status pending` still validates that referenced old ids exist and are approved, but it does not mark them superseded.

Cross-scope or cross-category relationships are allowed but emit warnings in dry-run/result metadata and human output:

- `crossScope: true`
- `crossCategory: true`

These warnings help users spot accidental global/project or category mismatches without blocking deliberate cleanup.

### 10. Embeddings and mirror behavior

Embedding behavior:

- `update`: keep existing behavior — invalidate the updated id and auto-embed if the resulting memory is approved.
- `replace --status approved`: save and auto-embed the successor; invalidate changed old ids because their revision metadata changed.
- `replace --status pending`: do not embed the pending successor; do not invalidate old ids because old ids are unchanged.
- `supersede`: update successor and old ids revision metadata; invalidate all changed approved ids.

Obsidian mirror/import behavior does not change. Existing mutation paths should continue to run mirror sync and surface mirror warnings. Slice 3 does not redesign mirror output or import contracts.

### 11. Display behavior

JSON outputs include `revision` automatically anywhere `MemoryRecord` is returned.

Human output should show compact revision labels where useful:

- `memory-lane list`: show labels such as `[supersedes: old1, old2]` and `[superseded by: new1]`.
- `memory-lane review`: show revision labels for pending replacement drafts.
- `memory-lane agreements`: show revision labels because agreements are directly related to overlap/currentness.
- `memory-lane recall`: may stay unchanged in Slice 3 to avoid extra noise.

Slice 3 does not change operating agreement selector ranking/filtering. It may display revision labels for selected records, but it must not hide or deprioritize superseded memories yet.

## Proposed core API

### Types

Add:

```ts
export type MemoryRevisionActor = "manual" | "cli" | "mcp"

export interface MemoryRevision {
  supersedes?: string[]
  supersededBy?: string
  reason?: string
  revisedAt: string
  revisedBy: MemoryRevisionActor
}
```

Extend:

```ts
export interface MemoryRecord {
  revision?: MemoryRevision
}

export interface UpdateInput {
  text?: string
  category?: MemoryCategory
  status?: Extract<MemoryStatus, "pending" | "approved">
  kind?: MemoryKind
  reason?: string
  revisedBy?: MemoryRevisionActor
  dryRun?: boolean
}
```

Exact result types may be refined during planning, but should distinguish applied vs dry-run outcomes and include warnings.

### Engine methods

Add or extend methods equivalent to:

```ts
engine.update(id, patch): MemoryMutationResult | undefined

engine.previewUpdate(id, patch): UpdatePreview | undefined

engine.supersede(newId, oldIds, opts?: {
  reason?: string
  revisedBy?: MemoryRevisionActor
  dryRun?: boolean
}): SupersedeResult

engine.replace(oldIds, input: {
  text: string
  category?: MemoryCategory
  kind?: MemoryKind
  status?: Extract<MemoryStatus, "pending" | "approved">
  reason?: string
  revisedBy?: MemoryRevisionActor
  dryRun?: boolean
}): ReplaceResult
```

The implementation can choose exact names, but the behavior must remain CLI-first, explicit, append-only, validated before writes, and dry-run capable.

## CLI surface

Add commands:

```bash
memory-lane update <id> --text "..." [--category preference|personal|project] [--kind <kind>] [--status pending|approved] [--reason "..."] [--dry-run]
memory-lane update <id> --stdin [--category ...] [--kind <kind>] [--status pending|approved] [--reason "..."] [--dry-run]

memory-lane supersede <new-id> <old-id...> [--reason "..."] [--dry-run] [--yes]

memory-lane replace <old-id...> --text "..." [--category preference|personal|project] [--kind <kind>] [--status pending|approved] [--reason "..."] [--dry-run] [--yes]
memory-lane replace <old-id...> --stdin [--category ...] [--kind <kind>] [--status pending|approved] [--reason "..."] [--dry-run] [--yes]
```

Human output should clearly state:

- whether the operation was dry-run or applied
- successor id for replace/supersede
- old ids affected
- warnings for cross-scope/category relationships
- revision labels
- mirror warnings when applicable

JSON output should include structured data for current/proposed/applied records, warnings, and dry-run state.

## MCP surface

Slice 3 adds no MCP mutation tools.

Existing MCP list/status surfaces may expose revision metadata only because `MemoryRecord` JSON now includes `revision` where records are returned. MCP `memory_status` should not gain full memory text or mutation tools as part of this slice.

## Privacy and safety

- No automatic cleanup, consolidation, or deletion.
- No lifecycle injection changes.
- No broad recall/context filtering changes.
- No MCP mutating revision commands.
- Relationship writes validate all inputs before appending any rows.
- Multi-old relationship writes require `--yes` unless dry-run.
- Dry-run writes nothing and invalidates nothing.
- Pending successors do not supersede approved memories until an explicit approved-successor supersede command.
- Superseded records remain approved historical records.

## Testing requirements

Core tests should cover:

- `revision` metadata is preserved by storage normalization and folded records.
- same-id update with real field changes appends a row with same id, preserves identity fields, invalidates embeddings, and records revision metadata when reason is supplied.
- update rejects no field changes and no-op patches.
- update dry-run returns proposed changes without writing, invalidating embeddings, or syncing mirror.
- supersede validates missing ids, self-reference, non-approved successor, non-approved old ids, and already-superseded old ids before writing.
- supersede many old → one new appends successor and old rows with correct reciprocal revision metadata.
- supersede dry-run returns proposed changes and warnings without writes.
- replace approved creates a successor and marks old ids superseded.
- replace pending creates a pending successor with `supersedes` and leaves old ids unchanged.
- replace inherits first old memory scope/category/kind and supports category/kind/status overrides.
- cross-scope/category relationships emit warnings but are allowed.
- mirror warnings are returned on successful mutation without preventing JSONL writes.

CLI tests should cover:

- `memory-lane update` with `--text`, `--stdin`, `--reason`, `--dry-run`, invalid/no-op inputs, and JSON/human output.
- `memory-lane supersede` single old id, multi-old `--yes`, multi-old missing `--yes`, `--dry-run`, invalid ids/statuses, cross-scope/category warnings, and JSON/human output.
- `memory-lane replace` approved and pending status, `--text`, `--stdin`, inheritance/overrides, multi-old `--yes`, `--dry-run`, and JSON/human output.
- human `list`, `review`, and `agreements` show compact revision labels.
- JSON list/review/agreements include `revision` fields automatically.

MCP tests are not required for mutation tools because none are added. Existing MCP tests should continue to pass; add a small assertion only if storage normalization needs explicit MCP-facing coverage.

## Documentation updates

Update after implementation:

- `README.md` — document `update`, `replace`, `supersede`, dry-run, `--yes`, and scope boundaries.
- `skills/memory-lane/SKILL.md` — guide agents to prefer update/replace/supersede over saving near-duplicate workflow memories.
- `ROADMAP.md` — mark Phase 16 Slice 3 complete and keep Slice 4 as next.
- `HANDOFF.md` — record Slice 3 completion and next recommended Slice 4.
- `CONTEXT.md` — already updated during grill-with-docs with same-id update and supersede relationship terminology.

## Out of scope

- MCP mutation tools for update/replace/supersede.
- Lifecycle injection changes.
- Recall/context/agreements filtering or deprioritizing superseded memories.
- Automatic duplicate detection, consolidation, cleanup, or deletion.
- A `history` command.
- Compaction behavior changes.
- Obsidian-specific mirror/import behavior changes.
- `--force` relationship rewrites.
- Scope/source/provenance migration.
- `replace --from <existing-id>`.

## Open decisions

None. The user approved the core design decisions during grill-with-docs.
