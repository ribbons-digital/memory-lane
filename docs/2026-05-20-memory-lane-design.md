# Memory Lane — Design Specification

> Cross-harness, lightweight memory system that works across AI agent harnesses, sessions, and projects.

---

## 1. Motivation

The existing `persistent-memory` extension in pi serves its purpose well but is deeply coupled to pi's extension API (`ExtensionAPI`, `ExtensionContext`, `registerTool`, `sendMessage`, TUI renderers). It cannot be used directly by other agent harnesses (Codex, Claude Code, Cursor, etc.) without being rewritten. Memory Lane extracts the portable core into a standalone library and CLI, then provides thin adapters for each harness — the pi adapter replaces the current `persistent-memory` extension with a cross-harness foundation.

---

## 2. Principles

- **Lightweight first.** No databases, no MCP servers, no complex infrastructure. Filesystem + optional HTTP embedding calls.
- **Privacy-first.** Embedding and classifier remote calls are opt-in. Local embeddings preferred. Secrets are never stored.
- **Graceful degradation.** Semantic search → lexical search → all visible memories. The system works even when the embedding provider is offline.
- **Harness-agnostic core.** The core library has zero knowledge of pi, Codex, or any agent harness. It returns data; the adapter decides how to present it. Detection of memory-related user intents (save, suggest, recall) is handled through regex patterns in the core; LLM-powered intent classification is harness-specific and lives in the adapter layer.
- **Designed for deletion.** Memories accumulate. Compaction, TTL, and status lifecycle prevent unbounded growth.

---

## 3. Architecture

```
memory-lane/
├── package.json              # pnpm workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── docs/
│   └── 2026-05-20-memory-lane-design.md
├── examples/
│   └── harness-integrations/     # Instruction snippets for various harnesses
│       ├── claude-code.md
│       ├── codex-cli.md
│       ├── cursor.md
│       └── windsurf.md
├── packages/
│   ├── core/                     # Pure Node.js library (TypeScript)
│   │   ├── package.json          # @memory-lane/core
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts          # Public export barrel
│   │   │   ├── types.ts          # Data model types
│   │   │   ├── engine.ts         # MemoryEngine class (main API)
│   │   │   ├── storage.ts        # JSONL store with cache and batch append
│   │   │   ├── storage-facade.ts # Engine storage facade for memories, embeddings, compaction, and baselines
│   │   │   ├── search.ts         # Lexical search, secret detection, dedup
│   │   │   ├── project-scope.ts  # Project identity (scope file + git fallback)
│   │   │   ├── embedding-store.ts # Embedding JSONL sidecar
│   │   │   ├── scoring.ts        # Cosine similarity, recency, lexical scoring
│   │   │   ├── retrieval.ts      # Semantic + lexical retrieval pipeline
│   │   │   ├── embedding-provider.ts # OpenAI-compatible embedding provider
│   │   │   ├── config.ts         # Config loading, validation, defaults
│   │   │   └── compact.ts        # Compaction logic
│   │   └── test/
│   │       ├── engine.test.ts
│   │       ├── storage.test.ts
│   │       ├── search.test.ts
│   │       ├── scoring.test.ts
│   │       └── retrieval.test.ts
│   ├── cli/                      # CLI wrapper
│   │   ├── package.json          # @memory-lane/cli
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts          # Entry point / bin
│   │   │   ├── commands/         # One file per command
│   │   │   │   ├── save.ts
│   │   │   │   ├── suggest.ts
│   │   │   │   ├── recall.ts
│   │   │   │   ├── list.ts
│   │   │   │   ├── search.ts
│   │   │   │   ├── delete.ts
│   │   │   │   ├── review.ts
│   │   │   │   ├── approve.ts
│   │   │   │   ├── reject.ts
│   │   │   │   ├── compact.ts
│   │   │   │   ├── doctor.ts
│   │   │   │   ├── reindex.ts
│   │   │   │   ├── config.ts
│   │   │   │   └── status.ts
│   │   │   └── formatters.ts     # JSON and human-readable output
│   │   └── test/
│   │       └── cli.test.ts
│   └── pi-adapter/               # pi extension adapter
│       ├── package.json          # @memory-lane/pi-adapter
│       ├── tsconfig.json
│       ├── src/
│       │   └── index.ts          # pi extension that wraps MemoryEngine
│       └── test/
│           └── adapter.test.ts
```

