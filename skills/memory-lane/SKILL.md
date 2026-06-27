---
name: memory-lane
description: Persistent project-specific memory with semantic retrieval. Use when you need to save, recall, search, or manage durable memories across sessions. Supports approved (immediate) and suggested (pending review) workflows.
---

# Memory Lane

Local-first, review-governed persistent memory for coding agents.

## Fast path: broad project-status / next-work prompts

Use this bounded path for prompts like “what were we working on?”, “where are we?”, “resume this thread”, “what should we work on next?”, “project status”, or “next slice”.

1. Call `memory_continuity({ query })` when MCP is available, or run:
   ```bash
   memory-lane continuity --query "<user question>" --json
   ```
2. Prefer `latestProgress` for current progress. Treat `latestApproved.project` as a legacy compatibility slot that may contain corrections/procedures.
3. Verify against compact repo state when available:
   - `HANDOFF.md` → `## Current state`, `## Current decision / next work`, `## Load-bearing constraints`
   - `ROADMAP.md` → current phase/status section, not the whole file unless needed
   - `README.md` only for user-facing command/setup changes
   - this skill only for workflow/Memory Lane command guidance
4. Use targeted `memory_recall` / `memory-lane recall` only as a follow-up for a specific topic, not as the first stop for broad continuity.
5. For Memory Lane design/spec or pre-PR implementation reviews, invoke Opus 4.8 directly with Claude CLI:
   ```bash
   claude --model claude-opus-4-8 -p '<review prompt>'
   ```
   Ask for high-effort thinking in the prompt. Do **not** use pi subagents, subagent model overrides, `opus-4-8`, or the `opus` alias for this review.

## When to use Memory Lane tools

- **User explicitly asks you to remember something** → use `memory_save` or `memory-lane save`.
- **You proactively identify something worth remembering** → use `memory_suggest` or `memory-lane suggest` so the user can review later.
- **You need a targeted approved fact, preference, or project memory** → use `memory_recall` or `memory-lane recall`.
- **User asks broad continuity / prior-work / next-action questions** → use the fast path above.
- **You need setup/status without memory text** → use `memory-lane status --json`, `memory-lane doctor --json`, `memory_status`, or `memory-lane dashboard`.

## Project docs sync rule

For the Memory Lane repository itself, do not call a phase/slice/merge/release complete and do not recommend next work until project status docs are checked and synced. Use compact current-state sections first; do not read whole long reference docs unless their details are necessary. At minimum check whether `HANDOFF.md`, `ROADMAP.md`, `README.md`, and this skill need updates when status, commands, workflow guidance, or release state changed. Memory checkpoints are helpful but not sufficient; repository docs must remain authoritative for new sessions.

## Core commands

All commands support `--json` when machine-readable output is useful.

```bash
# Save / suggest
memory-lane save "Use pnpm for package management" --category project
memory-lane suggest "Consider adding CI pipeline for linting" --category project
memory-lane suggest "User prefers pnpm" --category preference --status approved

# Broad continuity / targeted lookup
memory-lane continuity --query "what were we last working on?" --json
memory-lane recall "package manager"
memory-lane show <id>
memory-lane get <id>

# Review / status
memory-lane review
memory-lane review --suspect-meta --include-approved
memory-lane status --json
memory-lane doctor --json
memory-lane dashboard
memory-lane agreements
memory-lane agreements --area project-loop

# Explicit revision operations
memory-lane update <id> --text "refined memory" --reason "clarified"
memory-lane replace <old-id> --text "new successor memory" --kind workflow_rule
memory-lane supersede <new-id> <old-id...> --yes
memory-lane rescope <id> --scope project --project <path> --dry-run
memory-lane move <id> --scope global --yes

# Maintenance / setup
memory-lane compact
memory-lane reindex
memory-lane init
memory-lane init --yes
memory-lane init --project-local
memory-lane upgrade --yes
memory-lane uninstall --yes
memory-lane mcp
```

Detailed command/reference material lives in `skills/memory-lane/REFERENCE.md`. Read that file only when the compact guidance above is insufficient.

## Revision and cleanup rules

When a durable memory is wrong, stale, duplicated, or superseded, prefer explicit revision commands over saving near-duplicates:

```bash
memory-lane update <id> --text "refined memory" --reason "clarified"
memory-lane replace <old-id...> --text "new successor memory" --yes
memory-lane supersede <new-id> <old-id...> --reason "newer version" --yes
```

Use `--dry-run` where available before changing scope or relationships. Do not assume superseded memories are hidden from recall/context unless a later slice explicitly implements that behavior. Avoid silent deletion/rejection/cleanup without explicit user approval.

