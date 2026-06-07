# Memory Lane

A cross-harness, lightweight memory system for AI agent harnesses. Works across sessions, projects, and agents — no database, no MCP server, just files.

## Quick Start

```bash
# Build
git clone <repo> && cd memory-lane && pnpm install && pnpm build

# Optionally link the CLI globally
cd packages/cli && pnpm link --global

# Start using
memory-lane save "always use pnpm for package installation"
memory-lane list
memory-lane recall "where did we leave off"
memory-lane doctor
```

## Architecture

Eight packages in a monorepo:

| Package | Purpose |
|---|---|
| `@memory-lane/core` | Pure Node.js library. Zero harness dependencies. |
| `@memory-lane/lifecycle` | Shared harness-neutral memory automation policy for recall, autosave, context budgets, and tool outcomes. |
| `@memory-lane/cli` | CLI wrapper. Works with any harness that can shell out. |
| `@memory-lane/obsidian-mirror` | Optional one-way JSONL → Obsidian Markdown mirror. |
| `@memory-lane/obsidian-import` | Standalone parser/planner for explicit Obsidian Markdown → JSONL imports. |
| `@memory-lane/claude-adapter` | Claude Code hook adapter exposed through `memory-lane claude ...`. |
| `@memory-lane/codex-adapter` | Codex hook adapter exposed through `memory-lane codex ...`. |
| `@memory-lane/pi-adapter` | pi extension adapter. |

## Storage

By default, memories are stored as append-only JSONL at `~/.memory-lane/memory.jsonl`. Each write appends a record; reads fold duplicates by id (last write wins). Atomic writes use `.tmp` + `rename`.

Embeddings (when configured) default to `~/.memory-lane/embeddings.jsonl` with mixed embedding records and invalidation records.

For sandboxed harnesses, Memory Lane first tries global storage at `~/.memory-lane`. If that home storage is not writable and no explicit `MEMORY_LANE_*` paths are set, commands and hooks automatically initialize project-local storage at `.memory-lane/` and continue there.

You can also initialize project-local storage explicitly:

```bash
memory-lane init --project-local --project /path/to/project
```

Project-local initialization creates `.memory-lane/` in the project, adds `.memory-lane/` to `.gitignore`, and creates `.memory-lane-scope`. Commands and hooks run with `--project /path/to/project` automatically prefer this project-local store unless explicit `MEMORY_LANE_*` paths are set.

## Project Scoping

Project identity is resolved in order:
1. `.memory-lane-scope` file (walks up from cwd) — `{ "id": "your-project-uuid" }`
2. Git root (via `git rev-parse --show-toplevel`)
3. Global scope (fallback — memories are visible everywhere)

Scope files are never auto-created. Create one manually in a project root:
```bash
echo '{"id":"my-project-uuid"}' > .memory-lane-scope
```

## CLI Commands

```
memory-lane save <text>           Save an approved memory
memory-lane suggest <text>        Queue a pending suggestion for review
memory-lane recall [query]        Recall memories (semantic or lexical)
memory-lane list [--status ...]   List memories
memory-lane search <query>        Lexical text search
memory-lane approve <id>          Approve a pending memory
memory-lane reject <id>           Reject a memory
memory-lane delete <id>           Soft-delete a memory
memory-lane review                Show pending memories
memory-lane compact               Remove deleted/rejected tombstones
memory-lane doctor                Diagnostic report
memory-lane status                Quick stats
memory-lane reindex [--force]     Rebuild embeddings
memory-lane init --project-local  Initialize sandbox-friendly project-local storage
memory-lane obsidian ...          Manage optional Obsidian mirror/import workflows
```

All commands support `--json` for machine-readable output and `--project <path>` to set the project scope.

### Obsidian mirror

Obsidian support is opt-in and disabled by default. JSONL remains the source of truth; Memory Lane can mirror active `approved` and `pending` memories into generated Markdown files in an Obsidian-compatible vault. Hooks do not configure or prompt for Obsidian setup.

