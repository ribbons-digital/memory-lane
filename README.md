# Memory Lane

Local-first memory for AI coding agents — CLI, hooks, pi extension, semantic recall, and optional Obsidian mirror/import, all backed by simple JSONL files.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
  - [Build from source](#build-from-source)
  - [Link the CLI globally](#link-the-cli-globally)
  - [Install the pi extension](#install-the-pi-extension)
- [Architecture](#architecture)
- [Storage](#storage)
- [Project Scoping](#project-scoping)
- [CLI Commands](#cli-commands)
  - [Obsidian mirror](#obsidian-mirror)
  - [Import from Obsidian](#import-from-obsidian)
- [Configuration](#configuration)
  - [Semantic search config](#semantic-search-config)
- [Environment Variables](#environment-variables)
- [Programmatic Use](#programmatic-use)
- [MCP Server](#mcp-server)
- [Memory Lifecycle](#memory-lifecycle)
- [Harness Integrations](#harness-integrations)
  - [pi adapter](#pi-adapter)
  - [Claude Code hooks](#claude-code-hooks)
  - [Codex hooks](#codex-hooks)

## Quick Start

```bash
# Build and optionally link the CLI
git clone <repo> && cd memory-lane && pnpm install && pnpm build
cd packages/cli && pnpm link --global

# Start using
memory-lane save "always use pnpm for package installation"
memory-lane list
memory-lane recall "where did we leave off"
memory-lane doctor
```

## Installation

### Build from source

```bash
git clone <repo>
cd memory-lane
pnpm install
pnpm build
```

### Link the CLI globally

```bash
cd packages/cli
pnpm link --global
```

After linking, `memory-lane` is available as a shell command:

```bash
memory-lane doctor
```

### Install the pi extension

For local development, point pi at the built adapter from this checkout:

```bash
mkdir -p ~/.pi/agent/extensions/memory-lane
cat > ~/.pi/agent/extensions/memory-lane/index.ts <<'EOF'
export default async function memoryLaneExtension(pi: any) {
  const mod = await import("file:///absolute/path/to/memory-lane/packages/pi-adapter/dist/index.js?reload=" + Date.now());
  return mod.default(pi);
}
EOF
```

Replace `/absolute/path/to/memory-lane` with your checkout path, then run `/reload` in pi. The timestamp query avoids stale module caches while iterating locally. Re-run `pnpm build` after changing Memory Lane source, then `/reload` pi again.

The pi adapter provides manual `memory_save`, `memory_suggest`, and `memory_recall` tools plus `/memory ...` commands. It also injects relevant approved memories through pi's `before_agent_start` event. pi autosave and tool-outcome capture are not enabled yet.

## Architecture

Nine packages in a monorepo:

| Package | Purpose |
|---|---|
| `@memory-lane/core` | Pure Node.js library. Zero harness dependencies. |
| `@memory-lane/lifecycle` | Shared harness-neutral memory automation policy for recall, autosave, context budgets, and tool outcomes. |
| `@memory-lane/cli` | CLI wrapper. Works with any harness that can shell out. |
| `@memory-lane/mcp-server` | Local stdio MCP server exposing explicit Memory Lane tools. |
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
1. `.memory-lane-scope` file (walks up from cwd) — `{ "id": "your-project-id" }`
2. Git identity — normal repos use the repo root; linked Git worktrees use the main checkout/common Git directory as the project key so worktrees share memories by default
3. Global scope (fallback — memories are visible everywhere)

Scope files are never auto-created. Create one manually in a project root when you want an explicit stable identity or need to override Git-derived identity:
```bash
echo '{"id":"my-project-uuid"}' > .memory-lane-scope
```

Existing memories saved under old worktree path keys are not migrated automatically. Use `memory-lane list --all` and existing review/delete/save commands if you want to clean up fragmented historical records.

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

## MCP Server

Memory Lane includes a local stdio MCP server for clients that support explicit MCP tools, such as Claude Desktop and Cursor. The workspace package is `@memory-lane/mcp-server`, and its built bin is `memory-lane-mcp`.

The MCP server exposes explicit tools only:

- `memory_save` — save an approved memory
- `memory_suggest` — queue a pending suggestion, or save approved when `status: "approved"`
- `memory_recall` — recall relevant memories for a query
- `memory_list` — list memories visible to the current project scope by default
- `memory_review` — list pending memories for review

MCP does not replace lifecycle hooks. Hooks provide automatic recall/save behavior for supported harnesses; MCP gives the model explicit tool access when the client asks for it. JSONL remains the source of truth, and Obsidian support remains optional.

Example local stdio command after building this workspace:

```bash
pnpm --filter @memory-lane/mcp-server build
node packages/mcp-server/dist/index.js
```

Do not wrap the server with commands that print banners to stdout. MCP stdio reserves stdout for JSON-RPC protocol messages.

See `examples/harness-integrations/mcp.md` for client configuration examples.

## Memory Lifecycle

```
user/agent → suggest() → pending → approve() → approved
                                 → reject()  → rejected
approved   → delete()           → deleted
```

Compaction removes deleted + rejected tombstones. Trigger: `memory-lane compact` or startup auto-check (>30% dead weight + >100 records).

## Harness Integrations

See [`examples/harness-integrations/`](./examples/harness-integrations/) for integration snippets for:
- MCP Server
- Claude Code CLI
- OpenAI Codex CLI
- Cursor
- Windsurf

Lifecycle autosave intentionally filters transient reviewer, subagent, and task prompts such as commit review requests, “do not modify files” review tasks, and delegated status-report instructions. Those operational prompts are not durable memory. Explicit memory requests remain supported and authoritative: use `memory-lane save ...` or phrases like “Remember that ...” for durable workflow rules, preferences, or project facts.

### pi adapter

The pi adapter supports manual Memory Lane tools and commands (`memory_save`, `memory_suggest`, `memory_recall`, and `/memory ...`). It also performs read-only lifecycle recall injection through pi's documented `before_agent_start` event: relevant approved memories may be injected as hidden `memory-lane` context before the agent starts.

pi lifecycle recall does not autosave new memories and does not capture tool outcomes yet. Codex and Claude Code hook adapters still own automatic stop/post-tool-use memory writes for those harnesses; pi autosave/tool capture is deferred to a later roadmap phase.

### Claude Code hooks

Claude Code CLI users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use
```

`UserPromptSubmit` injects a small relevant memory block. `Stop` and `PostToolUse` save useful memories externally and are silent by default. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.

These commands are for Claude Code CLI hooks, not the Claude Desktop app. Use the MCP Server setup above for Claude Desktop.

### Codex hooks

Codex users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
```

`UserPromptSubmit` injects a small relevant memory block. `Stop` and `PostToolUse` save useful memories externally and are silent by default. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.
