# Project-local Storage Slice 1 Default Writes Design

## Status

Approved by the user through Plannotator, merged in PR #80 as `a87eff5`, and shipped in `v0.2.43`.
Opus 4.8 second-opinion review completed before presentation.
Implementation remained within this design gate.

## Context

Slice 0 shipped in `v0.2.42` as the storage facade proof.
It added `MemoryEngineStorage` and `createSingleStoreEngineStorage` while preserving all default storage behavior.
This slice's product goal was to make new project-scoped writes land under the project by default when Memory Lane can resolve a project scope.
Global-scope preferences and personal memories remain in the home store.

The active approved umbrella design is `docs/superpowers/specs/2026-06-30-project-local-storage-default-design.md`.
This document narrowed Slice 1 so it could be approved, implemented, reviewed, and dogfooded without migration or retrieval changes.

## Problem

Before Slice 1, a project-scoped memory usually wrote to `~/.memory-lane/memory.jsonl` unless project-local storage was explicitly initialized or home storage was unavailable.
That behavior relied on scope filtering to prevent cross-project context leakage.
The product direction is safer and easier to explain now that project-scoped memories live at `<project-root>/.memory-lane/memory.jsonl` by default.

Changing that default is not just a path-resolution tweak.
Memory Lane revisions are append-only records with last-wins folding by `id`.
If a two-store read model simply concatenates home and project files, the same memory id can appear in both stores and produce incorrect winners.
If a mutation of an existing home-origin memory routes to the project store just because a project scope is currently known, Memory Lane can fragment one logical memory across two files.
Slice 1 must make origin ownership and merged folding explicit.

## Goals