```bash
memory-lane obsidian init --vault ~/Obsidian/MyVault
memory-lane obsidian status
memory-lane obsidian sync --dry-run
memory-lane obsidian sync
```

Generated mirror files include:

```text
Memory Lane/index.md
Memory Lane/indexes/pending.md
Memory Lane/indexes/approved.md
Memory Lane/indexes/project.md
Memory Lane/indexes/recent.md
Memory Lane/memories/<id>.md
```

Index files are generated, read-only mirror artifacts. They are safe to browse in Obsidian, but they are not user-authored import notes and may be overwritten by `memory-lane obsidian sync`. The index pages use standard Markdown links to `memories/<id>.md` files. Do not edit generated files directly; changes may be overwritten on the next sync or memory mutation. Rejected/deleted memories are removed from the mirror. Stale deletion is constrained to generated files marked with `memory_lane_mirror: true`; generated indexes are additionally marked with `memory_lane_index: true`.

Generated files include lightweight tags for Obsidian browsing, Bases, or Dataview filtering. Memory files include `memory-lane`, `memory-lane/memory`, and status/category/kind tags such as `memory-lane/status/approved`, `memory-lane/category/project`, and `memory-lane/kind/project_fact`. Index files include `memory-lane` and `memory-lane/index`.

`memory-lane doctor` includes cheap Obsidian diagnostics such as configured vault/folder paths, mirror/import folder existence, and warnings. Doctor does not repair, sync, or write Obsidian files.

`obsidian init` and non-dry-run `obsidian sync` also create an `imports/` folder for user-authored import notes; `obsidian sync --dry-run` does not write files.

### Import from Obsidian

Memory Lane can explicitly import user-authored Markdown notes from the configured Obsidian folder. Import is **not** automatic sync, not bidirectional sync, and not Obsidian-backed storage: JSONL remains the source of truth, generated mirror memory files and generated indexes are never imported, and source notes are not rewritten, moved, archived, deleted, or annotated with generated ids.

Only this folder is scanned, recursively:

```text
<vault>/<folder>/imports/
```

The first implementation intentionally does **not** support `--vault`, `--folder`, or `--path` overrides for import. Configure the mirror once with `memory-lane obsidian init --vault <path> [--folder "Memory Lane"]`, then run import against that configured location.

Each importable note must opt in with top-of-file frontmatter:

```md
---
memory_lane: true
category: project
scope: project
status: pending
---
Use pnpm for package installs.
```

The Markdown body after frontmatter, trimmed, becomes the memory text. Frontmatter is metadata only. Unknown frontmatter fields are ignored. Defaults are:

```yaml
category: personal
scope: global
status: pending
```

Preview first; dry-run performs no JSONL writes and no mirror writes:

```bash
memory-lane obsidian import --dry-run
memory-lane obsidian import --json --dry-run
```

Apply imports:

```bash
memory-lane obsidian import
memory-lane obsidian import --json
```

Rules and gotchas:

- Notes without `memory_lane: true` are ignored.
- Notes with `memory_lane_mirror: true` are skipped because they are generated mirror files; generated indexes also have `memory_lane_index: true` and are not user-authored import notes.
- Dotfiles, dotfolders, symlinks, and non-`.md` files are skipped during discovery.
- Discovery order is deterministic by normalized relative path.
- `status` may be `pending` or explicit `approved`; `rejected` and `deleted` are invalid for import.
- `scope: project` requires a project identity from the running command context; otherwise the note is skipped with a warning.
- Add `memory_lane_id: <id>` to update an existing active (`approved` or `pending`) memory. Missing, rejected, or deleted ids are skipped with warnings.
- Updates do not allow status demotion from `approved` to `pending`, scope changes, or project identity changes.
- Duplicate `memory_lane_id` values in the same run skip all conflicting notes. Duplicate create body text in the same run also skips all conflicting notes.
- Import is partial-success: valid notes are applied; invalid notes are skipped with warnings; there is no transaction or rollback.
- Apply writes through normal Memory Lane APIs, so validation, append-only JSONL, embedding invalidation, and best-effort mirror warnings still apply.

