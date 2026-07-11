---
name: memory-lane
description: Persistent project-specific memory with semantic retrieval. Use when you need to save, recall, search, or manage durable memories across sessions. Supports approved (immediate) and suggested (pending review) workflows.
---

# Memory Lane

Local-first persistent memory system with semantic retrieval for coding agents.

## When to Use

- **User explicitly asks you to remember something** → use `memory_save` tool
- **You proactively identify something worth remembering** → use `memory_suggest` tool (user reviews later)
- **You need a targeted approved fact, preference, or project memory** → use `memory_recall` tool
- **User asks broad continuity questions like "what were we working on?", "where are we?", or "what should we do next?"** → use `memory_continuity` (MCP) or `memory-lane continuity --json` (CLI) before falling back to recall/roadmap inspection

## Project Docs Sync Rule

For the Memory Lane repository itself, do not call a phase/slice/merge/release complete and do not recommend next work until project status docs are checked and synced. At minimum verify `HANDOFF.md`, `ROADMAP.md`, `README.md`, and this skill (`skills/memory-lane/SKILL.md`) when status, commands, workflow guidance, or release state changed. Memory checkpoints are helpful but not sufficient; repository docs must remain authoritative for new sessions.

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

### Revising memories

When a durable memory is wrong, stale, duplicated, or superseded, prefer explicit revision commands instead of saving another near-duplicate memory:

```bash
memory-lane update <id> --text "refined memory" --reason "clarified"
memory-lane replace <old-id> --text "new successor memory" --kind workflow_rule [--all]
memory-lane supersede <new-id> <old-id> --reason "newer version" [--all]
memory-lane rescope <id> --scope project --project <path> --dry-run [--all]
```

`update` keeps the same memory id.
`replace` creates a new successor memory.
`supersede` links an existing approved successor to approved old memories.
Use `--dry-run` to preview revision commands before writing scope or relationship changes.
Use `--yes` for multi-old `replace` or `supersede`.
Revision commands use global plus current-project visibility by default, use global-only visibility when no project scope is active, and require `--all` for cross-project maintenance.
Denied scoped lookups use not-found behavior without exposing hidden memory text or appending new records.
Active continuity slots and workstream discovery omit superseded records, but list/show/recall can still expose them for explicit inspection.
MCP mutation tools are not available for these revision operations yet.

### Recall (semantic + lexical search of approved memories)

Use recall for targeted approved facts, preferences, and project memories, not as the canonical first stop for broad handoff/continuity questions.

```bash
memory-lane recall "package manager"
memory-lane recall "preferred release workflow"
```

### Continuity (canonical broad workstream state)

Use continuity first for broad handoff-style questions such as "what were we last working on?", "where are we?", "resume this thread", or "what should we work on next?".

```bash
memory-lane continuity --json
memory-lane continuity --query "resume building package manager" --json
```

MCP-capable harnesses should call `memory_continuity({ projectPath })` for broad status prompts, or include `query` for topic-specific workstream discovery. CLI-only harnesses may use the command above; correct continuity behavior does not require direct MCP usage.

When present, prefer `latestProgress` for broad “last worked on / where are we” answers.
Treat `latestApproved.project` as a legacy compatibility slot that may still contain corrections/procedures, and apply bounded `operatingGuidance` as workflow guidance rather than as the main progress answer.
Active selected slots use non-superseded approved memories, collapse operating guidance to one preview per workflow area, de-duplicate repeated ids in human continuity context, and prefer safe descriptor metadata for previews when available.
If continuity surfaces `Action required before applying continuity guidance`, inspect the listed commands before applying overlapping workflow guidance.

### Operating agreements

When you need the current project workflow, review gates, PR process, release process, or tooling workflow rules, prefer the explicit command:

```bash
memory-lane agreements
memory-lane agreements --area project-loop --json
```

The command returns approved operating agreement text for the current project plus global scope. `memory-lane status --json`, `memory-lane doctor --json`, and MCP `memory_status` only expose text-free agreement metadata.

### Continuity hints

Use `memory-lane dashboard` for a compact human overview of continuity hints. Use `memory-lane status --json`, `memory-lane doctor --json`, or MCP `memory_status` when an agent needs text-free metadata about possible stale or overlapping continuity state. For natural-language workstream discovery such as "resume this thread" or "find where X was implemented", use existing continuity surfaces with a query: `memory-lane continuity --query "..." --json` or MCP `memory_continuity({ projectPath, query: "..." })`. Discovery is read-only and pointer-based; it skips superseded records but does not clean up, delete, reject, or mutate any memory.