## Continuity and operating agreements

- Use `memory-lane continuity --query "..." --json` / `memory_continuity({ query })` for broad workstream state.
- Use `memory-lane agreements` for project workflow, review gates, PR process, release process, or tooling workflow rules.
- Use `memory-lane dashboard`, `status --json`, `doctor --json`, or MCP `memory_status` for text-free continuity/staleness metadata.
- Treat pending continuity as review candidates, not approved facts.
- Inspect full memories by exact id with `memory-lane show <id>` or MCP `memory_get` when continuity says operating guidance was truncated.

## Lifecycle context semantics

Automatic lifecycle context is controlled by `memory.contextPolicy`:

- `selective` injects bounded selected approved memories for eligible ordinary/topic-specific prompts.
- `policy-only` injects guidance to use Memory Lane tools without memory bodies.
- `off` disables automatic lifecycle context while preserving explicit CLI/MCP tools and save hooks.

Prompt-time broad continuity guidance is not a memory body. It is a cue to inspect continuity/status/dashboard/roadmap before answering from chat context alone. Broad project-position/next-work prompts should receive guidance without ordinary recall bodies; topic-specific prompts can still include bounded relevant memory.

At `SessionStart`, Memory Lane may inject a compact `Continuity notice` in `policy-only` or `selective` modes. The notice shares the existing SessionStart budget and omits memory ids, memory text, transcripts, and tool outputs.

## Hook adapters and harness boundaries

Claude Code CLI and Codex CLI hooks:

```bash
memory-lane claude session-start
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use
memory-lane claude session-end

memory-lane codex session-start
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
```

- Claude adapter is for **Claude Code CLI hooks**, not Claude Desktop.
- Claude Desktop / Codex Desktop use the MCP server for explicit tools; MCP is not lifecycle automation.
- Current Codex CLI hooks do not expose a supported `SessionEnd` event. Do not add `SessionEnd` to `.codex/hooks.json`.
- `Stop` and `PostToolUse` save useful memories externally and are silent by default.
- Set `MEMORY_LANE_HOOK_DEBUG=1` for concise diagnostics at `~/.memory-lane/hooks-log.jsonl`; debug logs do not include prompts, transcripts, or tool output.

Pi:

- Pi supports manual tools/commands, explicit `memory_continuity`, and read-only lifecycle context through `before_agent_start`.
- Broad Pi continuity prompts should route to canonical continuity before recall in both repo-local adapter and generated native-binary bridge.
- Pi lifecycle writes are intentionally low-noise: explicit memory requests on `input`, higher-signal stop/tool candidates on `turn_end`/`tool_result`.
- Do not assume automatic pi `agent_end`, `session_shutdown`, or compaction summaries.

## Session-end summarization

Use `memory-lane session-end --confirm` only when the user explicitly wants to generate a manual session summary and `memory.sessionEndSummary` is configured. In Pi, use `/memory session-summary`; it reads the current branch through Pi's session manager and asks for confirmation. Generated summaries are pending memories for review. Raw transcripts are not stored; tool messages are excluded by default and likely secrets are redacted before the transcript is sent to the configured model.

## Obsidian mirror/import

Obsidian mirror is opt-in, one-way JSONL → generated Markdown. JSONL remains the source of truth.

```bash
memory-lane obsidian init --vault ~/Obsidian/MyVault
memory-lane obsidian status
memory-lane obsidian sync --dry-run
memory-lane obsidian sync
```

Obsidian import is explicit user-authored Markdown → JSONL. Always preview first and only apply after user approval:

```bash
memory-lane obsidian import --dry-run
memory-lane obsidian import --json --dry-run
memory-lane obsidian import
```

Do not imply automatic sync, bidirectional sync, or Obsidian-backed storage. Do not import generated mirror files.

## Storage and semantic search

Default storage is `~/.memory-lane/`. If home storage is not writable and no explicit `MEMORY_LANE_*` paths are set, Memory Lane auto-initializes project-local `.memory-lane/`. Explicit `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, and `MEMORY_LANE_CONFIG` always win.

Semantic search is disabled by default. Enable and build embeddings when needed:

```bash
memory-lane config enable-semantic
memory-lane reindex
```

## Safety defaults

- Do not store secrets. Likely secret-looking content is rejected or redacted on supported paths.
- Do not rely on operational subagent/reviewer/task wrapper chatter becoming memory; lifecycle filters suppress it.
- Explicit user memory requests remain supported even when they mention reviewer/subagent behavior.
- Use project scope by default. Use `--all` only when intentionally auditing cross-project memories.