## Configuration

Default config path: `~/.memory-lane/config.json`

Override via env variable: `MEMORY_LANE_CONFIG=/path/to/config.json`

### Minimal config (semantic disabled — default)

No config file needed. Lexical search works out of the box.

### Semantic search config

```json
{
  "semantic": {
    "enabled": true,
    "activeEmbeddingProfile": "local-ollama",
    "embeddings": {
      "profiles": {
        "local-ollama": {
          "provider": "openai-compatible-embeddings",
          "baseUrl": "http://localhost:11434/v1",
          "model": "nomic-embed-text",
          "apiKeyEnv": null
        }
      }
    },
    "retrieval": {
      "topK": 8,
      "minSimilarity": 0.25,
      "semanticWeight": 0.65,
      "lexicalWeight": 0.25,
      "recencyWeight": 0.1,
      "fallbackToAllVisibleOnMiss": true
    },
    "privacy": {
      "allowRemoteEmbeddings": false
    }
  }
}
```

After configuring, run `memory-lane reindex` to embed existing memories.

`memory-lane doctor` is read-only. When semantic search is enabled, it reports how many approved memories have current embeddings for the active profile/model. If coverage is low, doctor prints a semantic warning such as “Run `memory-lane reindex`.” Reindexing is an explicit repair step and is not run automatically by doctor or hooks.

`memory-lane doctor` also reports hook debug log diagnostics: `hookDebugEnabledInCurrentEnv`, `hookDebugLogPath`, `hookDebugLogExists`, `hookDebugLogSizeBytes`, `hookDebugLogLastModified`, and `hookDebugWarnings`. These fields help confirm where `~/.memory-lane/hooks-log.jsonl` is, whether it exists, and its size/mtime. Doctor only stats the path; it does not create, read, rotate, truncate, or modify hook debug logs.

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `MEMORY_LANE_CONFIG` | `~/.memory-lane/config.json` | Config file path |
| `MEMORY_LANE_FILE` | `~/.memory-lane/memory.jsonl` | Memory store path |
| `MEMORY_LANE_EMBEDDINGS_FILE` | `~/.memory-lane/embeddings.jsonl` | Embeddings store path |

Explicit environment paths always win and never auto-fallback. If no explicit paths are set and a parent directory contains `.memory-lane/`, Memory Lane uses that project-local store. If home storage is not writable, Memory Lane auto-initializes `.memory-lane/` in the current project path.

## Programmatic Use

```typescript
import { MemoryEngine } from "@memory-lane/core"

const engine = new MemoryEngine()

// Save
engine.save({ text: "use pnpm for all installs", status: "approved" })

// Recall (semantic or lexical)
const result = await engine.recall("package manager")

// Search (lexical, returns approved only in current project scope)
const memories = engine.search("pnpm")

// List
const all = engine.list()
const pending = engine.list("pending")
```

## Memory Lifecycle

```
user/agent → suggest() → pending → approve() → approved
                                 → reject()  → rejected
approved   → delete()           → deleted
```

Compaction removes deleted + rejected tombstones. Trigger: `memory-lane compact` or startup auto-check (>30% dead weight + >100 records).

## Harness Integrations

See [`examples/harness-integrations/`](./examples/harness-integrations/) for integration snippets for:
- Claude Code CLI
- OpenAI Codex CLI
- Cursor
- Windsurf

### Claude Code hooks

Claude Code CLI users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use
```

`UserPromptSubmit` injects a small relevant memory block. `Stop` and `PostToolUse` save useful memories externally and are silent by default. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.

These commands are for Claude Code CLI hooks, not the Claude Desktop app. Claude Desktop would need a separate MCP-style integration.

### Codex hooks

Codex users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
```

`UserPromptSubmit` injects a small relevant memory block. `Stop` and `PostToolUse` save useful memories externally and are silent by default. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.