### Legacy project-local diagnostics

Legacy project-scoped memories from before project-local defaults may still live in the home store.
Use `memory-lane status --json`, `memory-lane doctor --json`, MCP `memory_status`, or `memory-lane migrate project-local --dry-run --json` to inspect active legacy candidates for the current project.
The diagnostics are read-only and may include counts, hazard counters, and at most 10 sample previews capped at 160 characters.
To migrate candidates, first write and review a plan with `memory-lane migrate project-local --dry-run --write-plan <path> --project <project>`.
Plan files may contain memory text and should not be committed.
After review, apply with `memory-lane migrate project-local --apply-plan <path> --yes`.
Memory Lane does not move, delete, approve, reject, or consolidate records without this explicit reviewed plan and confirmation.

### List (respects project scope by default)

```bash
memory-lane list                   # only memories visible to current project
memory-lane list --all             # show ALL memories across all projects
memory-lane list --status pending  # pending memories in current scope
memory-lane list --status approved
```

> **Project scope**: `list`, `search`, `recall`, review, by-id mutation, and revision commands use the current project plus global memories by default.
> When no project scope is active, the default is global-only.
> Use `--all` only for explicit cross-project maintenance.

### Other commands

```bash
memory-lane search "pnpm"         # lexical search within project scope
memory-lane review [--all]        # list pending for review
memory-lane review --suspect-meta # list likely old pending operational prompt pollution only
memory-lane review --suspect-meta --include-approved # include approved suspect pollution that may affect recall
memory-lane show <id>             # inspect one exact active memory id in current scope, including descriptor metadata when present
memory-lane get <id>              # alias for show
memory-lane rescope <id> --scope project --project <path> --dry-run [--all] # preview same-id scope correction
memory-lane move <id> --scope global --yes [--all] # alias for rescope; apply with confirmation
memory-lane approve <id> [--all]  # approve a pending memory
memory-lane reject <id> [--all]   # reject a pending memory
memory-lane delete <id> [--all]   # soft-delete a memory
memory-lane agreements            # inspect approved operating agreement text
memory-lane update <id> --text "..." --reason "..." # revise an active memory in place
memory-lane supersede <new-id> <old-id...> [--yes] [--all] # link approved old memories to an approved successor
memory-lane replace <old-id...> --text "..." [--yes] [--all] # create a successor memory
memory-lane route --prompt "what should we work on next?" --json # internal harness routing decision
memory-lane status                # quick stats
memory-lane status --json --since 2026-06-18T00:00:00.000Z
memory-lane doctor                # full diagnostic report
memory-lane doctor --json --since 2026-06-18T00:00:00.000Z
memory-lane migrate project-local --dry-run # preview legacy home-stored project memories without mutating files
memory-lane migrate project-local --dry-run --write-plan <path> --project <project> # write a reviewable migration plan
memory-lane migrate project-local --apply-plan <path> --yes # apply a reviewed migration plan
memory-lane compact               # remove deleted/rejected entries while preserving invalid rows
memory-lane reindex               # embed approved memories missing current vectors
memory-lane init                  # first-time setup wizard for harnesses
memory-lane init --yes            # auto-configure all detected harnesses
memory-lane init --project-local  # initialize sandbox-friendly project-local storage
memory-lane session-end --confirm # generate a pending session-summary memory from stdin JSON
memory-lane claude pre-compact   # Claude Code hook: pre-compaction pending summary
memory-lane codex pre-compact    # Codex hook: pre-compaction pending summary
/memory session-summary           # pi only: explicitly summarize the current pi session after confirmation
memory-lane uninstall             # remove binary and integration configs
memory-lane uninstall --yes       # non-interactive uninstall
memory-lane mcp                   # run the bundled MCP server over stdio
```

Freshness status is read-only and memory-text-free. It reports approved visible-memory changes since a checkpoint timestamp so agents can notice possible newer continuity without injecting large memory bodies.

### Checkpoint candidate review labels

Checkpoint candidate labels: when `memory-lane review` or MCP `memory_review` marks a pending memory as a checkpoint candidate, treat it as review-first project progress. Ask the user to approve/reject using normal review controls; do not assume it affects continuity until approved.

