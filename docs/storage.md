# Storage and project scoping

## Storage

By default, Memory Lane uses two storage tiers when no explicit `MEMORY_LANE_*` paths are set:

- global-scope memories, including default preferences and personal memories, live in `~/.memory-lane/memory.jsonl`;
- new memories whose final scope is the current project live in `<project-root>/.memory-lane/memory.jsonl` when a project scope is known.

Each write appends a record; reads fold duplicates by id with the newest revision winning.
New records created by Memory Lane receive 32-character lowercase hexadecimal ids; existing legacy ids are loaded unchanged.
Atomic memory, embedding, continuity-baseline, and compaction writes use short file locks plus `.tmp` + `rename`, and batch memory writes are atomic per underlying store.
Compaction removes folded deleted/rejected records and stale embeddings, but it preserves malformed or schema-invalid JSONL rows so diagnostics remain available instead of silently erasing corrupt input.
The internal storage facade merges the active project store with the home store for recall, list, review, continuity, and status surfaces.
Existing records keep their origin store for normal edits/review actions so one logical memory id is not split across files.
Advanced `@memory-lane/core` consumers can import `MemoryEngineStorage`, `createSingleStoreEngineStorage`, and `createTwoTierEngineStorage` when they need to inject storage that owns memory, embedding, compaction, diagnostics, legacy project-memory diagnostics, legacy project migration planning/apply, and continuity-baseline paths.
Custom facade implementations can also import `EmbeddingLine` for `appendEmbedding()` inputs, should return `LegacyProjectMemoryDiagnostics` from `legacyProjectMemoryDiagnostics()`, and should implement explicit reviewed migration plan methods when project-local migration is applicable.

Embeddings (when configured) are paired with the owning memory store: home memories use `~/.memory-lane/embeddings.jsonl`, and project-local memories use `<project-root>/.memory-lane/embeddings.jsonl`.
When a memory changes, recall ignores only embeddings created before that memory's latest invalidation; newer embeddings for the same memory id can be used without a full reindex.

For sandboxed harnesses, writable Memory Lane commands and hooks first try global storage at `~/.memory-lane`.
If that home storage is not writable and no explicit `MEMORY_LANE_*` paths are set, writable commands/hooks automatically initialize project-local single-store fallback storage at `.memory-lane/` and continue there.
Read-only inspection commands use read-only storage resolution and should not create fallback storage just to inspect memory state.

You can also initialize project-local storage explicitly:

```bash
memory-lane init --project-local --project /path/to/project
```

Project-local initialization creates `.memory-lane/` in the project, adds `.memory-lane/` to `.gitignore`, and creates `.memory-lane-scope`.
Treat `.memory-lane-scope` as a local identity file too; keep it untracked unless you intentionally want to share one stable scope id across collaborators.
In the default two-tier model, commands and hooks run with `--project /path/to/project` use this project store for project-scoped writes while keeping global-scope preferences home-side unless explicit `MEMORY_LANE_*` paths are set.

## Project scoping

Project identity is resolved in order:
1. `.memory-lane-scope` file (walks up from cwd) - `{ "id": "your-project-id" }`
2. Git identity - normal repos use the repo root; linked Git worktrees use the main checkout/common Git directory as the project key so worktrees share memories by default
3. Global scope (fallback - memories are visible everywhere)

Read-only scope resolution never creates scope files.
Project-local initialization and first project-scoped writes may create `.memory-lane-scope` as part of initializing `.memory-lane/`.
Create one manually in a project root when you want an explicit stable identity or need to override Git-derived identity:
```bash
echo '{"id":"my-project-uuid"}' > .memory-lane-scope
```
If you do this in a Git repository, add `.memory-lane-scope` to `.gitignore` unless the shared id is deliberate.

Existing memories saved under old worktree path keys are not migrated automatically.
Use `memory-lane list --all` and `memory-lane show <id> --all` to find them, then pass `--all` to `review`, `approve`, `reject`, `delete`, `update`, `rescope`, `supersede`, or `replace` when deliberately maintaining records outside the active project scope.

Review, by-id mutation, and revision commands are scoped by default: they can access global memories plus memories owned by the active project.
When no project scope is active, the default is global-only.
Cross-project maintenance requires explicit `--all`; denied lookups return not-found behavior without exposing memory text.

For legacy project-scoped memories that still live in the home store from before project-local defaults, use `memory-lane status --json`, `memory-lane doctor --json`, MCP `memory_status`, or `memory-lane migrate project-local --dry-run`.
These surfaces are read-only for legacy diagnostics and do not move records or create project-local storage.
When legacy candidates exist, the diagnostics include counts, hazard counters, and at most 10 bounded sample previews capped at 160 characters.
To migrate legacy candidates, first write and review an explicit plan with `memory-lane migrate project-local --dry-run --write-plan <path> --project <project>`.
Plan files may contain memory text and should not be committed.
After review, apply the plan with `memory-lane migrate project-local --apply-plan <path> --yes`.
