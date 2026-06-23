# Phase 21 Memory Hygiene UX Hardening Design

## Status

Design draft for the next Phase 21 follow-up after `v0.2.24`.

## Context

Phase 21 has been moving Memory Lane toward handoff-free sessions through bounded continuity surfaces. After `v0.2.24`, Claude Desktop was dogfooded with the broad prompt “What were we last working on?” This time it successfully used the `memory-lane` CLI and reported the correct status, which is positive evidence for the Phase 21 routing goal.

The same dogfood run surfaced hygiene UX issues:

- The agent tried `memory-lane recall --id <id>`, but `recall` is query retrieval, not exact-id lookup. The command did not provide a clear exact-id path and returned unrelated results.
- The agent fell back to scripting around `memory-lane list --json` and `list --all --json` to inspect exact ids.
- The agent found three leaked subagent task-contract / acceptance-finalization memories and soft-deleted them after user approval.
- A benign `project-loop` operating-agreement overlap remained: one memory is the canonical global loop-engineering workflow, while another is a Wispergo-specific HANDOFF rule currently stored at global scope.
- The clean fix for the Wispergo-specific global memory would be scope correction, but Memory Lane has no `rescope` / `move` command today, so delete-and-resave is the only available workaround and would mint a new id.

This design adds a small, explicit hygiene UX slice so agents and users can inspect exact records and correct scope metadata without using broad JSON scripting or delete-as-rescope workarounds.

## Goals

1. Add a reliable exact-id inspection path for CLI users and MCP clients.
2. Make the boundary between query recall and exact-id lookup explicit.
3. Add a safe same-id scope correction workflow for active memories.
4. Preserve review-governed, append-only, local-first behavior.
5. Keep the first mutation surface CLI-only and confirmation-gated.

## Non-goals

This slice does not add:

- MCP mutation tools for rescope/move.
- Stricter delete confirmations or cross-project delete policy changes.
- Automatic cleanup, automatic rescope, automatic reject/delete, or automatic supersede behavior.
- Recall ranking, retrieval, semantic search, or continuity selection changes.
- Lifecycle injection changes.
- Raw transcript, tool output, or task-log indexing.
- New first-class workstream ids or persisted workstream schema.

## Terminology

### Exact-id lookup

A read operation that returns one Memory Lane record by id, independent of lexical or semantic query scoring. It is not recall and does not rank multiple memories.

### Scope correction

A same-id append-only metadata revision that changes a memory's scope and associated project metadata. It corrects where an existing memory is visible without changing the memory text, status, or id. Scope correction is the explicit command that can resolve a scope-hygiene candidate; scope-hygiene hints remain read-only signals and never rescope records automatically.

## Proposed behavior

### CLI exact-id inspection

Add:

```bash
memory-lane show <id> [--all] [--json]
memory-lane get <id> [--all] [--json]
```

`get` is an alias for `show`.

Default behavior:

- Finds only active records (`approved` or `pending`) visible to the current project scope.
- Active global memories are visible.
- Active current-project memories are visible.
- Cross-project project memories are hidden.
- Deleted and rejected memories are hidden.

With `--all`:

- Finds the id across all project scopes.
- Includes `approved`, `pending`, `rejected`, and `deleted` records.
- Clearly labels the record status, scope, project key, category, kind, source, provenance, created/updated timestamps, and revision metadata when present.

If no record is found:

- Human output says the id was not found in the current scope, and suggests `--all` when not already present.
- JSON output returns a structured not-found result without memory text.

### MCP exact-id inspection

Add read-only MCP tool:

```ts
memory_get({ id: string, all?: boolean, projectPath?: string })
```

Behavior mirrors CLI `show`:

- `all: false` or omitted respects active current-scope visibility.
- `all: true` looks across projects/statuses.
- `projectPath` sets the project scope for visibility checks, matching existing MCP `memory_list`, `memory_review`, and `memory_status` conventions.
- The tool returns one bounded record payload plus scope/status metadata.
- It is read-only and does not approve, reject, delete, rescope, or supersede anything.

### Recall boundary

`memory-lane recall --id <id>` should fail clearly instead of stripping `--id <id>` from positionals and running an empty or unintended recall query. The CLI must check for `--id` on the raw argv before building the recall query, including the missing-value case.

Human error:

```text
Unsupported recall flag: --id. Recall is query search; use `memory-lane show <id>` for exact-id lookup.
```

JSON error includes the same guidance. This keeps `recall` conceptually separate from exact lookup.

### CLI same-id rescope / move

Add:

```bash
memory-lane rescope <id> --scope global --dry-run
memory-lane rescope <id> --scope global --yes
memory-lane rescope <id> --scope project [--project <path>] --dry-run
memory-lane rescope <id> --scope project [--project <path>] --yes
memory-lane move <id> ...
```

`move` is an alias for `rescope`.

Rules:

- Only active records (`approved` or `pending`) can be rescoped.
- Deleted and rejected records cannot be rescoped.
- Actual writes always require `--yes`.
- `--dry-run` previews the current and proposed scope without writing.
- `--scope project --project <path>` resolves the target project identity from that path.
- `--scope project` without `--project` resolves the target project identity from the current cwd.
- `--scope project` must write both `scope: { type: "project", key: resolvedProject.key }` and a `project` snapshot for the resolved target project.
- `--scope global` must set `scope: { type: "global" }` and clear `project` metadata so future inspection does not retain stale project attribution.
- A no-op rescope should fail with a clear message rather than appending an identical revision. No-op detection must compare the normalized current scope/project metadata to the resolved target scope/project metadata, not just compare raw `scope.type` flags.
- Rescope keeps the same memory id and appends a latest-wins record with updated `updatedAt`, following the existing same-id update pattern.
- Text, category, status, source, kind, provenance, createdAt, freshness, and existing revision metadata are preserved. The first slice should defer `--reason` rather than overwrite existing supersede revision metadata.
- Rescope must use its own active-record guard for `approved` and `pending` records, not the approved-only supersede helpers.
- Embeddings for the id are invalidated because visibility changed, even though text did not.
- Obsidian mirror warnings, if any, follow existing mutation result conventions.

Deferred optional flag:

```bash
--reason <text>
```

`--reason` is intentionally deferred from the first implementation because existing `MemoryRevision` metadata currently represents supersede relationships. A later design can add reason support without clobbering existing supersede metadata.

### Output for rescope

Human dry-run output should show:

- id
- status
- old scope and old project key if present
- new scope and new project key if present
- whether this is a dry-run
- exact command to apply with `--yes`

Human success output should show:

- id
- old scope/project
- new scope/project
- confirmation that the same id was preserved

JSON output should include:

```ts
{
  ok: true,
  data: {
    dryRun: boolean,
    current: MemoryRecord,
    proposed: MemoryRecord,
    warnings?: string[]
  }
}
```

For actual writes, `proposed` is the appended current record.

## Core API shape

Add core methods rather than keeping all logic in the CLI:

```ts
getById(id: string, opts?: { all?: boolean }): MemoryRecord | undefined
previewRescope(id: string, input: RescopeInput): RescopeResult | undefined
rescope(id: string, input: RescopeInput): RescopeResult | undefined
```

The engine already knows current project scope through `refreshScope`. `getById` can reuse the same visibility logic as `list`, but it must add explicit status filtering: default lookup includes only `approved` and `pending`, while `{ all: true }` can include `approved`, `pending`, `rejected`, and `deleted`.

Suggested types:

```ts
interface RescopeInput {
  scopeType: "global" | "project"
  projectPath?: string
  dryRun?: boolean
}

interface RescopeResult {
  dryRun: boolean
  current: MemoryRecord
  proposed: MemoryRecord
  warnings: string[]
  mirrorWarnings?: string[]
}
```

## Safety model

This slice is intentionally conservative:

- Exact-id lookup is read-only.
- MCP gets read-only exact-id lookup only.
- Scope mutation is CLI-only.
- Scope mutation requires `--yes` for real writes.
- Dry-run is first-class and should be easy for agents to use before mutating.
- Deleted/rejected records are inspectable with `show --all`, but not mutable through `rescope`.
- The command corrects metadata only; it does not rewrite memory text or mint replacement ids.

## Documentation updates

Update:

- `README.md` command list and examples.
- CLI help output.
- MCP tool documentation for `memory_get`.
- `ROADMAP.md` Phase 21 status.
- `HANDOFF.md` current state.
- `CONTEXT.md` glossary with exact-id lookup and scope correction.

## Test plan

Core tests:

- `getById` returns visible active global/current-project memories by default.
- `getById({ all: true })` returns cross-project, deleted, and rejected records by id.
- `previewRescope` changes global to target project with same id.
- `previewRescope` changes project to global with same id and clears project metadata.
- `rescope` rejects deleted/rejected records.
- `rescope` rejects no-op changes after normalized target scope/project comparison.
- `rescope` appends a same-id latest-wins record, preserves any existing `revision` metadata, and does not call same-id revision helpers that would overwrite supersede metadata.
- `rescope` invalidates embeddings with the existing `updated` invalidation reason.
- `rescope` global→project then project→global round-trips visibility and clears stale project metadata.

CLI tests:

- `memory-lane show <id>` human and JSON output for visible active record.
- `memory-lane get <id>` alias works.
- `show <cross-project-id>` suggests `--all`.
- `show --all <deleted-id>` displays status and scope metadata.
- `recall --id <id>` fails with guidance to use `show`.
- `rescope --dry-run` previews without writing.
- `rescope --yes` writes same-id scope correction.
- `rescope` without `--dry-run` or `--yes` fails.
- `move` alias works.

MCP tests:

- `memory_get` returns visible active record by id.
- `memory_get({ all: true })` returns cross-project/deleted record by id.
- `memory_get` respects `projectPath` for scoped visibility.
- MCP tool registry includes `memory_get`.

## Rollout

Implement behind normal command availability; no config flag is needed because:

- `show/get` and `memory_get` are read-only.
- `rescope/move` requires explicit command invocation and `--yes` for mutation.

## Acceptance criteria

- Users and agents can inspect one exact memory id without scripting around `list --json`.
- `recall --id` no longer returns unrelated search results.
- Users can dry-run and apply a same-id scope correction for approved/pending memories.
- MCP clients can inspect exact ids without gaining new mutation authority.
- No automatic cleanup or lifecycle behavior changes are introduced.
