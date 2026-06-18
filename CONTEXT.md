# Memory Lane

A cross-harness, lightweight memory system for AI agent harnesses. Stores memories as append-only JSONL files, with optional semantic search via local or remote embedding providers.

## Language

**Memory record**:
A single stored fact, preference, checkpoint, or decision. Has an id, status lifecycle (pending → approved → rejected/deleted), and can be scoped globally or to a project.

**Memory store**:
The primary append-only JSONL file at `~/.memory-lane/memory.jsonl` containing all memory records. Records are folded on read to produce the latest version of each memory by id.

**Embedding sidecar**:
A secondary append-only JSONL file at `~/.memory-lane/embeddings.jsonl` storing both vector embeddings for approved memories (keyed by memory id, profile name, and content hash) and embedding invalidation records (prefixed by `type: "invalidation"`).

**Project identity**:
Determined by checking for a `.memory-lane-scope` file (walking up from cwd) first. If none exists, Memory Lane uses Git metadata: normal repos use the repo root, while linked Git worktrees use the common Git directory's main checkout path as the project key so worktrees share project memories by default. If neither a scope file nor Git identity is available, project scope is unavailable. Scope files are never auto-created and remain the explicit override for custom/stable identities.

**Semantic retrieval**:
The pipeline that combines embedding-based cosine similarity, lexical token overlap, recency scoring, and kind-based boosting to rank memories for a recall query. Falls back gracefully through semantic → lexical → all-visible.

**Compaction**:
The process of rewriting storage files to remove deleted/rejected memory tombstones, stale embeddings, and invalidation records. Runs on engine startup if dead weight exceeds 30%, and is also available as an explicit manual command. Never runs mid-session.

**Auto-embed**:
When semantic search is enabled and an embedding provider is configured, newly saved approved memories are automatically embedded at save time on a fire-and-forget async path. This ensures incremental saves can become available for semantic recall without manual `reindex`; if embedding fails, `reindex` can rebuild embeddings later.

**Intent detection**:
Regex-based pattern matching for memory-related user intents (save, suggest, recall) lives in the core. LLM-powered intent classification lives in the adapter layer (harness-specific). Harnesses with lifecycle hooks or events can trigger Memory Lane through adapters; harnesses without hooks or events can still rely on prompt instructions directing the LLM to invoke the CLI.

**Memory provenance**:
Optional harness-neutral origin metadata on a memory record that identifies which adapter and lifecycle event produced the memory. Provenance explains where a memory came from without storing raw hook payloads, transcripts, or harness-specific implementation details.

**Operating agreement memory**:
An approved memory that describes how agents should work for a user, project, or workflow, such as a project loop, global working preference, release process, PR process, or review gate. The first supported convention uses existing memory fields such as `kind`, `scope`, `category`, `source`, and `updatedAt`; explicit revision fields such as `canonical`, `supersedes`, `supersededBy`, or `revisionOf` are separate future concepts.
_Avoid_: Revision record, superseded memory, lifecycle injection

**Workflow area**:
A coarse label for the kind of operating agreement a memory describes, used to keep separate agreements from hiding each other. Initial areas are `project-loop`, `review-gate`, `pr-process`, `release-process`, `tooling-preference`, and `other`.
_Avoid_: Memory kind, category, project scope

**Primary operating agreement**:
The best currently applicable operating agreement selected for a workflow area. Selection prefers explicit `workflow_rule` memories, then project scope over global scope for the same area, then newer updates. Primary selection is a read-only view and does not mark other memories as superseded.
_Avoid_: Canonical revision, automatic cleanup, superseded memory

**Related operating agreement candidate**:
An approved visible memory that looks like an operating agreement but overlaps with a primary agreement or was matched heuristically. Related candidates are surfaced for human review and future revision/supersede workflows, not hidden or cleaned up automatically.
_Avoid_: Rejected duplicate, cleanup recommendation, superseded memory

**Obsidian mirror**:
An optional one-way Markdown projection of Memory Lane's JSONL memory records into an Obsidian vault. The JSONL memory store remains the source of truth; edits to mirrored Markdown are not imported by the mirror.
_Avoid_: Obsidian-backed storage, import, sync

**Obsidian import**:
An explicit operation that reads user-marked Markdown notes from `<vault>/<folder>/imports/` and validates them into Memory Lane records. Import is separate from the Obsidian mirror, includes conflict handling, and leaves source notes untouched. It is not automatic sync, bidirectional sync, or Obsidian-backed storage.
_Avoid_: Mirror, automatic sync, bidirectional sync, source-note rewrite

**Obsidian import area**:
The dedicated folder within Memory Lane's configured Obsidian folder where user-authored Markdown notes may be considered for explicit import. The first import workflow uses `<vault>/<folder>/imports/` and does not scan the whole vault.
_Avoid_: Obsidian mirror folder, whole-vault scan

**Importable memory note**:
A user-authored Markdown note intentionally placed in Memory Lane's Obsidian import area and marked with top-of-file `memory_lane: true` frontmatter for import into the Memory Lane JSONL memory store. It is not generated by the mirror, is not imported automatically, and is not rewritten after import.
_Avoid_: Mirrored memory file, generated note, whole-vault note, bidirectional sync note

**Obsidian mirror/import support**:
The overall feature area that includes both one-way Obsidian mirror and explicit Obsidian import. It is not the same as Obsidian-backed storage.
_Avoid_: Obsidian-backed storage

**Mirrored memory file**:
A generated Markdown file in an Obsidian mirror that represents one active Memory Lane record by stable memory id. It is human-readable but not user-authored; changes may be overwritten because JSONL remains the source of truth.
_Avoid_: Imported note, source record

**Mirror index file**:
A generated Markdown file in an Obsidian mirror that links to mirrored memory files by status, project, category, kind, or recency. It is generated from the JSONL memory store, may be overwritten by mirror sync, and is not imported.
_Avoid_: User-authored note, import note, editable index

**Mirror sync**:
An explicit repair or backfill operation that reconciles the Obsidian mirror folder with the active approved and pending records in the JSONL memory store. It may create, update, or delete generated mirrored memory files only inside Memory Lane's configured mirror folder.
_Avoid_: Import, bidirectional sync

**Obsidian LLM Wiki**:
A future knowledge-base integration that lets LLM clients search and read selected user-authored Obsidian or Garden notes as source-backed reference material with citations. It is not a Memory Lane memory store and does not automatically convert notes into memories.
_Avoid_: Obsidian mirror, Obsidian import, Obsidian-backed storage, automatic memory creation

**Wiki-derived memory**:
A Memory Lane memory explicitly created from a fact or decision found in an Obsidian LLM Wiki source note. Creation is deliberate and uses normal Memory Lane validation, review, scope, and source-of-truth rules.
_Avoid_: Automatic extraction, source note, citation
