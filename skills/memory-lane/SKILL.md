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

### Operating agreements

When you need the current project workflow, review gates, PR process, release process, or tooling workflow rules, prefer the explicit command:

```bash
memory-lane agreements
memory-lane agreements --area project-loop
```

The command returns approved operating agreement text for the current project plus global scope. `memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` only expose text-free agreement metadata.

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
memory-lane review --suspect-meta # list likely old pending operational prompt pollution only
memory-lane review --suspect-meta --include-approved # include approved suspect pollution that may affect recall
memory-lane approve <id>          # approve a pending memory
memory-lane reject <id>           # reject a pending memory
memory-lane delete <id>           # soft-delete a memory
memory-lane agreements            # inspect approved operating agreement text
memory-lane status                # quick stats
memory-lane status --json --since 2026-06-18T00:00:00.000Z
memory-lane doctor                # full diagnostic report
memory-lane doctor --json --since 2026-06-18T00:00:00.000Z
memory-lane compact               # remove deleted/rejected entries
memory-lane reindex               # (re)build embeddings for all approved memories
memory-lane init                  # first-time setup wizard for harnesses
memory-lane init --yes            # auto-configure all detected harnesses
memory-lane init --project-local  # initialize sandbox-friendly project-local storage
memory-lane session-end --confirm # generate a pending session-summary memory from stdin JSON
/memory session-summary           # pi only: explicitly summarize the current pi session after confirmation
memory-lane uninstall             # remove binary and integration configs
memory-lane uninstall --yes       # non-interactive uninstall
memory-lane mcp                   # run the bundled MCP server over stdio
```

Freshness status is read-only and memory-text-free. It reports approved visible-memory changes since a checkpoint timestamp so agents can notice possible newer continuity without injecting large memory bodies.

### Session-end summarization

Use `memory-lane session-end --confirm` only when the user explicitly wants to generate a manual session summary and `memory.sessionEndSummary` is configured. It reads stdin JSON with a `messages` array, sends the compact transcript to the configured OpenAI-compatible chat model, and saves the result as a pending memory with `source: "session-summary"` and `kind: "session_summary"`. In pi, use `/memory session-summary` for the supported explicit session-summary path; it reads the current branch through pi's session manager, asks for interactive confirmation, and saves a pending `session_summary` with pi `session_end` provenance. Memory Lane does not automatically summarize pi sessions on `agent_end`, `session_shutdown`, or compaction. Codex CLI also supports explicit-intent automation through the real `Stop` hook: when the latest user prompt says something like "remember this session", "save a session summary", or "summarize this session to memory", `memory-lane codex stop` treats that as confirmation and saves a pending summary if the provider is configured. Current Codex CLI hooks do not include a supported `SessionEnd` event, so do not suggest adding `SessionEnd` to `.codex/hooks.json`.

```bash
echo '{"messages":[{"role":"user","content":"Switch to pnpm"},{"role":"assistant","content":"Done."}]}' \
  | memory-lane session-end --confirm