Labels may identify pending memories that look like releases, merges, verification milestones, docs syncs, major fixes, roadmap decisions, or explicit `project_checkpoint` records. They do not create memories, approve memories, deduplicate candidates, change recall ranking, or add thread/workstream lookup.

### Session-end summarization

Use `memory-lane session-end --confirm` only when the user explicitly wants to generate a manual session summary and `memory.sessionEndSummary` is configured. It reads stdin JSON with a `messages` array, sends the compact transcript to the configured OpenAI-compatible chat model, and saves the result as a pending memory with `source: "session-summary"` and `kind: "session_summary"`. In pi, use `/memory session-summary` for the supported explicit session-summary path; it reads the current branch through pi's session manager, asks for interactive confirmation, and saves a pending `session_summary` with pi `session_end` provenance. Claude/Codex `PreCompact` hooks and native pi `session_before_compact` can queue pending pre-compact summaries with `pre_compact` provenance when the summary provider is configured and `memory.sessionEndSummary.requireConfirmation` is `false`; set `memory.preCompactSummary.enabled` to `false` to opt out. Memory Lane does not automatically summarize pi sessions on `agent_end` or `session_shutdown`. Codex CLI also supports explicit-intent automation through the real `Stop` hook: when the latest user prompt says something like "remember this session", "save a session summary", or "summarize this session to memory", `memory-lane codex stop` treats that as confirmation and saves a pending summary if the provider is configured. `memory.sessionEndSummary.timeoutMs` is optional and defaults to 30000 ms for OpenAI-compatible summary calls. Current Codex CLI hooks do not include a supported `SessionEnd` event, so do not suggest adding `SessionEnd` to `.codex/hooks.json`.

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
- Body text after frontmatter becomes the memory text; frontmatter is metadata only. Descriptor metadata is not imported from frontmatter yet.
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
memory-lane claude session-end
memory-lane claude pre-compact

