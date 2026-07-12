---
name: memory-lane
description: Persistent project-specific memory with semantic retrieval. Use when you need to save, recall, search, or manage durable memories across sessions. Supports approved (immediate) and suggested (pending review) workflows.
---

# Memory Lane

Local-first, review-governed persistent memory for coding agents.

## Fast path: broad project-status / next-work prompts

Use this bounded path for prompts like “what were we working on?”, “where are we?”, “resume this thread”, “what should we work on next?”, “project status”, or “next slice”.

1. For broad status/next-work prompts, call `memory_continuity({})` when MCP is available, or run:
   ```bash
   memory-lane continuity --json
   ```
   Use `memory_continuity({ query })` / `memory-lane continuity --query "<topic>" --json` only for topic-specific workstream discovery prompts such as “resume building X”.
2. Prefer `latestProgress` for current progress.
   Treat `latestApproved.project` as a legacy compatibility slot that may contain corrections/procedures.
   If continuity renders `Action required before applying continuity guidance` or warning-level `suggestedActions`, inspect those commands before treating overlapping workflow guidance as authoritative.
3. Verify against compact repo state with bounded reads:
   - `HANDOFF.md` → status card: current state, next work, constraints.
   - `ROADMAP.md` → active index: current status and next track first.
   - `docs/superpowers/archive/*` → history only; skip unless asked.
   - `README.md` → user-facing command/setup changes only.
   - this skill → workflow/Memory Lane command guidance only.
4. Use targeted `memory_recall` / `memory-lane recall` only as a follow-up for a specific topic, not as the first stop for broad continuity. Recall keeps lexical relevance primary; currentness-like exact ties between project checkpoints prefer newer `updatedAt`.
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
- **You need setup/status diagnostics** → use `memory-lane status --json`, `memory-lane doctor --json`, or `memory_status`.
  Legacy project-memory diagnostics may include bounded sample previews.

## Project docs sync rule

For the Memory Lane repository itself, do not call a phase/slice/merge/release complete or recommend next work until status docs are synced. Use continuity first, then compact current docs. Skip archived roadmap/history and long references unless required. At minimum check whether `HANDOFF.md`, root `ROADMAP.md`, `README.md`, and this skill need updates when status, commands, workflow guidance, or release state changed. Memory checkpoints help but are not sufficient; root docs stay authoritative for new sessions.

## Core commands

All commands support `--json` when machine-readable output is useful.