### Data flow

```
┌──────────────────────────────────────────────────────┐
│                   Harness Adapters                    │
│  ┌────────┐ ┌─────────┐ ┌──────┐ ┌────────┐         │
│  │ pi     │ │ Codex   │ │CLI   │ │ Claude │  ...     │
│  │Adapter │ │(shell)  │ │(bin) │ │(shell) │          │
│  └───┬────┘ └────┬────┘ └──┬───┘ └───┬────┘          │
└──────┼───────────┼──────────┼──────────┘
       │           │          │
┌──────▼───────────▼──────────▼──────────────────────┐
│              @memory-lane/core (MemoryEngine)       │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐ │
│  │ storage  │  │  search  │  │  retrieval        │ │
│  │ (JSONL)  │  │ (lexical)│  │  (semantic+lex+   │ │
│  │ +cache   │  │ +dedup   │  │   recency scoring)│ │
│  └──────────┘  └──────────┘  └───────────────────┘ │
│  ┌──────────┐  ┌──────────────────┐                │
│  │ config   │  │ embedding-store  │                │
│  │ +scope   │  │ (JSONL sidecar)  │                │
│  └──────────┘  └──────────────────┘                │
└─────────────────────────────────────────────────────┘
```

---

## 4. Data Model

### Memory Record

```typescript
type MemoryStatus = "pending" | "approved" | "rejected" | "deleted"
type MemoryCategory = "preference" | "personal" | "project"
type MemoryScopeType = "global" | "project"
type MemorySource = "manual" | "user-suggested" | "agent-suggested"
type MemoryKind =
  | "preference"
  | "personal_context"
  | "project_fact"
  | "project_checkpoint"
  | "workflow_rule"
  | "decision"
  | "misc"

interface MemoryRecord {
  id: string
  status: MemoryStatus
  text: string
  category: MemoryCategory
  scope: { type: MemoryScopeType; key?: string }
  source: MemorySource
  createdAt: string
  updatedAt: string
  project?: { cwd: string; root?: string; key?: string }
  kind?: MemoryKind
}
```

**Differences from persistent-memory:**
- `kind` is fully optional on write; inferred on read if missing
- All other fields are identical — the model is deliberately unchanged to keep migration straightforward

### Embedding Sidecar Record

```typescript
interface EmbeddingRecord {
  memoryId: string
  memoryUpdatedAt: string
  contentHash: string
  profileName: string
  model: string
  dimensions: number
  vector: number[]
  createdAt: string
}
```

### Embedding Invalidation Record

```typescript
interface EmbeddingInvalidationRecord {
  type: "invalidation"
  memoryId: string
  invalidatedAt: string
  reason: "updated" | "deleted" | "stale"
}
```

Invalidation records are appended when a memory changes, so `recall()` knows to skip stale embeddings without a full reindex. They are cleaned up during compaction.

### Project Scope File

`.memory-lane-scope` — an optional JSON file in the project root:

```json
{ "id": "a1b2c3d4-e5f6-..." }
```

If present, the engine walks up from cwd to find it and uses its UUID as the project key.
It survives renames and should stay uncommitted unless sharing one stable scope id is deliberate.

**Important:** Scope resolution itself never creates scope files.
Project-local storage initialization can create `.memory-lane-scope` when Memory Lane initializes `.memory-lane/` for a known project.
If neither a scope file, a git root, nor an explicit project path is available, project-scoped saves fall back to global scope with a notice.
The user can still manually create `.memory-lane-scope` when they want stable scoping in a non-git directory.

