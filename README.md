# Memory Lane

Local-first memory for AI coding agents — CLI, hooks, pi extension, semantic recall, and optional Obsidian mirror/import, all backed by simple JSONL files.

## Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
  - [One-line installer](#one-line-installer-recommended)
  - [Build from source](#build-from-source)
  - [Link the CLI globally](#link-the-cli-globally)
  - [Development setup: local checkout + manual harness config](#development-setup-local-checkout--manual-harness-config)
- [Architecture](#architecture)
- [Storage](#storage)
- [Project Scoping](#project-scoping)
- [CLI Commands](#cli-commands)
  - [Session-end summarization](#session-end-summarization)
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
# Install the binary
curl -fsSL -o install.sh https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh
sh install.sh

# Configure your harnesses
memory-lane init

# Start using
memory-lane save "always use pnpm for package installation"
memory-lane list
memory-lane recall "where did we leave off"
memory-lane doctor
```

## Installation

### One-line installer (recommended)

macOS / Linux:

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
```

Windows (PowerShell):

```powershell
irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 | iex
```

The installer downloads a prebuilt binary and places it on your PATH. After installation, run `memory-lane init` to configure Claude Code, Codex, Claude Desktop, Codex Desktop, and pi. Use `memory-lane init --yes` to auto-configure all detected harnesses without prompting.

If you are an end user, this installer + `memory-lane init` path is the recommended setup. If you are developing Memory Lane and also using it on the same machine, prefer the [development setup](#development-setup-local-checkout--manual-harness-config) below instead of `memory-lane init --yes`; release-style init can replace local dev shims and hand-edited harness config.

If you prefer to review the script first, save it and run locally:

```bash
curl -fsSL -o install.sh https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh
sh install.sh
```

```powershell
irm https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.ps1 -OutFile install.ps1
.\install.ps1
```

After installing, run `memory-lane init` again any time to reconfigure or add new integrations.

### Upgrading

Run the built-in upgrade command to download the latest binary and re-apply only the harness configs you already had installed:

```bash
memory-lane upgrade
```

Use `memory-lane upgrade --yes` to run non-interactively. On macOS and Linux this re-runs the installer and then refreshes your existing configs. On Windows it downloads the new binary and prompts you to run `memory-lane init --yes` in a fresh terminal (because Windows locks the running executable).

Your memory data in `~/.memory-lane/` is preserved.

You can also upgrade manually by re-running the installer and then `memory-lane init --yes`:

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
memory-lane init --yes
```

### Build from source

For development or custom builds:

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

### Development setup: local checkout + manual harness config

If you are developing Memory Lane and using it on the same machine, avoid `memory-lane init --yes` unless you intentionally want release-style harness config. The init wizard is safe for end users, but on a development machine it can overwrite local shims or hand-edited settings that point at your checkout. Prefer manual config so each harness loads the code you just built.

Recommended development loop:

```bash
cd /absolute/path/to/memory-lane
pnpm install
pnpm build
cd packages/cli
pnpm link --global
```

After source changes, run `pnpm build` again and reload/restart the harness you are testing.

#### pi: load the local adapter

Create or replace `~/.pi/agent/extensions/memory-lane/index.ts` with a shim that imports your checkout:

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

The pi adapter provides manual `memory_save`, `memory_suggest`, and `memory_recall` tools plus `/memory ...` commands. It also injects relevant approved memories through pi's `before_agent_start` event. Automatic lifecycle writes are enabled for `input`, `turn_end`, and `tool_result` events: explicit memory requests, durable project statements, and successful workflow commands (e.g., `pnpm test`, `pnpm build`, `pnpm install`) are saved using the same shared lifecycle policy as Codex and Claude Code hooks. For session summaries, pi uses the explicit `/memory session-summary` command: it reads the current branch through pi's session manager, asks for interactive confirmation, and saves any generated summary as a pending `session_summary` memory with pi `session_end` provenance. It does not automatically summarize on `agent_end`, `session_shutdown`, or compaction.

#### Claude Code CLI: paste hooks manually

For local development, paste hooks into `~/.claude/settings.json` or a project-local `.claude/settings.local.json` instead of letting init own the file. Merge this `hooks` object into any existing settings:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude session-start",
            "timeout": 10,
            "statusMessage": "Loading baseline memory"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude user-prompt-submit",
            "timeout": 10,
            "statusMessage": "Retrieving relevant memory"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude stop",
            "timeout": 10,
            "statusMessage": "Saving useful memory"
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude session-end",
            "timeout": 20,
            "statusMessage": "Summarizing session memory"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane claude post-tool-use",
            "timeout": 10,
            "statusMessage": "Capturing useful tool outcome"
          }
        ]
      }
    ]
  }
}
```

Use `/hooks` in Claude Code to verify which settings file supplied the hooks. `SessionEnd` only saves summaries when `memory.sessionEndSummary` is enabled and provider-configured; by default it still requires confirmation unless `requireConfirmation` is set to `false`.

#### Codex CLI: paste supported hooks manually

For Codex CLI, paste hooks into a project-level `.codex/hooks.json` while testing, then move them to `~/.codex/hooks.json` if you want global behavior. Do **not** add a Codex `SessionEnd` hook; current Codex hooks do not support that event.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane codex session-start",
            "timeoutSec": 10,
            "statusMessage": "Loading baseline memory"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane codex user-prompt-submit",
            "timeoutSec": 10,
            "statusMessage": "Retrieving relevant memory"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane codex stop",
            "timeoutSec": 10,
            "statusMessage": "Saving useful memory"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash|shell:*",
        "hooks": [
          {
            "type": "command",
            "command": "memory-lane codex post-tool-use",
            "timeoutSec": 10,
            "statusMessage": "Capturing useful tool outcome"
          }
        ]
      }
    ]
  }
}
```

Codex `Stop` can produce a session summary only when the latest user message explicitly asks for it, such as "remember this session" or "summarize this session to memory".

#### MCP clients: point at the local server

For Claude Desktop, Codex Desktop, and other MCP clients, point the MCP server at your built checkout with absolute paths. Do not use `~` in client config fields that expect paths. A typical command is:

```text
/Users/you/.nvm/versions/node/v22.22.3/bin/node
```

with argument:

```text
/absolute/path/to/memory-lane/packages/mcp-server/dist/index.js
```

Set the working directory to the project you want Memory Lane to scope against, for example `/absolute/path/to/your/project`.

End users do not need these manual development shims — `memory-lane init` installs release-style integrations automatically.

## Plugins

Memory Lane supports lightweight opt-in plugins. Core features stay built-in; optional capabilities ship as separate packages that you activate in `~/.memory-lane/config.json`.

```json
{
  "plugins": ["@memory-lane/plugin-obsidian-wiki"],
  "pluginConfig": {
    "@memory-lane/plugin-obsidian-wiki": {
      "vaultPath": "/Users/alice/Documents/Obsidian",
      "includeFolders": ["Garden"]
    }
  }
}
```

See [`docs/plugins/README.md`](docs/plugins/README.md) for installation methods, plugin development, and distribution options.

### Obsidian Wiki plugin

`@memory-lane/plugin-obsidian-wiki` lets LLM clients search and read selected Obsidian/Garden notes as source-backed knowledge without turning those notes into Memory Lane memories automatically.

- MCP tools: `obsidian_wiki_search`, `obsidian_wiki_read`
- MCP resource: `memory-lane://obsidian-wiki/notes`
- CLI: `memory-lane obsidian-wiki status`

Promotion of wiki-derived facts into Memory Lane remains explicit through the existing `memory_save` tool or `/memory` commands.

**Installing the Obsidian Wiki plugin:**

- If you use the standalone binary: the plugin is bundled in official `v0.2.1+` releases, but you must still enable it by adding `"@memory-lane/plugin-obsidian-wiki"` to `plugins` in `~/.memory-lane/config.json`.
- If you build Memory Lane from source: `sfw pnpm add @memory-lane/plugin-obsidian-wiki` in the repository root, then enable it in `config.json`.
- For a custom checkout: add `@memory-lane/plugin-obsidian-wiki` to `pnpm-workspace.yaml`, enable it in `config.json`, and reference it by name.

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
memory-lane session-end --confirm Generate a pending session summary from stdin JSON
memory-lane obsidian ...          Manage optional Obsidian mirror/import workflows
```

All commands support `--json` for machine-readable output and `--project <path>` to set the project scope.

### Session-end summarization

Session-end summarization is opt-in and disabled by default. It sends a compact session transcript to an explicitly configured OpenAI-compatible chat model, then saves the generated summary as a **pending** memory with `source: "session-summary"`, `kind: "session_summary"`, and `provenance.lifecycleEvent: "session_end"`. The transcript itself is not stored in Memory Lane.

Configure it in `~/.memory-lane/config.json`:

```json
{
  "memory": {
    "sessionEndSummary": {
      "enabled": true,
      "provider": "openai-compatible",
      "baseUrl": "http://localhost:11434/v1",
      "apiKeyEnv": "MEMORY_LANE_SUMMARY_API_KEY",
      "model": "gpt-4.1-mini",
      "maxTokens": 800,
      "requireConfirmation": true,
      "includeToolOutputs": false
    }
  }
}
```

Run it manually with explicit confirmation:

```bash
echo '{"messages":[{"role":"user","content":"Switch to pnpm"},{"role":"assistant","content":"Done."}]}' \
  | memory-lane session-end --confirm
memory-lane review
memory-lane approve <id>
```

Codex CLI does not currently expose a supported `SessionEnd` hook event. Do not add `SessionEnd` to `.codex/hooks.json`; Codex will ignore it. For Codex today, use either the manual `memory-lane session-end --confirm` command or the supported `Stop` hook explicit-intent path: when the latest user message says something like "remember this session", "save a session summary", or "summarize this session to memory", `memory-lane codex stop` treats that request as confirmation, summarizes a bounded transcript through the configured provider, and saves the result as a pending session-summary memory. Ordinary `Stop` turns keep the existing silent autosave behavior and do not run the summarizer.

Tool messages are excluded unless `includeToolOutputs` is true. Lines that look like secrets are redacted before the transcript is sent to the configured model. Claude Code supports `memory-lane claude session-end` through its documented `SessionEnd` hook; by default it still requires confirmation and will not save from a bare hook unless `memory.sessionEndSummary.requireConfirmation` is set to `false` or the payload includes `confirmed: true` for manual testing. pi supports explicit session summaries through `/memory session-summary`, using pi's session manager plus interactive confirmation; automatic pi `agent_end`, `session_shutdown`, and compaction summarization remain out of scope.

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

`memory-lane doctor` also reports read-only integration diagnostics. It checks whether common local config files appear to contain Memory Lane setup for Claude Desktop MCP, Codex hooks, Claude Code hooks, and the pi extension. These checks inspect config/entrypoint files only; they do not read prompts, transcripts, tool outputs, memory text, MCP traffic, or hook debug log contents. MCP provides explicit tools; hooks and pi provide automatic lifecycle recall/save where supported.

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
- `memory_status` — read Memory Lane counts, config paths, project scope, and integration diagnostics
- `memory_list` — list memories visible to the current project scope by default
- `memory_review` — list pending memories for review
- `memory_approve` — approve a memory by id
- `memory_reject` — reject a memory by id
- `memory_delete` — soft-delete a memory by id

Use `memory_status` from MCP clients when you want the same kind of read-only setup/status overview that `memory-lane doctor` provides in a terminal. It reports counts and diagnostics only; it does not return raw memory text or run lifecycle hooks.

**Tip for Claude Desktop and Codex Desktop:** if you ask the model to save or recall a memory without mentioning the MCP, it may first try the `memory-lane` CLI, fail because the sandbox cannot write to `~/.memory-lane`, and then fall back to MCP. To skip that error turn, explicitly say "use the Memory Lane MCP" in your request.

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

Run `memory-lane init` to auto-detect and configure supported harnesses, or see [`examples/harness-integrations/`](./examples/harness-integrations/) for manual snippets for:
- MCP Server
- Claude Code CLI
- OpenAI Codex CLI
- Cursor
- Windsurf
- pi

Lifecycle autosave intentionally filters transient reviewer, subagent, and task prompts such as commit review requests, “do not modify files” review tasks, and delegated status-report instructions. Those operational prompts are not durable memory. Explicit memory requests remain supported and authoritative: use `memory-lane save ...` or phrases like “Remember that ...” for durable workflow rules, preferences, or project facts.

### pi adapter

The pi adapter supports manual Memory Lane tools and commands (`memory_save`, `memory_suggest`, `memory_recall`, and `/memory ...`). It performs read-only lifecycle recall injection through pi's documented `before_agent_start` event: relevant approved memories may be injected as hidden `memory-lane` context before the agent starts.

pi also writes memories automatically through lifecycle events:

- `input` — explicit memory requests ("Remember that...") and durable project statements are filtered through the shared stop-candidate policy.
- `turn_end` — the last user and assistant messages are evaluated for memory-worthy candidates after a turn completes.
- `tool_result` — successful shell workflow commands such as `pnpm test`, `pnpm build`, and `pnpm install` are captured as project workflow rules.

Automatic writes skip secrets, transient imperatives, reviewer/subagent meta-prompts, and duplicates within a turn. Set `MEMORY_LANE_DEBUG=1` to append privacy-safe debug records to `~/.memory-lane/pi-debug.jsonl` (no prompts or tool outputs are logged).

For session summaries, use `/memory session-summary` in pi. The command reads the current conversation branch through pi's session manager, asks for interactive confirmation, sends the compact transcript to the configured `memory.sessionEndSummary` provider, and saves any result as a pending `session_summary` memory with pi `session_end` provenance. Memory Lane does not automatically summarize pi sessions on `agent_end`, `session_shutdown`, or compaction.

### Context policy

Lifecycle hooks use `memory.contextPolicy` to decide how much context to inject. Defaults preserve existing behavior with bounded selected memory blocks:

```json
{
  "memory": {
    "contextPolicy": {
      "mode": "selective",
      "maxItems": { "sessionStart": 4, "prompt": 6 },
      "maxChars": { "sessionStart": 1600, "prompt": 3000 },
      "includePending": false,
      "fallbackToSearch": true
    }
  }
}
```

Modes:

- `selective` injects selected approved memories inside a guarded `<memory-context>` block.
- `policy-only` injects compact guidance telling the agent to use Memory Lane recall/list tools when needed, without including memory bodies.
- `off` disables automatic context injection while leaving explicit CLI/MCP tools and automatic save hooks unchanged.

### Claude Code hooks

Claude Code CLI users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane claude session-start
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use
memory-lane claude session-end
```

`SessionStart` injects a small baseline memory block. `UserPromptSubmit` injects a small relevant memory block. `Stop` and `PostToolUse` save useful memories externally and are silent by default. Claude Code's documented `SessionEnd` hook can run `memory-lane claude session-end` to generate pending `session_summary` memories when `memory.sessionEndSummary.enabled` is configured. By default, Memory Lane still requires confirmation; a bare hook will not save unless `memory.sessionEndSummary.requireConfirmation` is set to `false` or the payload is invoked with `confirmed: true` for manual testing. A real Claude Code CLI smoke test in Sitewright confirmed `SessionEnd` fires with the project cwd and saves a pending `session_summary` with Claude `session_end` provenance when enabled and configured. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.

These commands are for Claude Code CLI hooks, not the Claude Desktop app. Use the MCP Server setup above for Claude Desktop.

### Codex hooks

Codex CLI users can wire Memory Lane into lifecycle hooks:

```bash
memory-lane codex session-start
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
```

`SessionStart` baseline injection is available for a small session-opening memory block. `UserPromptSubmit` injects a small relevant memory block. `Stop` and `PostToolUse` save useful memories externally and are silent by default. If the latest user message explicitly asks to summarize the session (for example, "remember this session"), the supported `Stop` hook path uses `memory.sessionEndSummary` to save a pending session summary; do not configure an unsupported Codex `SessionEnd` hook. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise hook diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.

See `examples/harness-integrations/codex-cli.md` for setup details.