memory-lane review
memory-lane review --suspect-meta  # optional: find old pending delegated-task/finalization prompt pollution
memory-lane review --suspect-meta --include-approved  # include approved suspects that may affect recall
```

Do not imply this is fully automatic handoff-free mode or that every Codex `Stop` turn creates a summary. Approve or reject generated summaries through the normal review queue before they affect future recall. Raw transcripts are not stored; tool messages are excluded unless `includeToolOutputs` is configured, and likely secret lines are redacted before the transcript is sent to the configured model.

### Obsidian mirror

```bash
memory-lane obsidian init --vault ~/Obsidian/MyVault
memory-lane obsidian status
memory-lane obsidian sync --dry-run
memory-lane obsidian sync
```

The Obsidian mirror is opt-in and one-way: JSONL remains the source of truth and generated Markdown files may be overwritten. Generated mirror memory files live under `<vault>/<folder>/memories/<id>.md` and are marked with `memory_lane_mirror: true`.

Generated mirror index files live at `<vault>/<folder>/index.md` and `<vault>/<folder>/indexes/*.md` (`pending.md`, `approved.md`, `project.md`, and `recent.md`). Treat indexes like generated mirror memory files: do not edit them as source notes, do not import them, and do not imply changes to indexes update JSONL memories. They use standard Markdown links to `memories/<id>.md` and may be overwritten by `memory-lane obsidian sync`.

Generated memory files include lightweight tags such as `memory-lane`, `memory-lane/memory`, and status/category/kind tags. Generated index files include `memory-lane` and `memory-lane/index`. Do not tell users to edit generated mirror files as a way to change memory state.

`memory-lane doctor` includes cheap Obsidian diagnostics when the mirror is configured, but it does not repair, sync, or write Obsidian files. Hooks should not configure, prompt for, or run Obsidian mirror/import setup.

## Obsidian import

Use explicit import commands only when the user asks to import user-authored Obsidian notes into Memory Lane. Do not imply automatic sync, bidirectional sync, or Obsidian-backed storage, and do not import generated mirror files. Hooks should not configure, prompt for, or run Obsidian import.

Commands:

```bash
# Always preview first
memory-lane obsidian import --dry-run
memory-lane obsidian import --json --dry-run

# Apply only after the user accepts the plan/warnings
memory-lane obsidian import
memory-lane obsidian import --json
```

Import notes live under `<vault>/<folder>/imports/` and must include top-of-file `memory_lane: true` frontmatter. JSONL remains the source of truth. Source notes are read-only inputs: Memory Lane does not rewrite, move, archive, delete, or add ids to them.

Import note rules/gotchas for agents:

- Import uses the configured Obsidian mirror location only; do not pass or invent `--vault`, `--folder`, or `--path` overrides for `obsidian import`.
- Generated mirror files with `memory_lane_mirror: true` are skipped, including generated indexes with `memory_lane_index: true`.
- Notes without `memory_lane: true` are ignored.
- Dotfiles, dotfolders, symlinks, and non-`.md` files are skipped.
- Body text after frontmatter becomes the memory text; frontmatter is metadata only.
- Defaults: `category: personal`, `scope: global`, `status: pending`.
- Allowed import statuses: `pending` and `approved`. `rejected`/`deleted` are invalid.
- `scope: project` requires project identity; otherwise the note is skipped with a warning.
- `memory_lane_id` updates only active approved/pending memories; deleted, rejected, or missing ids are skipped with warnings.
- Updates cannot demote approved memories to pending or change scope/project identity.
- Duplicate ids or duplicate create body text in one run cause all conflicting notes to be skipped.
- Apply is partial-success and non-transactional: valid notes may be saved while invalid notes are skipped.
- Apply uses normal Memory Lane save/update behavior, so validation, append-only JSONL, embedding invalidation, and best-effort mirror warnings still apply.

### Hook adapters

Memory Lane includes lifecycle hook commands for supported CLI harnesses:

```bash
# Claude Code CLI hooks, not Claude Desktop
memory-lane claude session-start
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use

# OpenAI Codex CLI hooks
memory-lane codex session-start
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
```

`session-start` performs baseline memory injection for new sessions. `user-prompt-submit` recalls relevant approved memories. `stop` and `post-tool-use` save useful memories externally and are silent by default. Current Codex CLI hooks do not expose a `SessionEnd` event; use manual `memory-lane session-end --confirm` or the Codex `Stop` explicit-intent path for session summaries.

`UserPromptSubmit` recalls relevant approved memories and injects a small context block. `Stop` and `PostToolUse` save useful memories externally and are silent by default. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.

Automatic context injection is controlled by `memory.contextPolicy`: `selective` injects bounded selected approved memories inside a guarded `<memory-context>` block, `policy-only` injects guidance to use Memory Lane tools without memory bodies, and `off` disables automatic context injection while preserving explicit CLI/MCP tools and save hooks.

Lifecycle autosave filters transient reviewer, subagent, and task prompts such as commit review requests, “do not modify files” review tasks, and delegated status-report instructions. Do not rely on those operational prompts becoming memories. When a durable workflow rule, preference, or project fact should be saved, make it explicit with `memory_save`, `memory-lane save`, or wording like “Remember that ...”. Explicit memory requests remain supported even when they mention reviewer/subagent behavior.

For hook support checks, prefer `memory-lane doctor` first: use `hookDebugLogPath`, `hookDebugLogExists`, `hookDebugLogSizeBytes`, `hookDebugLogLastModified`, and `hookDebugWarnings` to confirm log availability without reading raw log contents. Only inspect `~/.memory-lane/hooks-log.jsonl` itself when the user asks or when troubleshooting requires it.

### pi adapter boundary

In pi, Memory Lane provides manual tools/commands and read-only lifecycle recall injection before the agent starts through pi's `before_agent_start` event. Do not assume pi currently performs Codex/Claude-style automatic stop autosave or post-tool-use tool outcomes capture. When a durable pi workflow rule, preference, or project fact should be saved, use `memory_save` for explicit user requests or `memory_suggest` for proactive suggestions.

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

When `memory-lane doctor` reports `semanticWarnings`, treat them as advisory diagnostics. Do not run `memory-lane reindex` automatically from a hook or without user approval; offer it as an explicit repair command because it writes the embedding sidecar and may call the configured embedding provider.

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

## Slash commands

When Memory Lane is installed as a harness skill, you can invoke it directly:

- **Claude Code CLI**: type `/memory-lane` followed by what you want to do.
- **Codex CLI/Desktop/app**: type `$memory-lane` followed by what you want to do.

Examples:
- `/memory-lane save that we use pnpm for package management`
- `/memory-lane recall what we were working on`
- `$memory-lane suggest we should add CI linting`

These skills are installed by `memory-lane init`:
- Claude Code CLI skill: `~/.claude/skills/memory-lane/SKILL.md`
- Codex skill: `~/.agents/skills/memory-lane/SKILL.md`

## MCP vs CLI

When running inside an MCP client that has Memory Lane MCP configured (Claude Desktop, Codex Desktop, etc.), prefer the MCP tools. If the user asks you to save or recall a memory and does not specify the MCP, explicitly say you will use the Memory Lane MCP to avoid the model defaulting to the CLI, hitting a sandbox write restriction on `~/.memory-lane`, and only then falling back to MCP.

Example phrasing:
- "I'll use the Memory Lane MCP to save that."
- "Using the Memory Lane MCP, here's what I recall: ..."

If MCP is not available, fall back to the CLI commands below.

For end users, the recommended setup is the installer from GitHub Releases followed by `memory-lane init`:

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
memory-lane init
```

To upgrade to the latest release while preserving existing harness configs and memory data:

```bash
memory-lane upgrade
```

In pi, Memory Lane keeps lifecycle writes intentionally low-noise: `/memory` commands and tools save explicitly, `input` only saves explicit memory requests such as “Remember that ...”, and `turn_end` / `tool_result` capture higher-signal stop candidates and successful workflow rules. Use `/memory review` to inspect pending suggestions.

Optional Memory Lane plugins extend the CLI and MCP server. For example, `@memory-lane/plugin-obsidian-wiki` adds Obsidian/Garden knowledge-base search and reading. Enable plugins in `~/.memory-lane/config.json` under `plugins`.

## Pi Harness Tools

When used as a pi extension, three tools are available:

| Tool | Description |
|------|-------------|
| `memory_save` | Save an approved persistent memory (bypasses review) |
| `memory_suggest` | Queue a memory suggestion for user review |
| `memory_recall` | Recall approved memories via semantic + lexical search |