---

## 5. Storage Layer

### Append-Only JSONL with Fold Semantics

The proven approach from persistent-memory: every record line is an independent JSON object on disk. On read, lines are folded to the latest version per `id`.

**Improvements over persistent-memory:**

| Feature | persistent-memory | Memory Lane |
|---|---|---|
| Write safety | `appendFileSync` (race-prone) | Lock-protected atomic write via temp file + `renameSync`; batch append is atomic per store |
| Read performance | Re-parses entire file every time | In-memory cache keyed by file mtime |
| Compaction | None | Triggered on engine startup at 30%+ dead weight + manual command |
| Embedding cleanup | None | Removed during compaction |
| Deleted records | Accumulate forever | Compaction removes tombstones |

### Atomic Writes

```typescript
// Pseudocode for atomic write
function appendMany(filePath: string, records: MemoryRecord[]): void {
  withAppendLock(filePath, () => {
    const tmpFile = filePath + ".tmp." + randomBytes(4).toString("hex")
    fs.writeFileSync(tmpFile, existingFilePrefix(filePath) + records.map(JSON.stringify).join("\n") + "\n")
    fs.renameSync(tmpFile, filePath)
  })
}
```

For true atomic appends: the store writes to a temp file with the original file's current contents plus the new line or batch, then atomically `renameSync`s the temp file over the original. A short lock directory serializes concurrent writers for memory, embedding, continuity-baseline, and compaction writes, and batch memory append preserves order atomically per underlying store.
Compaction keeps malformed or schema-invalid JSONL rows in place while compacting valid records, so diagnostics can still report corrupt input instead of silently erasing it.

### Cache Invalidation

```typescript
class MemoryStore {
  private cache: { mtime: number; records: MemoryRecord[] } | null = null

  readAll(): MemoryRecord[] {
    const stat = fs.statSync(this.filePath)
    if (this.cache && stat.mtimeMs <= this.cache.mtime) {
      return this.cache.records
    }
    this.cache = { mtime: stat.mtimeMs, records: this.fold(this.parseLines()) }
    return this.cache.records
  }
}
```

### Compaction

Compaction rewrites both `memory.jsonl` and `embeddings.jsonl` atomically:

1. Read and fold all memory records
2. Remove records with `status === "deleted" | "rejected"`
3. Read and fold all embedding records
4. Remove embeddings for removed memories
5. Remove embeddings where `contentHash !== sha256(current memory text)`
6. Remove invalidation records
7. Write to `memory.jsonl.tmp` and `embeddings.jsonl.tmp`
8. `renameSync` both `.tmp` files over originals
9. Invalidate cache

Triggered on engine construction (if dead weight / total records > 0.3 and total records > 100). Also available as explicit `compact()` command or `memory-lane compact` CLI. No auto-compaction during a running session — the in-memory cache makes it unnecessary for performance.

---

## 6. Core Engine API (`MemoryEngine`)

### Construction

```typescript
interface MemoryEngineConfig {
  memoryPath?: string           // default: ~/.memory-lane/memory.jsonl
  embeddingsPath?: string       // default: ~/.memory-lane/embeddings.jsonl
  storage?: MemoryEngineStorage // optional facade for memory, embeddings, compaction, diagnostics, and continuity baselines
  configPath?: string           // default: ~/.memory-lane/config.json (pi adapter overrides to ~/.pi/agent/memory.config.json for backward compat)
  embeddingProvider?: EmbeddingProvider  // optional; lexical-only without it
}

class MemoryEngine {
  constructor(config?: MemoryEngineConfig)
}

interface MemoryEngineStorage {
  readonly memoryFile: string
  readonly embeddingFile: string
  readonly continuityBaselinePath: string
  appendMemory(record: MemoryRecord): void
  appendMemories(records: MemoryRecord[]): void
  readMemoryLog(): MemoryRecord[]
  listMemories(): MemoryRecord[]
  memoryDiagnostics(): MemoryStoreDiagnostics
  appendEmbedding(record: EmbeddingLine): void
  listEmbeddings(): EmbeddingRecord[]
  listEmbeddingInvalidations(): EmbeddingInvalidationRecord[]
  shouldCompact(): boolean
  compact(): CompactReport
}

function createSingleStoreEngineStorage(memoryPath: string, embeddingsPath: string): MemoryEngineStorage
```