- Route new project-scoped memories to a project-local store when project scope is known and no explicit storage environment override is active.
- Keep new global-scope preference and personal memories in the home store by default.
- Read from a merged view of the relevant project store plus the home store.
- Preserve explicit `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, and `MEMORY_LANE_CONFIG` as authoritative single-store overrides.
- Preserve current behavior when no project scope is known.
- Track origin stores so edits and review actions for existing records append to the store that already owns that record.
- Keep the slice small enough to dogfood before adding migration diagnostics.

## Non-goals

- No migration of existing home-stored project memories.
- No migration diagnostics or migration commands.
- No retrieval or ranking changes.
- No memory schema expansion.
- No automatic consolidation, supersedence, approval, rejection, deletion, or rescoping.
- No raw transcript indexing.
- No cloud sync.
- No config merge model.
- No public eval command.
- No Obsidian storage model change.

## Proposed behavior

### Storage modes

Memory Lane should distinguish explicit single-store mode from default two-tier mode.

Explicit single-store mode applies when any storage override is set:

- `MEMORY_LANE_FILE`
- `MEMORY_LANE_EMBEDDINGS_FILE`
- `MEMORY_LANE_CONFIG`

In explicit single-store mode, behavior stays as it is today.
The explicit path is authoritative, project-local auto-routing is disabled, and the engine uses a single-store facade.

Default two-tier mode applies when no storage override is set.
The home store remains the primary global store.
When project scope is known, the engine also owns a project store at `<project-scope-root>/.memory-lane/`.
The facade routes new records by final `record.scope.type` and resolved scope key.

### Project root selection

The project-local storage root should be derived from `resolveProjectScope()` rather than arbitrary upward `.memory-lane/` discovery.
The scope file remains highest priority, then git scope, then explicit cwd fallback when callers provide a project path.
For git worktrees, the store should use the resolved project scope root so worktrees that share one scope key share one project store.

This rule intentionally avoids nested cwd fragmentation.
A save from `packages/foo` in a repository should write to the repository scope root, not `packages/foo/.memory-lane/`.

### Auto-initialization

On the first project-scoped write in default two-tier mode, Memory Lane may create `<project-root>/.memory-lane/`.
It should create the memory and embeddings files as needed.
It should append `.memory-lane/` to the project `.gitignore` using the existing idempotent behavior.
The `.memory-lane-scope` file should also be treated as a local identity file and kept untracked unless a shared stable project id is intentional.
The reason is privacy and repo hygiene: Memory Lane files may contain local project context, preferences, pending review records, deleted revisions, embeddings, and local scope identity that are useful to the local user but usually should not be committed or shared with every repository collaborator.
Gitignoring also prevents large or frequently changing JSONL files from creating noisy diffs.

If `.memory-lane/` or `.memory-lane-scope` is not gitignored, the possible upside is that a solo user or team can intentionally version project memory or share a project scope id alongside the codebase and move it between machines through Git.
The downsides are stronger: accidental leakage of sensitive project notes, noisy append-only churn, merge conflicts in JSONL files, stale or rejected memories becoming repository history, and embeddings/baseline files bloating the repo.
For Slice 1, the default should stay safe-local-by-default; a future explicit team-sharing feature can revisit committed project memory with a clearer review model.

It should write `.memory-lane-scope` using the resolved scope identity when appropriate.

Read-only commands should not auto-create project-local storage.

### Resolver interaction

Auto-creating a project store must not accidentally convert the whole process back into legacy project-local single-store behavior on the next invocation.
Legacy `resolveMemoryPaths()` discovery can find an existing `.memory-lane/` by walking upward and return that project-local store as the scalar path set.
That upward discovery path is compatibility-only fallback behavior for legacy scalar path resolution, not the approved default resolver for two-tier routing.
Slice 1 should not let that legacy discovery path decide default two-tier routing.

Implementation should introduce a project-aware storage factory or resolver mode that handles default two-tier engine construction directly:

- explicit env paths still produce a single-store facade;
- default mode produces a home-primary facade plus an optional project store derived from project scope, without relying on compatibility-only upward `.memory-lane/` discovery;
- legacy `init --project-local` behavior stays supported, but normal project-scoped auto-init must not make global preferences write to project-local storage on the next run.

This is a load-bearing design decision.
Without it, creating `.memory-lane/` for project memories would cause later commands to treat the project store as the scalar default for all memory categories.

### New-record routing

For brand-new memory ids in default two-tier mode:

- `record.scope.type === "project"` and `record.scope.key` is present writes to the project store;
- all other records write to the home store;
- if a user asks for project scope but Memory Lane cannot resolve a project scope key, the record writes to the home store and should keep existing warning or fallback behavior.

Routing must use the final record scope after category and explicit scope inference.
It must not route only by category.
A preference explicitly forced to project scope should route project-side when a scope key exists.
A project category explicitly forced to global scope should route home-side.

### Existing-record routing

For existing memory ids, origin store wins.
Approve, reject, delete, update, duplicate pending upgrade, replace, and supersede operations should append revisions to the store that currently owns the active record.
If a multi-record operation touches records from multiple stores, each appended revision should go to that record's owner store.

This preserves the current append-only revision model and avoids fragmenting ordinary edits across stores.

### Merged read model

The facade should read the relevant project store and the home store, then fold by memory id across the merged log.
The winner for duplicate ids across stores should be the newest `updatedAt` value.
If `updatedAt` ties or is missing, use a deterministic tie-breaker and document it in tests.

This merged fold is required for correctness.
Concatenation order must not determine the active version when the same id exists in both stores.

Scope filtering remains required after storage merging.
Project-local storage is a filesystem boundary, not a replacement for scope filtering.

### Rescope and move

Cross-store rescope is intentionally not solved in this slice.
For Slice 1, `rescope` should keep the record in its existing origin store and append the new revision there.
The merged read view should still respect the new scope metadata.

A later Slice 2 or Slice 3 can define an explicit cross-store move protocol with source-store tombstones and destination-store revisions.
Do not silently move existing ids between stores in Slice 1.

### Embeddings

Semantic search remains disabled by default, but Slice 1 should still preserve semantic behavior for users who explicitly enabled it.
New project-local memories should use the paired project-local embeddings file at `<project-root>/.memory-lane/embeddings.jsonl` when semantic embeddings are enabled.
Home-side memories should continue to use the home embeddings file.
Embedding invalidation tombstones and reindex writes should route to the same store side as the owning memory record.

This avoids making newly saved project memories invisible or stale in semantic recall for users who already opted into embeddings.
It also keeps the storage model easier to explain: memory records and their embeddings live together.

Out of scope for Slice 1: migrating or rebuilding embeddings for legacy home-stored project memories.
That compatibility work belongs with Slice 2 migration diagnostics and can include an explicit dry-run-first rebuild/migration path.

### Continuity baselines

Continuity baseline files should remain home-side in Slice 1.
They are already keyed by project scope, and moving them during the first write-default slice risks splitting history.

### Compaction

Compaction should affect project-local memories once Slice 1 creates or uses a project store; otherwise the new project path could grow forever.
The default two-tier facade should support per-owned-store compaction:

- home compaction continues to compact home memory and home embeddings;
- project compaction compacts the active project memory and active project embeddings;
- explicit `memory-lane compact` from a project context compacts both the active project store and the home store used by the merged view;
- startup auto-compaction may compact the active project store only when the command has resolved that project store as part of the active facade, and should remain bounded/idempotent.

Read-only commands still should not auto-create a project store just to compact it.
If a project store does not exist yet, compaction has nothing project-side to do.

A later migration slice can add broader stale-store discovery or cross-project compaction commands, but Slice 1 should not leave active project-local stores uncompacted.

### Diagnostics and status

Keep existing `doctor` and `status` JSON shape compatible.
Scalar fields such as `memoryFile` and `embeddingFile` should continue to report the primary home-side path in default two-tier mode.
If additional multi-store diagnostic detail is added, it should be additive and bounded.
Shape-lock tests should cover existing scalar fields.

## Implementation outline

1. Add a default two-tier `MemoryEngineStorage` implementation or a facade factory that can construct it.
2. Add origin metadata internally to the facade's folded records or lookup tables without changing the persisted memory schema.
3. Route new ids by final scope and resolved project scope key.
4. Route existing ids by owner store.
5. Fold merged reads by id across stores using `updatedAt` winner semantics.
6. Route embeddings and invalidation tombstones to the same store side as the owning memory record.
7. Add per-owned-store compaction for the active two-tier facade.
8. Keep explicit env path construction on the existing single-store facade.
9. Adjust CLI engine creation so default two-tier mode does not rely on upward `.memory-lane/` scalar discovery.
10. Audit MCP, lifecycle, and pi adapter engine construction for equivalent project-aware storage selection.
11. Add bounded docs updates to README, skill guidance, `ROADMAP.md`, and `HANDOFF.md` after approval and implementation.

## Files likely to modify

- `packages/core/src/storage-facade.ts`
- `packages/core/src/storage-locations.ts`
- `packages/core/src/engine.ts`
- `packages/core/src/project-scope.ts` if root semantics need a small helper
- `packages/core/test/storage-facade.test.ts`
- `packages/core/test/storage-locations.test.ts`
- `packages/core/test/engine.test.ts`
- `packages/cli/src/index.ts`
- `packages/cli/test/cli.test.ts`
- `packages/mcp-server` engine construction paths if project-aware storage is not centralized in core
- `packages/pi-adapter` engine construction paths if project-aware storage is not centralized in core
- `packages/lifecycle` hook tests if hook path selection changes
- `README.md`
- `skills/memory-lane/SKILL.md`
- `skills/memory-lane/REFERENCE.md`
- `ROADMAP.md`
- `HANDOFF.md`

## Required tests

1. In a temp git project with no `.memory-lane/`, saving a new project-scoped memory creates `<project-root>/.memory-lane/memory.jsonl` and does not append a project row to home.
2. From the same project, saving a preference writes to the home store.
3. Recall and continuity from the project see project-local project memories plus home global preferences.
4. A second temp project does not see the first project's project-local memory.
5. A nested cwd write lands at the resolved project scope root, not a nested directory.
6. Explicit `MEMORY_LANE_*` env paths preserve single-store behavior.
7. No project scope means writes stay home-side.
8. A memory id present in both stores folds to the newer `updatedAt` winner regardless of store concatenation order.
9. Updating or approving a home-origin memory while inside a project appends to home, not project-local.
10. Updating or approving a project-origin memory appends to project-local.
11. Mixed-store replace or supersede appends each touched existing id to its owner store.
12. Rescope keeps the existing owner store in Slice 1 and does not silently move files.
13. Project-local auto-init appends `.memory-lane/` to `.gitignore` idempotently, and repository-maintained ignore lists can also include `.memory-lane-scope` to keep local identity untracked.
14. Worktree saves use the intended shared project scope root and do not fragment stores.
15. Existing `doctor` and `status` JSON scalar storage fields remain compatible.
16. Startup auto-compaction does not unexpectedly rewrite a project store.
17. Semantic disabled behavior stays unchanged.
18. If semantic is enabled, new project-local memories write embeddings to the project-local embeddings file, home memories write embeddings home-side, invalidation tombstones route to the owning store side, and reindex preserves that pairing.
19. Explicit compact from project context compacts both active project-local and home stores; startup auto-compaction never creates a project store just to compact it.

## Verification plan

Minimum automated checks after implementation:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/lifecycle test
pnpm --filter @memory-lane/mcp-server test
pnpm test
pnpm build
git diff --check
```

