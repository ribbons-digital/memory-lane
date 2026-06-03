# Memory Lane Handoff

## Current state

Memory Lane is on `main` at commit `c22a825 merge: obsidian mirror foundation`.

Recent completed work:

- Added and merged Phase 1 Codex hook integration.
- Added and merged a thin Claude Code CLI hook adapter.
- Confirmed the Claude adapter is for **Claude Code CLI hooks only**, not Claude Desktop.
- Added `ROADMAP.md` for planned Obsidian mirror/import, MCP server, and experimental Obsidian-backed storage work.
- Added Obsidian vocabulary and decision docs:
  - `CONTEXT.md`
  - `docs/adr/0002-obsidian-mirror-before-import-and-backed-storage.md`
- Implemented and merged Phase 1 Slice 1: optional one-way Obsidian mirror foundation.
- Cleaned up the Obsidian feature worktree and branch:
  - removed `~/.config/superpowers/worktrees/memory-lane/obsidian-mirror-foundation`
  - deleted `feature/obsidian-mirror-foundation`

Post-merge verification on `main` passed after refreshing workspace links with:

```bash
sfw pnpm install
pnpm build
pnpm test
```

`main` is clean and ahead of `origin/main` by 17 commits.

## Obsidian mirror foundation now on main

Implemented scope:

- Optional config under `obsidian`, disabled by default.
- New package: `packages/obsidian-mirror/`.
- New CLI commands:
  - `memory-lane obsidian status`
  - `memory-lane obsidian init --vault <path> [--folder "Memory Lane"]`
  - `memory-lane obsidian sync [--dry-run]`
- Mirror files are generated at:

```text
<vault>/<folder>/memories/<id>.md
```

- JSONL remains the source of truth.
- Mirror includes only active records: `approved` and `pending`.
- Rejected/deleted records remove stale generated files.
- Stale deletion is constrained to configured `memories/` and only deletes files with frontmatter:

```yaml
memory_lane_mirror: true
```

- `MemoryEngine` performs best-effort mirror sync after successful writes/status transitions.
- Mirror failures do not break JSONL writes.
- CLI save warnings appear in human output and JSON output.
- Config writes now preserve nested existing settings via deep merge.

Known accepted Phase 1 limitations:

- `approve()`, `reject()`, and `delete()` perform best-effort mirror sync but do not yet surface mirror warnings to CLI/API callers.
- Mirror sync currently scans/syncs the full store after mutations; targeted per-record mirroring can be optimized later if needed.
- No import, bidirectional sync, Obsidian-backed storage, or index pages yet.
- Hooks do not prompt for or own Obsidian setup.

## Important references

Do not duplicate these artifacts; read them directly:

- Roadmap: `ROADMAP.md`
- Handoff: `HANDOFF.md`
- Project vocabulary/context: `CONTEXT.md`
- Obsidian ADR: `docs/adr/0002-obsidian-mirror-before-import-and-backed-storage.md`
- Obsidian implementation plan: `docs/superpowers/plans/2026-06-03-obsidian-mirror-foundation.md`
- Claude Code integration docs: `examples/harness-integrations/claude-code.md`
- Codex integration docs: `examples/harness-integrations/codex-cli.md`
- Memory Lane skill docs: `skills/memory-lane/SKILL.md`
- Obsidian mirror package: `packages/obsidian-mirror/`
- Core engine/config: `packages/core/src/engine.ts`, `packages/core/src/config.ts`
- CLI entrypoint/formatters: `packages/cli/src/index.ts`, `packages/cli/src/formatters.ts`
- Claude adapter package: `packages/claude-adapter/`
- Shared lifecycle handlers: `packages/lifecycle/src/handlers.ts`

External comparison references discussed:

- Basic Memory: https://github.com/basicmachines-co/basic-memory
- obsidian-mind: https://github.com/breferrari/obsidian-mind
- User's Obsidian setup summary: `/Users/shiang/Desktop/obsidian_codex_memory_types.md`

## Key decisions from discussion

- Obsidian support is **optional**, not enabled by default.
- Obsidian mirror = JSONL → generated Markdown.
- Obsidian import = explicit user-marked Markdown → JSONL.
- Obsidian-backed storage = future experimental primary Markdown backend.
- JSONL remains the operational source of truth for current Obsidian support.
- Hooks should remain silent and deterministic; do **not** prompt users from `UserPromptSubmit` to enable Obsidian.
- Preferred onboarding is explicit CLI setup, especially:
  - `memory-lane obsidian init --vault <path>`
- MCP support should be developed after Obsidian mirror/import foundations, before experimental Obsidian-backed primary storage.
- Claude Desktop support should be via future MCP server, not Claude hook adapter.

## Current uncommitted changes

Expected current uncommitted file:

- `HANDOFF.md` — updated to reflect the merged Obsidian mirror foundation.

No code changes are expected.

## Suggested next steps

1. Commit this `HANDOFF.md` update if desired.
2. Push `main` when ready; it is currently ahead of `origin/main` by 17 commits.
3. Continue real-world soak/testing of Codex Desktop hook integration before implementing `SessionStart` baseline injection.
4. Start the next Obsidian slice only after choosing scope, likely one of:
   - Obsidian import design/spec.
   - Warning surfacing for approve/reject/delete mirror failures.
   - Lightweight generated index/status improvements.
5. Plan future MCP server support for Claude Desktop and other clients.

## Suggested skills

A fresh agent should consider invoking:

- `using-superpowers` — required at conversation start in this environment.
- `writing-plans` — before implementing any roadmap phase.
- `test-driven-development` — for Obsidian import, MCP, or mirror follow-up implementation.
- `systematic-debugging` — if hook/storage/mirror behavior is surprising.
- `requesting-code-review` — before merging new feature work.
- `verification-before-completion` — before claiming implementation is complete.
- `using-git-worktrees` — if starting a new feature branch/worktree.