`memoryPath` and `embeddingsPath` still build the backward-compatible single-store facade.
Advanced tests and integrations can pass a custom `MemoryEngineStorage` when they need to own memory, embedding, compaction, diagnostic, or continuity-baseline paths.
`EmbeddingLine` is the exported union accepted by `appendEmbedding()` for embedding records and embedding invalidation records.

**Instance lifecycle recommendation:** Create one `MemoryEngine` per process and reuse it. The in-memory cache makes this significantly faster than per-operation construction. The pi adapter uses a singleton; the CLI creates one per invocation (naturally isolated processes).

### Save & Suggest

```typescript
interface SaveInput {
  text: string
  category?: MemoryCategory
  scopeType?: MemoryScopeType
  source?: MemorySource
  status?: MemoryStatus     // "approved" for explicit saves, "pending" for suggestions
  kind?: MemoryKind
}

type SaveResult =
  | { status: "saved"; memory: MemoryRecord }
  | { status: "skipped"; reason: "empty" | "secret" | "duplicate" }

async save(input: SaveInput): Promise<SaveResult>
suggest(text: string, ...): MemoryRecord  // queues as pending
approve(id: string): MemoryRecord | undefined
reject(id: string): MemoryRecord | undefined
delete(id: string): MemoryRecord | undefined
```

### Recall & Search

```typescript
interface RecallOptions {
  topK?: number
  minSimilarity?: number
  projectScope?: ProjectScope  // defaults to resolved scope
}

interface RecallResult {
  memories: MemoryRecord[]
  semantic: { enabled: boolean; used: boolean; fallbackReason?: string }
  notice?: string
}

async recall(query: string, options?: RecallOptions): Promise<RecallResult>
search(query: string, status?: MemoryStatus): MemoryRecord[]
list(status?: MemoryStatus): MemoryRecord[]
reviewPending(): MemoryRecord[]
```

### Maintenance

```typescript
compact(): { removedMemories: number; removedEmbeddings: number; removedInvalidations: number }

async reindexEmbeddings(options?: { force?: boolean; signal?: AbortSignal }): Promise<{
  embedded: number; skippedExisting: number; skippedSecrets: number
}>

async probeEmbeddingProvider(): Promise<{ ok: boolean; vectorDimensions?: number; error?: string }>

doctor(): { /* full diagnostic report */ }
getProjectScope(): ProjectScope
```

---

## 7. Semantic Retrieval

### Pipeline Order

```
1. Normalize query, check for checkpoint-recall keywords → apply kind boost
2. Embed query via EmbeddingProvider (if configured & reachable)
3. For each visible approved memory:
   a. Look up matching embedding via memoryId + profileName + contentHash match
   b. Compute cosine similarity between query vector and stored vector
   c. Compute lexical score (token overlap with stop-word filtering)
   d. Compute recency score (1/(1 + age/30days))
   e. Apply kind boost (checkpoint recall)
   f. Combined score: (0.65 * semantic) + (0.25 * lexical) + (0.1 * recency) + kindBoost
4. Filter by minSimilarity threshold (0.25)
5. Sort by combined score descending
6. Return topK results
```

### Fallback Chain

```
Semantic available & produces matches?     → return semantic results
Semantic available but zero matches?       → fall back to lexical scoring on all visible
Semantic unavailable (provider error)?     → fall back to lexical scoring on all visible
Lexical also zero?                         → return all visible with notice
```

### Checkpoint Recall Boost

