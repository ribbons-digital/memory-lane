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
Determined by checking for a `.memory-lane-scope` file (walking up from cwd) or a git root, in that order. If neither exists, project scope is unavailable — all saves fall back to global scope with a notice. Scope files are never auto-created.

**Semantic retrieval**:
The pipeline that combines embedding-based cosine similarity, lexical token overlap, recency scoring, and kind-based boosting to rank memories for a recall query. Falls back gracefully through semantic → lexical → all-visible.

**Compaction**:
The process of rewriting storage files to remove deleted/rejected memory tombstones, stale embeddings, and invalidation records. Runs on engine startup if dead weight exceeds 30%, and is also available as an explicit manual command. Never runs mid-session.

**Intent detection**:
Regex-based pattern matching for memory-related user intents (save, suggest, recall) lives in the core. LLM-powered intent classification lives in the adapter layer (harness-specific).
