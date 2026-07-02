# Project-local Storage Default Design

## Status

Slice 0 shipped in `v0.2.42` from PR #78 as the storage facade proof with no default-location change.
Slice 1 shipped in `v0.2.43` from PR #80 as the project-local default for new project-scoped writes.
Slice 2 migration diagnostics remains a gated follow-up.

## Entry gate

Slice 0 was approved and implemented as an internal storage facade proof.
Slice 1 was approved and implemented as project-local default writes.
Do not implement Slice 2 until the user approves the next design gate.

## Context

Before Slice 1, Memory Lane supported project-local storage, but it was opt-in unless home storage was not writable.
Default global storage remains `~/.memory-lane/`:

- `~/.memory-lane/memory.jsonl`
- `~/.memory-lane/embeddings.jsonl`
- `~/.memory-lane/config.json`

Project-local storage now exists through:

- `memory-lane init --project-local --project <path>`
- `.memory-lane/` discovery by walking upward from the current working directory
- automatic project-local fallback when home storage is not writable and no explicit `MEMORY_LANE_*` paths are set
- automatic project-local initialization on new project-scoped writes when project scope is known and no explicit storage override is active

Historical behavior clarification: explicitly asking an agent to save a **project-level** memory controlled the memory's scope/category, not the storage file location. If `~/.memory-lane/` was writable and project-local storage was not already initialized, Memory Lane wrote that project-scoped row to the home JSONL file and relied on scope filtering to keep it project-bound. Agents also did not automatically run `memory-lane init --project-local` before saving because that command creates project files and changes storage behavior; it was an explicit setup action or sandbox fallback, not an automatic consequence of `--scope project`. Slice 1 addresses this UX gap for new project-scoped writes.

The user raised a product concern: project-level memories stored in the home JSONL can accidentally pollute context across project boundaries. A project-local `.memory-lane/` directory better uses the native filesystem boundary to keep project memories near the project they belong to.

## User assumption

The assumption is directionally correct:

- storing project memories under the project reduces accidental cross-project leakage;
- local filesystem boundaries are easier to reason about than one global file with scope filtering;
- project-local files are often more compatible with sandboxed coding agents;
- project deletion/archive can include its memory state.

But project-local storage is not a complete replacement for Memory Lane scope filtering:

- global-scope preferences and personal memories still need a user-level store;
- worktrees, monorepos, symlinks, and harness cwd choices can blur boundaries;
- users may want one project memory store shared by all worktrees of the same repository;
- MCP servers and lifecycle hooks still need deterministic path resolution.

## Recommendation

Adopt a two-tier storage model through approved slices:

1. **Slice 0: storage facade proof, no default-location change.** Shipped in `v0.2.42` from PR #78.
   The core storage abstraction lets `MemoryEngine` operate through a store facade instead of assuming one scalar `memPath`/`embPath`, while current default storage behavior remains unchanged.
2. **Slice 1: project-local default for project-scoped writes.** Shipped in `v0.2.43` from PR #80.
   New project-scoped memories route to `<project-root>/.memory-lane/memory.jsonl` when project scope exists and no explicit storage env vars override it.
   Global-scope preferences and personal memories remain home-scoped in `~/.memory-lane/memory.jsonl`.

This two-step path preserves the product direction while de-risking the single-store engine assumption before changing user-visible write locations.

Long-term target:

- Project-scoped memories default to project-local storage.
- Global-scope preferences and personal memories remain in home storage.
- The engine sees a storage facade that can read from multiple underlying stores and route writes by final record scope or record origin.
- Explicit `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, and `MEMORY_LANE_CONFIG` continue to win exactly as today and keep single-store behavior.

This is a storage architecture change, not a recall/ranking or schema change.

## Non-goals

- No retrieval/ranking changes.
- No memory schema migration.
- No automatic deletion or movement of existing memories.
- No automatic approval/rejection/consolidation.
- No raw transcript indexing.
- No cloud sync.
- No embedding-default changes.
- No public database format change beyond using existing JSONL files at different locations.
- No requirement to commit `.memory-lane/`; project-local storage should remain gitignored by default.

## Current implementation seams to reuse

- `packages/core/src/storage-locations.ts`
  - `resolveMemoryPaths()`
  - `resolveWritableMemoryPaths()`
  - `initProjectLocalStorage()`
  - upward `.memory-lane/` discovery
  - `.gitignore` append behavior
- `packages/cli/src/index.ts`
  - command-level selection of read-only vs writable path resolution
  - `--project <path>` path option
  - `createEngine(paths, projPath)`
- `packages/core/src/search.ts`
  - scope filtering remains required even when storage is split
- `packages/core/test/storage-locations.test.ts`
  - existing project-local tests can be extended rather than replaced
- `packages/cli/test/cli.test.ts`
  - existing `init --project-local` and auto-fallback coverage

## Proposed storage semantics

### Path resolution

Introduce a new project-aware path resolution mode for commands with project context and no explicit `MEMORY_LANE_*` overrides:

1. Resolve project scope root using the existing project scope logic, not raw cwd.
2. Make `resolveProjectScope()` / `.memory-lane-scope` / git-root worktree-aware identity authoritative for the project-local storage root.
3. If command writes project-scoped data and a project root is known:
   - use `<project-root>/.memory-lane/` for project memory and project embeddings;
   - auto-initialize the directory on first project write;
   - append `.memory-lane/` to `.gitignore` when auto-initialized.
4. Continue to use `~/.memory-lane/` for global memory/config and install metadata.
5. If explicit `MEMORY_LANE_*` paths are set, keep current behavior: explicit paths are authoritative, do not auto-fallback, and keep current single-store behavior.

This root rule is load-bearing.
The current `findProjectLocalRoot()` helper discovers an existing `.memory-lane/` by walking upward from cwd, while project identity uses `.memory-lane-scope` and git-aware project scope resolution.
The first implementation must unify these or make project scope resolution authoritative so nested cwd writes do not create fragmented `.memory-lane/` stores.

### Config split

Keep the first implementation conservative:

- Global config remains `~/.memory-lane/config.json` as the default canonical user config.
- Project-local config remains supported when a project-local store already exists or is explicitly initialized.
- The first slice should avoid inventing a config merge model unless tests show current config behavior blocks project-local default storage.

Rationale: project-local memory isolation is the user-visible goal. Config layering can become complicated and should not block the first storage boundary improvement.

### Read model

For the long-term project-local default:

- Read project-local project memories from the project store.
- Read global/personal/preference memories from the home store.
- Keep status/scope filtering as a second boundary.
- Existing home-scoped project memories remain accessible through current home-store behavior until a separate migration/compatibility slice is approved.

For Slice 0, reads remain behaviorally equivalent to today's single home store, but they should go through the new facade contract.
The facade must be capable of returning a merged read view to `MemoryEngine` and tracking the originating store for each folded record so update/approve/reject/delete/rescope and duplicate upgrades can re-append to the same store that owns the existing record.

### Write model

For Slice 0:

- Preserve today's write destinations.
- Replace direct single-file write assumptions with facade calls.
- Extend the storage contract beyond `MemoryStore.append()` to include batch append / append-many semantics.
- Delete or retire the direct `appendMemoryRecords()` file rewrite path in `MemoryEngine`; multi-record writes must go through the facade so later slices cannot bypass routing.

For Slice 1 project-local default:

- Route new writes after inference, using the final record scope as the source of truth.
- `record.scope.type === "project"` writes to project-local storage.
- all other records write to home storage.
- If no project root is resolvable for a project write, fall back to current home behavior with a warning or require explicit `--project`; this needs implementation-time decision based on CLI/MCP ergonomics.

For re-appends of existing records:

- approve/reject/delete/update should append the new revision to the store that contained the previous active record; rescope/move needs a separate Slice 1 rule because it intentionally changes scope;
- duplicate pending upgrade should update the store containing the duplicate, not route only by current scope;
- supersede/replace multi-record batches must route each record individually, because a successor and superseded records may belong to different stores.

This avoids conflicting rules between category, kind, explicit `--scope`, and lifecycle inference, and avoids splitting a single logical record id across stores.

### Migration behavior

Do not silently move existing home-stored project memories.

First implementation should not migrate or diagnose legacy rows.

Plan migration/compatibility as **Slice 2** after the facade proof and project-local default flip:

- detect approved/pending home-stored project memories whose scope key matches the active project;
- show bounded warnings in `doctor`, `status`, or `continuity`;
- add an explicit `memory-lane migrate project-local --dry-run --yes` command or equivalent dry-run-first migration flow;
- avoid silent movement, deletion, approval, or consolidation.

Those migration/compatibility features are out of scope for Slice 0 and Slice 1, but should remain the planned follow-up once new project writes are safely project-local by default.

## First implementation slice

Recommended first slice: **storage facade proof with no default-location flip**.

Definition of done for Slice 0:

1. Extend the core storage contract so the engine uses a facade interface with single-record append, append-many/batch append, read log, list, diagnostics, and explicit memory/embedding path metadata.
2. Add an engine construction contract for facade injection. Preferred approach: `MemoryEngine` accepts an optional pre-built storage facade; existing `{ memoryPath, embeddingsPath, configPath }` construction builds a single-store facade for backward compatibility.
3. Delete or retire direct `appendMemoryRecords()` raw `fs` rewriting in favor of the facade's batch append path.
4. Preserve today's default write locations and read behavior in Slice 0.
5. Replace scalar `this.memPath` / `this.embPath` assumptions with facade-aware per-store resolution where needed.
6. Keep startup auto-compaction and explicit `compact()` behavior equivalent for the single-store facade; define multi-store compaction behavior in tests even if only one store is active in Slice 0.
7. Keep continuity baselines home-side for Slice 0. Do not move baseline files until the project-local default slice, because baseline files are already keyed by project scope and moving them early risks splitting history.
8. Route embedding append, invalidation tombstones, recall embedding reads, and reindex behavior through the facade embedding seam while preserving equivalent single-store behavior; add routing seams for future project/home split.
9. Make cache invalidation a first-class facade invariant: every facade write method, including single append, append-many, embedding append, embedding invalidation, reindex writes, and compaction, must invalidate or refresh the owning store cache so immediate subsequent reads cannot observe stale data.
10. Define batch append atomicity: append-many is atomic per target store and preserves the existing single-store successor-plus-superseded ordering semantics.
11. Make the facade own or expose the embedding-store seam and continuity-baseline path seam, not only memory paths. Slice 0 keeps single-store behavior, but engine code should no longer scatter assumptions that there is exactly one scalar `embPath` or baseline path.
12. Keep `doctor` / `status` JSON output shape unchanged in Slice 0; add shape-lock tests for the relevant scalar storage fields. Multi-store diagnostic shape is a later Slice 1 decision.
13. Keep explicit `MEMORY_LANE_*` paths fully authoritative and single-store.
14. Update tests and internal docs for the new facade seam, but do not update user-facing storage-default docs yet except to note this is internal prep if needed.

Definition of done for shipped Slice 1:

1. Derive project-local storage root from existing project scope resolution, not arbitrary cwd upward discovery.
2. Route new project-scoped writes to project-local `.memory-lane/` by default when project scope is known and no explicit env paths override storage.
3. Keep new global-scope preference/personal writes in home storage.
4. Make project reads combine project-local project memories with home global memories through the facade.
5. Track origin stores so re-appends of existing records stay in the store where that record currently lives.
6. Route embeddings and invalidation tombstones to the same store side as their owning memory.
7. Decide whether continuity baselines remain home-side or move project-side with an explicit migration/compatibility story.
8. Keep `memory-lane init --project-local` working and idempotent; auto-init should write `.memory-lane-scope` using the resolved scope identity rather than raw cwd when available.
9. Update README, skill docs, and HANDOFF/ROADMAP.

Explicitly defer legacy home-project migration diagnostics and migration commands to planned Slice 2 unless separately reprioritized.

## Files likely to modify

Slice 0 likely touches:

- `packages/core/src/storage.ts`
- `packages/core/src/engine.ts`
- new core tests for the facade contract
- existing engine/storage tests for append-many, compaction, embeddings, continuity baseline, and cache freshness
- `ROADMAP.md`
- `HANDOFF.md`

Slice 1 likely additionally touches:

- `packages/core/src/storage-locations.ts`
- `packages/cli/src/index.ts`
- `packages/cli/test/cli.test.ts`
- `packages/core/test/storage-locations.test.ts`
- `packages/mcp-server` path/engine construction if MCP needs explicit project-aware store selection
- `packages/pi-adapter` path/engine construction if Pi needs explicit project-aware store selection
- lifecycle/adapter tests if hook path selection changes
- `README.md`
- `skills/memory-lane/SKILL.md`
- `skills/memory-lane/REFERENCE.md`

## Verification

Minimum local checks after implementation:

```bash
pnpm --filter @memory-lane/core test
pnpm --filter @memory-lane/cli test
pnpm --filter @memory-lane/lifecycle test
pnpm test
pnpm build
git diff --check
```

Manual/dogfood checks for Slice 0:

1. Existing single-store save/list/recall/review/continuity behavior stays unchanged.
2. Supersede/replace use the facade batch append path and preserve current file output.
3. Startup auto-compact and explicit `compact()` preserve current single-store behavior.
4. Continuity baseline diagnostics/read/write preserve current home-side behavior.
5. Embedding invalidation, auto-embed, and `reindex` route through the facade seam while preserving current single-store behavior.
6. Store cache refresh works after append, append-many, embedding append, embedding invalidation, reindex writes, and compaction.
7. Batch append remains atomic per store and preserves existing supersede/replace ordering in the single-store case.
8. `doctor` / `status` JSON output shape remains unchanged, with tests locking the relevant storage-file fields.
9. Obsidian mirror and other `store.list()` consumers still see the same merged single-store view in Slice 0.
10. Explicit `MEMORY_LANE_FILE` still forces single-store behavior.


Manual/dogfood checks for shipped Slice 1:

1. In a temp project with no `.memory-lane/`, save a project memory; assert it creates `<project>/.memory-lane/memory.jsonl` and not a home project row.
2. Save a preference from the same project; assert it writes to the home store.
3. Recall/continuity from the project sees project-local project memory plus home global preference.
4. A second temp project does not see the first project's project-local memory.
5. Nested-cwd project writes land in the scope-root `.memory-lane/`, not a nested directory.
6. Worktree writes use the intended shared project root/scope behavior and do not fragment stores.
7. Existing `.memory-lane/` project-local stores reconcile with scope-root behavior rather than shadowing it unexpectedly.
8. Deduplication sees the merged read view; pending duplicate upgrades re-append to the duplicate's origin store rather than creating a second live id in another store.
9. Supersede/replace with mixed project/global records appends each resulting record to the correct origin/routed store.
10. Embedding invalidation, auto-embed, and `reindex` write to the embedding file paired with each memory's store.
11. Obsidian mirror and other `store.list()` consumers use the facade merged view intentionally.
12. Pi/Claude/Codex hook smoke uses expected project-local storage when project scope is available.

## Risks and mitigations

- **Breaking cross-harness continuity:** resolve project root consistently and keep `.memory-lane-scope` / git root behavior authoritative.
- **Losing visibility of old home project memories:** do not delete or migrate old rows; defer explicit compatibility diagnostics/migration until a separate slice can handle them safely.
- **Config confusion:** keep global config canonical for the first slice; do not add config merging.
- **Worktree fragmentation:** prefer existing worktree-aware project scope logic; document `.memory-lane-scope` for stable identity.
- **Surprising file creation:** only auto-create project-local storage on writes, not read-only commands.
- **Git leakage:** append `.memory-lane/` to `.gitignore` whenever project-local storage is initialized.
- **Embedding mismatch:** project-local project embeddings should live beside project-local project memories; reindex behavior must respect the active store model.

## Decisions for user approval

1. Proceed in two slices: internal facade proof first, project-local default flip second.
2. Slice 0 should not change default write locations.
3. Slice 1 project-local storage root should be derived from existing project scope resolution, not arbitrary cwd.
4. Global config remains canonical for the first project-local default slice; no config merge model.
5. Project-local storage may auto-create on first project write when project scope is known, but only in Slice 1.
6. Legacy home-project migration diagnostics and migration commands are deferred to a later slice.

## Slice 1 rescope decision

Rescope/move is different from ordinary re-append operations: it intentionally changes a record's scope.
The approved Slice 1 design keeps rescope revisions in the existing origin store and defers explicit cross-store move semantics to a later migration/move slice.
Do not silently move records between stores in Slice 1.

## Approval status

User feedback agreed with Slice 0 as the first implementation target: an internal storage facade proof that preserves current storage behavior while removing the single-store assumptions that would make project-local-by-default risky.

Slice 0 implementation preserves current storage behavior through `MemoryEngineStorage` and `createSingleStoreEngineStorage`.
It shipped in `v0.2.42` after local build/test validation, release workflow `28484161404`, and installed-artifact smoke testing documented in `docs/superpowers/validation/2026-07-01-v0.2.42-release-dogfood.md`.
Slice 1 was later approved in `docs/superpowers/specs/2026-07-01-project-local-storage-slice-1-default-writes-design.md`, merged in PR #80 as `a87eff5`, and shipped in `v0.2.43` with installed-artifact dogfood documented in `docs/superpowers/validation/2026-07-02-v0.2.43-release-dogfood.md`.
Slice 2 migration diagnostics remains a planned follow-up requiring its own approval gate.