# OpenAI Codex CLI hooks
memory-lane codex session-start
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
memory-lane codex pre-compact
```

`session-start` performs compact baseline injection for new sessions only when `memory.contextPolicy.mode` allows lifecycle context; `selective` can render tiny always-on memories plus `Memory Index` descriptor cards, `policy-only` emits guidance without memory bodies, and `off` disables lifecycle context. Descriptor cards use stored `description` and `fetchHint` metadata when present, otherwise generated previews. `user-prompt-submit` recalls relevant approved memories for ordinary/topic-specific prompts in `selective` mode, while broad project-position/next-work continuity prompts receive inspection-first continuity guidance without ordinary recall bodies. `stop`, `pre-compact`, and `post-tool-use` save useful memories externally and are silent by default. `pre-compact` can queue pending summaries before compaction only when `memory.sessionEndSummary.requireConfirmation` is `false`; set `memory.preCompactSummary.enabled` to `false` to opt out. Hook commands fail safe: if storage/config/plugin initialization fails, Claude/Codex hook invocations return `{}` and exit successfully so the host session is not blocked; set `MEMORY_LANE_HOOK_DEBUG=1` to also print the initialization failure on stderr. Current Codex CLI hooks do not expose a `SessionEnd` event; use manual `memory-lane session-end --confirm`, Codex `PreCompact`, or the Codex `Stop` explicit-intent path for session summaries.

`UserPromptSubmit` follows `memory.contextPolicy.mode`: `off` suppresses lifecycle context, `policy-only` emits guidance without memory bodies, and `selective` injects a small context block for ordinary/topic-specific prompts; for broad continuity prompts such as “what were we last working on?” or “what should we work on next?”, it injects guidance to inspect canonical continuity instead of injecting recall-selected memory bodies. `Stop`, `PreCompact`, and `PostToolUse` save useful memories externally and are silent by default. Set `MEMORY_LANE_HOOK_DEBUG=1` for concise diagnostics and persistent metadata/count logs at `~/.memory-lane/hooks-log.jsonl`. The hook debug log does not include prompts, transcripts, or tool output.

Automatic context injection is controlled by `memory.contextPolicy`: `selective` injects bounded selected approved memories inside a guarded `<memory-context>` block for eligible ordinary/topic-specific prompts, `policy-only` injects guidance to use Memory Lane tools without memory bodies, and `off` disables automatic context injection while preserving explicit CLI/MCP tools and save hooks.

Prompt-time continuity guidance: if the user asks natural questions like “resume building X,” “where was X implemented,” “where are we,” “what is the next item's scope,” “what were we last working on,” or “what should we work on next,” Memory Lane may inject inspection-first guidance. Treat it as a cue to inspect `memory-lane continuity --json` for broad status or `memory-lane continuity --query "..." --json` for topic-specific workstreams (or MCP `memory_continuity({ projectPath, query })`), status/dashboard/roadmap, and only use recall as a topic-specific follow-up. Broad project-position/next-work prompts get guidance without ordinary recall bodies; topic-specific prompts can still include bounded relevant memory. The guidance itself is not a memory body and does not mean Memory Lane performed cleanup or saved new progress.

### Lifecycle continuity notices

At SessionStart, Memory Lane may inject a compact `Continuity notice` when context policy is `policy-only` or `selective`. Treat it as a prompt to inspect authoritative surfaces such as `memory-lane dashboard`, `memory-lane agreements`, or `memory-lane status --json --since <timestamp>`; it is not a memory body and does not mean cleanup or recall filtering happened.

Continuity notices share the existing SessionStart context budget and omit memory ids, memory text, transcripts, and tool outputs. Context policy `off` disables all automatic lifecycle context, including continuity notices.

Lifecycle autosave filters transient reviewer, subagent, and task prompts such as commit review requests, “do not modify files” review tasks, and delegated status-report instructions. Do not rely on those operational prompts becoming memories. When a durable workflow rule, preference, or project fact should be saved, make it explicit with `memory_save`, `memory-lane save`, or wording like “Remember that ...”. Explicit memory requests remain supported even when they mention reviewer/subagent behavior.

For hook support checks, prefer `memory-lane doctor` first: use `hookDebugLogPath`, `hookDebugLogExists`, `hookDebugLogSizeBytes`, `hookDebugLogLastModified`, and `hookDebugWarnings` to confirm log availability without reading raw log contents. Only inspect `~/.memory-lane/hooks-log.jsonl` itself when the user asks or when troubleshooting requires it.

### pi adapter boundary

In pi, Memory Lane provides manual tools/commands, explicit `memory_continuity`, and read-only lifecycle context before the agent starts through pi's `before_agent_start` event.
Broad continuity prompts such as “what were we last working on?”, “where are we?”, or “what should we work on next?” should route to canonical continuity before recall; this is supported in both the repo-local Pi adapter and the generated native-binary bridge.
Repo-local Pi exposes `/memory continuity [query]` plus the `memory_continuity` tool.
Repo-local Pi `/memory review` and `/memory delete <id>` use current-project visibility by default, return not-found behavior without memory text for out-of-scope ids, and accept `--all` only for explicit cross-project review or delete.
Release-style generated Pi bridges expose `memory_continuity`, proxy `/memory continuity ...` through the CLI, and use `memory-lane route --prompt <text> --json` for prompt routing parity.
Pi also has bounded low-noise lifecycle writes on `input`, `turn_end`, and `tool_result`; native pi `session_before_compact` can queue pending pre-compact summaries when the summary provider is configured and confirmation is disabled.
Do not assume automatic `agent_end` or `session_shutdown` summaries.
When a durable pi workflow rule, preference, or project fact should be saved, use `memory_save` for explicit user requests or `memory_suggest` for proactive suggestions.

### Sandboxed storage

Default storage is two-tier when no explicit `MEMORY_LANE_*` paths are set: global-scope memories, including default preferences and personal memories, stay in `~/.memory-lane/`, while new current-project-scoped memories write to resolved project-local `.memory-lane/`. If home storage is not writable, writable commands/hooks auto-initialize project-local single-store fallback and continue there; read-only inspection commands should not create fallback storage. Explicit `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, and `MEMORY_LANE_CONFIG` always win and do not auto-fallback.

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
memory-lane reindex                   # embed approved memories missing current vectors
memory-lane reindex --force           # re-embed even existing current vectors
```

> **Auto-embed**: When semantic search is enabled and an embedding provider is configured, newly saved approved memories are automatically embedded, so no manual reindex is needed for incremental saves.

When `memory-lane doctor` reports `semanticWarnings`, treat them as advisory diagnostics. Do not run `memory-lane reindex` automatically from a hook or without user approval; offer it as an explicit repair command because it writes the embedding sidecar and may call the configured embedding provider. Embedding profiles may set `timeoutMs`; provider calls default to 30000 ms when it is omitted.

### Project scope

```bash
memory-lane save "test command is pnpm test" --project /path/to/project
```

## CLI Flags

| Flag | Description |
|------|-------------|
| `--json` | Output JSON instead of human-readable text |
| `--project <path>` | Set the project scope directory |
| `--all` | Bypass project scope for explicit cross-project list, review, by-id, or revision maintenance |
| `--status <s>` | Filter by status: `approved`, `pending`, `rejected`, `deleted` |
| `--category <c>` | Set category: `preference`, `personal`, `project` |
| `--scope <s>` | Set scope: `global`, `project` |

## API (for direct library use)

```typescript
import { MemoryEngine } from "@memory-lane/core"

