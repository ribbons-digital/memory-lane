---
name: memory-lane
description: Persistent project-specific memory with semantic retrieval. Use when you need to save, recall, search, or manage durable memories across sessions. Supports approved (immediate) and suggested (pending review) workflows.
---

# Memory Lane

Local-first persistent memory system with semantic retrieval for coding agents.

## When to Use

- **User explicitly asks you to remember something** → use `memory_save` tool
- **You proactively identify something worth remembering** → use `memory_suggest` tool (user reviews later)
- **You need to recall past context** → use `memory_recall` tool
- **User asks "what were we working on?"** → use `memory_recall` with that query

## CLI Commands

All commands support `--json` for machine-readable output.

### Save (approved immediately)

```bash
memory-lane save "Use pnpm for package management" --category project
memory-lane save "I prefer dark mode" --category preference
memory-lane save "Project uses TypeScript 5.4" --category project
```

Categories: `preference`, `personal`, `project`

### Suggest (pending review, or approved directly)

```bash
# Pending review (default)
memory-lane suggest "Consider adding CI pipeline for linting" --category project

# Approved directly (when user explicitly asked to remember)
memory-lane suggest "User prefers pnpm" --category preference --status approved
```

### Recall (semantic + lexical search of approved memories)

```bash
memory-lane recall "package manager"
memory-lane recall "what were we working on"
```

### List (respects project scope by default)

```bash
memory-lane list                   # only memories visible to current project
memory-lane list --all             # show ALL memories across all projects
memory-lane list --status pending  # pending memories in current scope
memory-lane list --status approved
```

> **Project scope**: `list`, `search`, and `recall` only show memories scoped to the current project (global memories + project-matching memories). Use `--all` to bypass scope filtering.

### Other commands

```bash
memory-lane search "pnpm"         # lexical search within project scope
memory-lane review                # list pending for review
memory-lane approve <id>          # approve a pending memory
memory-lane reject <id>           # reject a pending memory
memory-lane delete <id>           # soft-delete a memory
memory-lane status                # quick stats
memory-lane doctor                # full diagnostic report
memory-lane compact               # remove deleted/rejected entries
memory-lane reindex               # (re)build embeddings for all approved memories
memory-lane init --project-local  # initialize sandbox-friendly project-local storage
```

### Hook adapters

Memory Lane includes lifecycle hook commands for supported CLI harnesses:

```bash
# Claude Code CLI hooks, not Claude Desktop
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use

# OpenAI Codex CLI hooks
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
```

`UserPromptSubmit` recalls relevant approved memories and injects a small context block. `Stop` and `PostToolUse` save useful memories externally and are silent by default. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise diagnostics.

### Sandboxed storage

Default storage is `~/.memory-lane/`. If home storage is not writable and no explicit `MEMORY_LANE_*` paths are set, Memory Lane auto-initializes project-local `.memory-lane/` and continues there. Explicit `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, and `MEMORY_LANE_CONFIG` always win and do not auto-fallback.

```bash
memory-lane init --project-local --project /path/to/project
```

### Semantic search configuration

Semantic search is **disabled by default**. Enable it to use vector-based retrieval:

```bash
memory-lane config enable-semantic    # turn on semantic search
memory-lane config disable-semantic   # turn off semantic search
memory-lane config show               # view current config
memory-lane config set <key> <value>  # set any config value (dot-path)
```

After enabling, build embeddings:

```bash
memory-lane reindex                   # embed all approved memories
memory-lane reindex --force           # re-embed even existing vectors
```

> **Auto-embed**: When semantic search is enabled and an embedding provider is configured, newly saved approved memories are automatically embedded — no manual reindex needed for incremental saves.

### Project scope

```bash
memory-lane save "test command is pnpm test" --project /path/to/project
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--json` | Output JSON instead of human-readable text |
| `--project <path>` | Set the project scope directory |
| `--all` | (list) Show all memories, bypassing project scope |
| `--status <s>` | Filter by status: `approved`, `pending`, `rejected`, `deleted` |
| `--category <c>` | Set category: `preference`, `personal`, `project` |
| `--scope <s>` | Set scope: `global`, `project` |

## API (for direct library use)

```typescript
import { MemoryEngine } from "@memory-lane/core"

const engine = new MemoryEngine()

// Save approved (no review needed)
engine.save({ text: "...", status: "approved", category: "project" })

// Suggest (pending review)
engine.suggest("...")

// Recall (semantic + lexical)
const result = await engine.recall("query")

// List — respects project scope by default
engine.list()                         // scoped to current project
engine.list({ all: true })            // all memories, all projects
engine.list({ status: "approved" })   // approved + scoped
engine.list("approved")               // legacy: same as above
```

## Pi Harness Tools

When used as a pi extension, three tools are available:

| Tool | Description |
|------|-------------|
| `memory_save` | Save an approved persistent memory (bypasses review) |
| `memory_suggest` | Queue a memory suggestion for user review |
| `memory_recall` | Recall approved memories via semantic + lexical search |
