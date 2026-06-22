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
The user-meaningful unit of ongoing work across one or more manual threads, harness sessions, orchestrator threads, subagent runs, branches, PRs, and session summaries. Memory Lane should infer workstream pointers from existing approved memory metadata before adding first-class workstream ids or thread metadata.
_Avoid_: Thread id, branch id, transcript, subagent task log

**Workstream discovery**:
A read-only continuity operation that takes a natural-language query and returns bounded candidate pointers to approved project-visible continuity records that may represent the user-meaningful workstream. It is not recall, raw transcript search, lifecycle injection, or a persisted workstream index.
_Avoid_: Semantic recall, transcript search, thread browser, automatic handoff injection

**Workstream candidate**:
A bounded pointer to an approved memory record selected by workstream discovery. It includes memory metadata, a safe preview, match reasons, and derived references such as PR numbers, branch-like names, or commit SHAs when those appear in the approved memory text. It is not an approved answer by itself.
_Avoid_: Authoritative current state, raw memory dump, pending review item, live GitHub result

**Continuity notice**:
A compact, plain-language lifecycle signal that Memory Lane has newer approved state, current operating agreements, or continuity hints worth inspecting. It is guidance inside lifecycle context, not a memory body, transcript summary, or cleanup recommendation.
_Avoid_: Relevant memory, session summary, automatic handoff, cleanup recommendation

**Continuity baseline marker**:
An advisory per-project timestamp recording when Memory Lane last evaluated SessionStart continuity for that project. It lets a future session ask whether approved Memory Lane state is newer than the prior baseline. It is not a memory, session summary, approval, checkpoint, or source of truth.
_Avoid_: Memory record, session summary, checkpoint, approval, transcript marker

**Resolved continuity baseline**:
The timestamp actually used for a freshness or continuity check. For SessionStart, Memory Lane prefers the prior project baseline marker when present; otherwise it can fall back to the adapter-provided session timestamp. The marker is read before it is updated for the current session.
_Avoid_: Current session start only, handoff body, memory text, automatic approval

**Handoff mode**:
The configured continuity posture for how proactive Memory Lane should be across sessions. It is separate from context policy: handoff mode describes the continuity posture, while context policy controls whether and how much memory body content can be injected.
_Avoid_: Context policy mode, automatic handoff injection, thread memory

**Manual handoff mode**:
The default handoff mode. Existing inspection-first behavior remains active: users and agents rely on explicit review/status/list/continuity surfaces and current bounded lifecycle notices.
_Avoid_: Disabled memory, no continuity, automatic handoff

**Review handoff mode**:
A handoff mode where Memory Lane assembles existing pending project-scoped continuity candidates into read-only handoff proposals on explicit continuity surfaces. It is review-first: users inspect and approve pending records before relying on them as handoff state. It does not generate new summaries, inject handoff bodies into lifecycle context, or approve anything automatically.
_Avoid_: Automatic approval, automatic injection, generated handoff state, cleanup workflow

**Review-mode handoff proposal**:
A read-only aggregation of pending project-scoped continuity candidates assembled when `memory.handoffMode` is `review`. It helps a user inspect what Memory Lane would use as the next handoff trail if approved. It is not an approved fact, lifecycle injection, automatic summary, or cleanup recommendation.
_Avoid_: Approved checkpoint, automatic handoff, generated summary, mutation plan

**Handoff proposal item**:
A bounded preview and metadata pointer to an existing pending continuity candidate inside a review-mode handoff proposal. Items reuse the continuity read model's pending-continuity selection, preview cap, and secret filtering.
_Avoid_: Raw memory body, transcript excerpt, approved fact, auto-injected context

**Automatic handoff mode**:
An explicit opt-in handoff mode where SessionStart may reserve part of the existing context budget for the latest approved current-project handoff pointer. It is subordinate to context policy: `off` disables lifecycle context, `policy-only` can emit text-free handoff guidance, and `selective` can inject the bounded pointer body. It does not generate summaries, approve pending records, mutate storage, increase budgets, or add new CLI/MCP surfaces.
_Avoid_: Silent transcript memory, unbounded injection, cleanup automation, pending-memory bypass

**Automatic handoff layer**:
The SessionStart selection layer used only in automatic handoff mode to prioritize at most one approved `session_summary` or `project_checkpoint` for the active project before generic baseline selection. It is a budgeted selection layer, not a memory status, recall ranker, summary generator, or approval mechanism.
_Avoid_: Retrieval rewrite, token-budget expansion, pending proposal, workstream discovery

**Handoff pointer**:
An approved project-visible `session_summary` or `project_checkpoint` that identifies where project work left off. Automatic mode treats it as historical context to inspect, not authoritative current truth. Expired or superseded handoff pointers are not eligible for the automatic handoff layer.
_Avoid_: Raw transcript, tool output, pending review item, current repository state

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

**Memory freshness metadata**:
Optional time-awareness metadata on a memory record describing when its content expires, when it should be reconsidered as stale, or what event/session time it represents. It is advisory and can be surfaced in read-only status/continuity signals; it is not a new memory status and does not by itself change recall, injection, cleanup, or visibility.
_Avoid_: Expired status, automatic deletion, recall filtering, lifecycle injection behavior

**Freshness advisory**:
A deterministic read-only classification of approved visible memories with explicit freshness metadata as `current`, `stale`, or `expired`, plus counts/ids for inspection. It is shown through status/doctor/MCP status and continuity warnings without memory text. Stale/expired entries may include bounded per-id dry-run revision commands using existing `update`, `replace`, and `supersede` workflows. It does not mutate records, hide memories, down-rank recall, trigger refresh/consolidation, or suggest destructive reject/delete actions.
_Avoid_: Stale classifier, refresh command, cleanup recommendation, memory text preview

**Continuity record temporal context**:
Advisory time metadata on generated continuity records, especially session summaries and checkpoint candidates, that describes the best known time represented by the record. It uses `freshness.capturedAt` when a trustworthy timestamp already exists; it is not the same as write time and does not by itself change recall, injection, cleanup, or review behavior.
_Avoid_: Current-time fallback, expiration behavior, automatic recency ranking, timestamp migration

**Pending continuity candidate debounce**:
Deterministic suppression of a newly generated pending session summary or checkpoint candidate when an equivalent pending or approved candidate is already visible for the same project or session. It prevents duplicate review-queue entries before writing; it does not delete, reject, approve, merge, supersede, or consolidate existing memories.
_Avoid_: Consolidation, cleanup, automatic rejection, fuzzy duplicate classifier

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