If the query matches patterns like "where did we leave off", "resume work", etc., memories with `kind === "project_checkpoint"` get a +0.2 boost to their final score — the same mechanism carried over from persistent-memory.

### Auto-Stale Detection

When a memory is updated (status change, text edit), an `EmbeddingInvalidationRecord` is appended. During recall, Memory Lane compares each embedding with the latest invalidation timestamp for that memory id and skips embeddings created before that invalidation. Newer embeddings for the same memory id can be used immediately, which prevents recall from silently using vectors that no longer reflect the memory content without requiring a full reindex after every update.

---

## 8. CLI

### Entry Point

```bash
memory-lane <command> [args...] [--json] [--project <path>]
```

- `--json` — output JSON instead of human-readable text
- `--project` — explicitly set the project scope directory (default: `process.cwd()`)
- Exit codes: 0 (success), 1 (error), 2 (usage error)

### Commands

| Command | Args | Flags | Behavior loads engine, |
|---|---|---|---|
| `save` | `<text>` | `--scope`, `--category`, `--kind` | Saves approved memory |
| `suggest` | `<text>` | `--scope`, `--category`, `--kind` | Saves as pending |
| `recall` | `[query]` | `--top-k`, `--json` | Searches & returns memories |
| `list` | | `--status`, `--json` | Lists memories by status |
| `search` | `<query>` | `--json` | Text search across memories |
| `delete` | `<id>` | | Sets status to deleted |
| `approve` | `<id>` | | Sets status to approved |
| `reject` | `<id>` | | Sets status to rejected |
| `review` | | `--auto-approve` | Interactive or auto-approve pending |
| `compact` | | | Compact storage files |
| `doctor` | | `--probe` | Diagnostic report |
| `reindex` | | `--force` | Rebuild all embeddings |
| `config` | `init [--force]` | | Write default config |
| `status` | | | Show engine state summary |

### Output Format (JSON)

```json
{
  "ok": true,
  "data": { /* command-specific */ },
  "meta": { "count": 5, "project": "...", "version": "0.1.0" }
}
```

Error output:

```json
{
  "ok": false,
  "error": "Memory not found: abc123",
  "meta": { "version": "0.1.0" }
}
```

---

## 9. Pi Adapter

Replaces the current `persistent-memory` extension. Thin wrapper that:

1. Creates a `MemoryEngine` instance
2. Maps pi commands (`/remember`, `/memory`) to engine methods
3. Maps pi tools (`memory_suggest`, `memory_save`, `memory_recall`) to engine methods
4. Maps pi's `input` event to the LLM intent classifier + regex detection pipeline (regex detection is in core; the LLM classifier is pi-adapter-only)
5. Uses pi's `sendMessage` to inject recalled memories as custom messages

The pi adapter is the **proof point** that the core engine is portable — if pi can consume it, any harness can.

---

## 10. Example Harness Integration Files

Located at `examples/harness-integrations/`, these are **instruction snippets** users copy into their harness config (not code packages). Each is a single markdown file explaining:

- How to make the CLI available (PATH or npm link)
- How to configure the harness to call `memory-lane` commands automatically
- Example prompts or tool definitions

This is sufficient because every harness can invoke a shell command. No harness-specific code packages needed.

---

## 11. Configuration

### Default paths

| Thing | Default path |
|---|---|
| Memory store | `~/.memory-lane/memory.jsonl` |
| Embedding sidecar | `~/.memory-lane/embeddings.jsonl` |
| Semantic config | `~/.memory-lane/config.json` (overridable — pi adapter defaults to `~/.pi/agent/memory.config.json` for backward compat) |
| Project scope file | `<project-root>/.memory-lane-scope` |
| Embedding profiles | Defined in `~/.memory-lane/config.json` |

### Semantic Config

Carried from persistent-memory but with `semantic.enabled: false` as the default. The config file ships with a commented-out example profile for localhost. Users who want semantic search uncomment it and configure their embedding provider.