Manual dogfood checks:

1. Use an installed build in a temp project with no `.memory-lane/` and save a project memory.
2. Confirm `.memory-lane/` is created in the project, `.gitignore` is updated, `.memory-lane-scope` remains untracked unless deliberately shared, and home does not receive the project row.
3. Save a preference from the same project and confirm it writes home-side.
4. Ask a broad continuity question from the project and confirm it sees the project memory and home preference.
5. Ask from a different temp project and confirm the first project's project memory is absent.
6. Run `memory-lane --smoke-test` after upgrade.

## Opus 4.8 review decisions folded into this draft

- Existing ids must route by origin store.
- Merged reads must fold by id across stores with `updatedAt` determining the active record.
- Rescope cross-store moves are deferred; Slice 1 keeps origin-store ownership.
- Continuity baselines stay home-side.
- Diagnostics preserve current scalar shape.
- The resolver interaction with auto-created `.memory-lane/` is load-bearing and must be handled directly.
- User review clarified that enabled embeddings and compaction should cover new project-local memories in Slice 1 rather than being deferred, so paired project embeddings and active project-store compaction are now in scope.

## Approval record

The user approved Slice 1 as scoped here.
PR #80 merged the implementation as `a87eff5` and shipped in `v0.2.43`.
Implementation remained limited to project-local default writes, merged two-store reads, origin-store routing, and compatible docs/tests.
Migration diagnostics and explicit cross-store moves remain deferred follow-ups.