```bash
# Save / suggest
memory-lane save "Use pnpm for package management" --category project
memory-lane save "Released v1.2.3" --category project --kind project_checkpoint
memory-lane suggest "Consider adding CI pipeline for linting" --category project
memory-lane suggest "User prefers pnpm" --category preference --status approved

# Broad continuity / targeted lookup
memory-lane continuity --json
memory-lane continuity --query "resume building package manager" --json
memory-lane recall "package manager"
memory-lane show <id>
memory-lane get <id>

# Review / status
memory-lane review
memory-lane review --suspect-meta --include-approved
memory-lane status --json
memory-lane doctor --json
memory-lane migrate project-local --dry-run --json
memory-lane migrate project-local --dry-run --write-plan <path> --project <project>
memory-lane migrate project-local --apply-plan <path> --yes
memory-lane dashboard
memory-lane agreements
memory-lane agreements --area project-loop --json

# Explicit revision operations
memory-lane update <id> --text "refined memory" --reason "clarified"
memory-lane replace <old-id> --text "new successor memory" --kind workflow_rule [--all]
memory-lane supersede <new-id> <old-id...> --yes [--all]
memory-lane rescope <id> --scope project --project <path> --dry-run [--all]
memory-lane move <id> --scope global --yes [--all]

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

Use `--kind` on `memory-lane save` when an explicit memory kind should override inference.
Detailed command/reference material lives in `skills/memory-lane/REFERENCE.md`. Read that file only when the compact guidance above is insufficient.

## Revision and cleanup rules

When a durable memory is wrong, stale, duplicated, or superseded, prefer explicit revision commands over saving near-duplicates:

```bash
memory-lane update <id> --text "refined memory" --reason "clarified"
memory-lane replace <old-id...> --text "new successor memory" --yes [--all]
memory-lane supersede <new-id> <old-id...> --reason "newer version" --yes [--all]
```

Use `--dry-run` where available before changing scope or relationships.
Revision commands use global plus current-project visibility by default, use global-only visibility when no project scope is active, and require `--all` for cross-project maintenance.
Denied scoped lookups use not-found behavior without exposing hidden memory text or appending new records.
Active continuity slots and workstream discovery omit superseded records, but list/show/recall can still expose them for explicit inspection.
Avoid silent deletion/rejection/cleanup without explicit user approval.

## Continuity and operating agreements

- Use `memory-lane continuity --json` / `memory_continuity({})` for broad workstream state.
- Use `memory-lane continuity --query "..." --json` / `memory_continuity({ query })` for topic-specific workstream discovery.
- Use `memory-lane agreements` for project workflow, review gates, PR process, release process, or tooling workflow rules.
  If continuity warns about overlapping operating agreements, use the exact per-area `memory-lane agreements --area <area> --json` action before applying the guidance.
- Use `memory-lane status --json`, `memory-lane doctor --json`, or MCP `memory_status` for text-free continuity/staleness metadata.
  Legacy project-memory diagnostics on the same surfaces may include bounded sample previews.
  Use `memory-lane dashboard` only when a compact human-facing overview is appropriate.
- Treat pending continuity as review candidates, not approved facts.
- Inspect full memories by exact id with `memory-lane show <id>` or MCP `memory_get` when continuity says operating guidance was truncated or a SessionStart `Memory Index` descriptor is relevant. Exact inspection includes descriptor metadata when present.

## Lifecycle context semantics

Automatic lifecycle context is controlled by `memory.contextPolicy`:

- `selective` injects bounded selected approved memories for eligible ordinary/topic-specific prompts.
- `policy-only` injects guidance to use Memory Lane tools without memory bodies.
- `off` disables automatic lifecycle context while preserving explicit CLI/MCP tools and save hooks.

Prompt-time broad continuity guidance is not a memory body.
It is a cue to inspect continuity/status/dashboard/roadmap before answering from chat context alone.
Broad project-position/next-work prompts should receive guidance without ordinary recall bodies; topic-specific prompts can still include bounded relevant memory.
Generated Pi bridges use the shared `memory-lane route --prompt <text> --json` CLI decision so they stay in parity with repo-local adapters, including deduped continuity rendering and promoted warning inspection actions.

At `SessionStart`, Memory Lane may inject a compact `Continuity notice` in `policy-only` or `selective` modes. In `selective` mode, it can also render tiny always-on memories plus a `Memory Index` of descriptor cards; structured descriptors use stored `description` and `fetchHint` metadata when present, otherwise generated previews. The notice shares the existing SessionStart budget and omits memory ids, memory text, transcripts, and tool outputs.

## Hook adapters and harness boundaries

Claude Code CLI and Codex CLI hooks:

```bash
memory-lane claude session-start
memory-lane claude user-prompt-submit
memory-lane claude stop
memory-lane claude post-tool-use
memory-lane claude session-end
memory-lane claude pre-compact

