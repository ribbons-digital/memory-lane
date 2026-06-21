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

**Global preference layer**:
A bounded automatic-context selection layer for approved global preference-like memories, including global `preference` category records, `preference` kind records, and `workflow_rule` records. It lets durable user-wide preferences influence sessions across harnesses without crowding out current-project continuity.
_Avoid_: Unbounded global memory injection, automatic preference approval, override rule

**Project preference layer**:
The automatic-context selection layer for approved current-project preference-like memories. It renders before global preferences so narrower project guidance is easier to follow, without creating an explicit supersede, cleanup, or conflict-resolution relationship.
_Avoid_: Supersede relationship, automatic override, project memory cleanup

**Same-id update**:
An append-only revision of an active memory that keeps the same memory id while changing fields such as text, category, kind, or approved/pending status. It corrects or refines the same durable memory and preserves created-at identity.
_Avoid_: Replacement memory, supersede relationship, deletion

**Supersede relationship**:
Explicit revision metadata showing that one approved memory is now replaced by another approved memory. Superseded memories remain approved historical records; they are not rejected, deleted, or assigned a new status. A single successor may supersede multiple older memories when the user invokes the relationship explicitly.
_Avoid_: Automatic cleanup, rejected memory, deleted memory, new status

**Workstream**:
The user-meaningful unit of ongoing work across one or more manual threads, harness sessions, orchestrator threads, subagent runs, branches, PRs, and session summaries. In Phase 16 Slice 4 this is a domain/spec concept only; Memory Lane should infer continuity hints from existing memory metadata rather than adding a first-class workstream id or thread metadata.
_Avoid_: Thread id, branch id, transcript, subagent task log

**Continuity notice**:
A compact, plain-language lifecycle signal that Memory Lane has newer approved state, current operating agreements, or continuity hints worth inspecting. It is guidance inside lifecycle context, not a memory body, transcript summary, or cleanup recommendation.
_Avoid_: Relevant memory, session summary, automatic handoff, cleanup recommendation

**Continuity intent**:
A natural-language user prompt that asks an agent to resume prior work, locate where or when prior work happened, understand current project progress, or decide the next work item. It triggers bounded Memory Lane inspection guidance and, when topic-specific, targeted recall/search. It is not a lifecycle continuity notice, session summary, or automatic handoff.
_Avoid_: Continuity notice, session summary, automatic handoff, lifecycle event

**Continuity read model**:
A read-only, project-scoped summary of Memory Lane continuity state for resumption/status questions. It combines approved project state, pending continuity candidates, freshness and hygiene signals, operating-agreement metadata, and harness guidance into one bounded structured result. It does not mutate memories, approve pending records, run cleanup, or replace repository inspection when current repo access is available.
_Avoid_: Recall result, lifecycle injection, session summary, automatic checkpoint capture

**Checkpoint candidate**:
A pending Memory Lane memory that represents high-value project progress, such as a merge, release, verification milestone, docs sync, major fix, or roadmap decision. It is review-first: Memory Lane may suggest it from strong evidence, but it does not affect future continuity until approved.
_Avoid_: Approved checkpoint, session summary, automatic handoff, lifecycle notice

**Checkpoint capture**:
A lifecycle-driven suggestion of a compact checkpoint candidate from high-confidence project progress evidence such as a release, merged PR, verification milestone, docs sync, major fix, or roadmap decision. It writes only pending Memory Lane records, deduplicates near-duplicate events, and relies on automatic review reminders before affecting future continuity.
_Avoid_: Approved checkpoint, automatic approval, transcript capture, explicit memory API

**Correction candidate**:
A pending project-scoped memory suggested from an explicit user correction that says an agent violated, forgot, skipped, or ignored an expected workflow, operating agreement, procedure, review gate, or project rule. It is review-first and uses compact normalized wording instead of raw conversation text.
_Avoid_: Approved correction, automatic rule update, transcript summary, tool failure

**Procedure memory**:
A durable memory describing a repeatable workflow or process, typically with when-to-use conditions, steps, pitfalls, and verification. Memory Lane stores procedure memories as normal JSONL records first; native skill/rule export is a later optional integration layer.
_Avoid_: Harness-native skill, automatic checklist enforcement, background rule rewrite

**Recovery-backed procedure candidate**:
A pending project-scoped procedure memory suggested from bounded tool evidence only when a failed shell action is followed by a safe successful recovery, such as a failed npm command followed by a successful pnpm command. The saved text uses compact templates and omits raw stdout, stderr, transcripts, and secrets.
_Avoid_: Raw tool-output memory, automatic approval, failure log, background learning

**Scope hygiene candidate**:
An approved visible memory whose scope metadata may be broader than its content warrants, such as a global memory that appears to describe a specific project, repository, session, checkpoint, release, or implementation detail. It is an inspection signal only; Memory Lane does not automatically rescope, delete, reject, or supersede it.
_Avoid_: Scope error, automatic cleanup, rejected memory, rescope recommendation

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