const engine = new MemoryEngine()

// Save approved (no review needed)
engine.save({ text: "...", status: "approved", category: "project" })
engine.save({
  text: "...",
  status: "approved",
  descriptor: {
    description: "Compact SessionStart summary.",
    fetchHint: "when deciding whether to inspect the full memory",
    keywords: ["session-start"],
  },
})

// Suggest (pending review)
engine.suggest("...")
engine.suggest("...", "project", "project", "project_fact", "pending", undefined, {
  description: "Compact SessionStart summary.",
})

// Descriptor strings are trimmed and bounded; keywords are lowercased and
// deduplicated before enforcing the 12-keyword limit. Secret-looking
// descriptor fields are rejected.

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
- `/memory-lane continuity`
- `$memory-lane suggest we should add CI linting`

These skills are installed by `memory-lane init`:
- Claude Code CLI skill: `~/.claude/skills/memory-lane/SKILL.md`
- Codex skill: `~/.agents/skills/memory-lane/SKILL.md`

## MCP vs CLI

When running inside an MCP client that has Memory Lane MCP configured (Claude Desktop, Codex Desktop, etc.), prefer the MCP tools. If the user asks you to save or recall a memory and does not specify the MCP, explicitly say you will use the Memory Lane MCP to avoid the model defaulting to the CLI, hitting a sandbox write restriction on `~/.memory-lane`, and only then falling back to MCP.

Example phrasing:
- "I'll use the Memory Lane MCP to save that."
- "Using the Memory Lane MCP, I'll check continuity first for that status question."

If MCP is not available, fall back to the CLI commands below.

For end users, the recommended setup is the installer from GitHub Releases followed by `memory-lane init`:

```bash
curl -fsSL https://github.com/ribbons-digital/memory-lane/releases/latest/download/install.sh | sh
memory-lane init
```

To upgrade to the latest release while preserving existing harness configs and memory data, and refreshing the install manifest version to the embedded CLI version:

```bash
memory-lane upgrade
```

In pi, Memory Lane keeps lifecycle writes intentionally low-noise: `/memory` commands and tools save/read explicitly, `memory_continuity` is the canonical broad-continuity tool, `input` only saves explicit memory requests such as “Remember that ...”, and `turn_end` / `tool_result` capture higher-signal candidates.
`turn_end` may queue pending project-scoped checkpoints, explicit workflow corrections, or high-confidence debugging-postmortem learning candidates when bounded context includes a concrete symptom, cause, prevention, and verification/recovery signal.
`tool_result` may queue conservative procedure candidates from safe failed-command recovery evidence.
These lifecycle suggestions remain pending review; they are not durable operating agreements until approved.
Use scoped `/memory review` to inspect pending suggestions, or `/memory review --all` only for deliberate cross-project review.

Optional Memory Lane plugins extend the CLI and MCP server. For example, `@memory-lane/plugin-obsidian-wiki` adds Obsidian/Garden knowledge-base search and reading. Enable plugins in `~/.memory-lane/config.json` under `plugins`.

## Pi Harness Tools

The repo-local pi extension exposes four tools.
Release-style generated pi bridges also expose `memory_get` for exact-id inspection through the CLI.
Repo-local slash commands include `/memory review [--all]` and `/memory delete <id> [--all]`; omit `--all` for normal current-project plus global visibility.

| Tool | Description |
|------|-------------|
| `memory_save` | Save an approved persistent memory (bypasses review) |
| `memory_suggest` | Queue a memory suggestion for user review |
| `memory_continuity` | Read canonical broad prior-work, next-action, or project-status continuity |
| `memory_recall` | Recall approved memories via semantic + lexical search for topic-specific follow-up |
