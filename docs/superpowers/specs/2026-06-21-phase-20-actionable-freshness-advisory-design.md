# Phase 20 Slice 5 — Actionable Freshness Advisory Design

## Status

Approved for implementation after Opus 4.8 consensus review on 2026-06-21.

## Problem

Phase 20 Slice 4 surfaces read-only freshness advisories for approved visible memories with explicit freshness metadata. It can tell a user that a memory is `stale` or `expired`, but the current advisory mostly points back to status inspection. It does not yet make the next manual revision step obvious.

A full `memory-lane refresh` command remains premature: freshness advisories have just shipped, and Memory Lane should prove that deterministic, text-free advisory guidance is useful before adding a dedicated refresh workflow or any apply semantics.

## Goals

1. Make existing freshness advisories actionable by attaching deterministic per-id suggested actions that use existing Memory Lane revision commands.
2. Keep suggestions dry-run-biased, review-first, and clearly advisory.
3. Surface suggestions through existing status/doctor/continuity/MCP read models only.
4. Preserve all existing behavior for recall, injection, approval/rejection/deletion, refresh, consolidation, cleanup, and adapter payloads.
5. Keep status/MCP advisory metadata text-free.

## Non-goals

- No `memory-lane refresh` command.
- No `refresh --apply` or new apply semantics.
- No new CLI command or MCP tool.
- No LLM stale classifier.
- No automatic update, replace, supersede, reject, delete, approve, cleanup, or consolidation.
- No recall, semantic ranking, lifecycle injection, or context-selection behavior changes.
- No adapter payload expansion.
- No suggestions for `reject` or `delete` in this slice.
- No new freshness classification such as `aging`.

## Behavior

For freshness advisory entries that are already classified as `stale` or `expired`, Memory Lane attaches per-id suggested actions.

For `stale`:

```text
memory-lane update <id> --text <updated-memory-text> --dry-run
```

For `expired`:

```text
memory-lane update <id> --text <updated-memory-text> --dry-run
memory-lane replace <id> --text <new-memory-text> --dry-run
memory-lane supersede <new-id> <id> --dry-run
```

These actions mean “inspect or consider using existing revision commands.” They do not imply the command will be run, that mutation is recommended, or that the memory should be hidden/deleted.

## Data/API changes

Extend freshness advisory metadata with optional existing-command suggestions:

```ts
freshness?: {
  classification: FreshnessClassification
  expiresAt?: string
  staleAfterDays?: number
  capturedAt?: string
  staleAnchor?: string
  suggestedActions?: string[]
}
```

The suggestions are text-free and deterministic from `(classification, id)`.

The existing `freshness-advisory` continuity hint should include the same bounded per-id actions in its aggregate `suggestedActions`, deduped with the existing action aggregation helper.

## Surfaces

Existing surfaces only:

- Core `FreshnessStatus` / `MemoryEngine.freshnessStatus()`.
- `MemoryEngine.doctor()` and CLI `status` / `doctor`.
- MCP `memory_status`.
- Core continuity hints/read model, CLI `continuity`, MCP `memory_continuity`.

No CLI command, MCP tool, flag, config, lifecycle event, or adapter payload surface is added.

## Privacy and safety

- No memory text is included in freshness status/advisory metadata.
- Suggestions include ids and command strings only.
- `reject` and `delete` are intentionally not suggested because they are destructive and cannot be chosen safely by deterministic freshness metadata alone.
- Expired/stale memories remain approved and visible; recall/injection remains unchanged.

## Tests

Add or update tests for:

1. Stale entries include `memory-lane update <id> --text <updated-memory-text> --dry-run`.
2. Expired entries include `update`, `replace`, and `supersede` dry-run suggestions using the actual id.
3. Current/none entries do not include suggested actions.
4. Bounded advisory entries preserve suggested actions and do not leak memory text.
5. `freshness-advisory` continuity hint aggregates and dedupes suggested actions.
6. CLI/MCP status JSON includes text-free suggested actions via existing surfaces.
7. Human output, if changed, remains compact and advisory.

## Documentation

Update README/CONTEXT/ROADMAP/HANDOFF to clarify:

- Freshness advisories now suggest existing revision commands to consider.
- Suggestions are dry-run-biased and advisory.
- `memory-lane refresh` remains deferred.
- Expired/stale memories remain approved, visible, and eligible for recall/injection exactly as before.

## Risks and mitigations

- **Risk:** Users may read suggestions as automated recommendations to mutate.
  - **Mitigation:** Use “suggested actions” and `--dry-run`; docs state inspect/consider only.
- **Risk:** Deterministic command suggestions may not pick the perfect revision path.
  - **Mitigation:** For expired entries, list multiple existing revision options instead of choosing one.
- **Risk:** Surface area creep.
  - **Mitigation:** No new commands/tools; use only existing freshness/advisory serialization.