memory-lane codex session-start
memory-lane codex user-prompt-submit
memory-lane codex stop
memory-lane codex post-tool-use
memory-lane codex pre-compact
```

- Claude adapter is for **Claude Code CLI hooks**, not Claude Desktop.
- Claude Desktop / Codex Desktop use the MCP server for explicit tools; MCP is not lifecycle automation.
- Current Codex CLI hooks do not expose a supported `SessionEnd` event. Do not add `SessionEnd` to `.codex/hooks.json`.
- `Stop`, `PreCompact`, and `PostToolUse` save useful memories externally and are silent by default.
- Hook commands fail safe: if storage/config/plugin initialization fails, Claude/Codex hook invocations return `{}` and exit successfully so the host session is not blocked.
- Set `MEMORY_LANE_HOOK_DEBUG=1` for concise diagnostics at `~/.memory-lane/hooks-log.jsonl`; debug logs do not include prompts, transcripts, or tool output.

Pi:

- Pi supports manual tools/commands, explicit `memory_continuity`, and read-only lifecycle context through `before_agent_start`.
- Repo-local Pi `/memory review` and `/memory delete <id>` stay scoped by default; use `--all` only for explicit cross-project maintenance.
- Broad Pi continuity prompts should route to canonical continuity before recall in both repo-local adapter and generated native-binary bridge.
- Repo-local Pi lifecycle writes are intentionally low-noise: explicit memory requests on `input`, higher-signal stop/tool candidates on `turn_end`/`tool_result`.
- Release-style generated Pi bridges currently do not register `input`, `turn_end`, or `tool_result`; keep first-class OMP installer work gated until the pinned OMP contract report passes.
- Do not assume automatic pi `agent_end` or `session_shutdown` summaries.
- The native pi adapter and release-style generated pi bridge `session_before_compact` handlers can queue pending pre-compact summaries when `memory.sessionEndSummary.enabled` is configured, `memory.sessionEndSummary.requireConfirmation` is `false`, and `memory.preCompactSummary.enabled` is not `false`.

## Session-end summarization

Use `memory-lane session-end --confirm` only when the user explicitly wants to generate a manual session summary and `memory.sessionEndSummary` is configured.
In Pi, use `/memory session-summary`; it reads the current branch through Pi's session manager and asks for confirmation.
Claude/Codex `PreCompact` and the native pi adapter or release-style generated pi bridge `session_before_compact` handlers can queue pending pre-compact summaries only when the summary provider is configured and `memory.sessionEndSummary.requireConfirmation` is `false`; set `memory.preCompactSummary.enabled` to `false` to opt out.
Generated summaries are pending memories for review.
Raw transcripts are not stored; tool messages are excluded by default and likely secrets are redacted before the transcript is sent to the configured model.
`memory.sessionEndSummary.timeoutMs` is optional and defaults to 30000 ms for OpenAI-compatible summary calls.

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

Default storage is two-tier when no explicit `MEMORY_LANE_*` paths are set: global-scope memories, including default preferences and personal memories, stay in `~/.memory-lane/`, while new current-project-scoped memories write to the resolved project `<root>/.memory-lane/`. If home storage is not writable, writable commands/hooks auto-initialize project-local single-store fallback; read-only inspection commands should not create fallback storage. Explicit `MEMORY_LANE_FILE`, `MEMORY_LANE_EMBEDDINGS_FILE`, and `MEMORY_LANE_CONFIG` always win and keep single-store behavior.

Legacy project-scoped memories from before project-local defaults may still live in the home store.
Use `memory-lane status --json`, `memory-lane doctor --json`, MCP `memory_status`, or `memory-lane migrate project-local --dry-run --json` to inspect them.
The diagnostics include counts, hazard counters, and bounded sample previews when legacy candidates exist.
To migrate legacy candidates, first write and review an explicit plan with `memory-lane migrate project-local --dry-run --write-plan <path> --project <project>`.
Plan files may contain memory text and should not be committed.
After review, apply the plan with `memory-lane migrate project-local --apply-plan <path> --yes`.
Do not imply records are moved without an explicit reviewed plan and `--yes`.

Semantic search is disabled by default. Enable it, then run `reindex` when existing approved memories are missing current vectors for the active profile/model/content hash:

```bash
memory-lane config enable-semantic
memory-lane reindex
```

Use `memory-lane reindex --force` to recompute existing current vectors.

## Safety defaults

- Do not store secrets. Likely secret-looking content is rejected or redacted on supported paths.
- Local learning capture is opt-in through `learning.capture: "on"`; captured review outcome events are content-free metadata, not memory text or prompts.
  Suggestion ids, subject refs, project refs, provenance refs, trigger-context digests, reason digests, recommendation ids, and related suggestion ids are hashed.
  Source, suggestion kind, event type, decision type, actor, reason code, recommended action, and initial review state remain enum metadata.
- Do not rely on operational subagent/reviewer/task wrapper chatter becoming memory; lifecycle filters suppress it.
- Explicit user memory requests remain supported even when they mention reviewer/subagent behavior.
- Use project scope by default. Use `--all` only when intentionally auditing cross-project memories.