Same JSON schema as the existing `memory.config.json` with `profiles`, `retrieval`, `privacy`, etc. The core `@memory-lane/core` includes config loading and validation logic ported from `semantic.ts`.

---

## 12. Secret Filtering

Port the exact logic from persistent-memory's `containsLikelySecret()`:
- API key patterns (`sk-...`, `ghp_...`, `xox[baprs]-...`, etc.)
- Private key header detection
- Labeled secrets: `password is X`, `API_KEY = X`
- High-entropy token detection (32+ char base64-like with high character variety)

Identical to the current implementation — it's been well-tested and there's no reason to change it.

---

## 13. Error Strategy

- **No exceptions for user-facing errors.** Operations that can fail predictably (duplicate, secret, empty text) return result objects with a `reason` string, not throw.
- **Configuration errors throw** at construction time (bad JSON, missing profile). The adapter catches and reports them.
- **Hook initialization errors fail safe** for Claude/Codex hooks: storage, config, or plugin initialization failures return `{}` and exit successfully so the host session is not blocked.
- **Provider errors are caught internally** and result in a degraded fallback, not a crash.
- **Corrupted JSONL lines are omitted from list/recall results but remain visible through diagnostics.** Compaction preserves malformed or schema-invalid rows rather than silently deleting them.

---

## 14. Testing Strategy

- **Core unit tests.** Pure TypeScript, no harness dependencies, no network calls. Mock the embedding provider.
  - Storage: read/write/fold/compact/cache invalidation
  - Search: lexical scoring, duplicate detection, secret detection, memory-matches-context
  - Scoring: cosine similarity, recency, lexical, kind boost
  - Retrieval: pipeline, fallback chain, auto-stale detection
  - Config: load/validation/merge
- **CLI integration tests.** Run the CLI binary against temp directories, verify exit codes and output.
- **Pi adapter tests.** Use the existing test pattern from `persistent-memory-extension.test.js`.

---

## 15. Non-Goals (Explicitly Out of Scope)

- No MCP server
- No database (SQLite, Postgres, etc.)
- No cloud sync or remote storage
- No collaborative/shared memory between users
- No UI beyond CLI output
- No harness-specific adapter packages (instruction files only)
- No real-time reflection or automatic insight generation
- No web interface

---

## 16. Implementation Phases

### Phase 1: Core Engine Foundation
- Project scaffolding (pnpm workspace, TypeScript config, test setup)
- `types.ts` — all data model types
- `storage.ts` — JSONL store with cache, atomic writes, fold
- `search.ts` — lexical search, dedup, secret detection
- `project-scope.ts` — scope file + git fallback
- `engine.ts` — MemoryEngine class with save/suggest/approve/reject/delete/list/search/reviewPending
- `config.ts` — config loading and validation
- Tests for all of the above

### Phase 2: Semantic Retrieval
- `embedding-store.ts` — embedding sidecar with invalidation records
- `embedding-provider.ts` — OpenAI-compatible provider (ported from semantic.ts)
- `scoring.ts` — cosine similarity, lexical score, recency score, kind boost
- `retrieval.ts` — full retrieval pipeline with fallback chain
- `compact.ts` — compaction logic for both stores
- `engine.ts` — wire up `recall()`, `reindexEmbeddings()`, `compact()`, `doctor()`, `probe()`
- Tests for all of the above

### Phase 3: CLI
- CLI package scaffolding
- Command implementations for all subcommands
- JSON and human output formatters
- Integration tests

### Phase 4: Pi Adapter
- Extension that wraps MemoryEngine
- Tool registrations (`memory_suggest`, `memory_save`, `memory_recall`)
- Command registrations (`/remember`, `/memory`)
- Input event handling with classifier + regex detection
- Message injection for recall results
- Tests

### Phase 5: Documentation & Examples
- README with quickstart
- Example integration instructions for each harness
- License and contributing guide
