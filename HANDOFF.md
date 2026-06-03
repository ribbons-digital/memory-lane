# Memory Lane Handoff

## Current state

Memory Lane is on `main` at commit `9876cb8 merge: obsidian mirror status warnings`.

Recent completed work:

- Added and merged Phase 1 Codex hook integration.
- Added and merged a thin Claude Code CLI hook adapter.
- Confirmed the Claude adapter is for **Claude Code CLI hooks only**, not Claude Desktop.
- Added `ROADMAP.md` for planned Obsidian mirror/import, MCP server, and experimental Obsidian-backed storage work.
- Added Obsidian vocabulary and decision docs:
  - `CONTEXT.md`
  - `docs/adr/0002-obsidian-mirror-before-import-and-backed-storage.md`
- Implemented and merged Phase 1 Slice 1: optional one-way Obsidian mirror foundation.
- Implemented and merged a small follow-up slice surfacing Obsidian mirror warnings from approve/reject/delete status transitions.
- Cleaned up the Obsidian feature worktrees and branches:
  - removed `~/.config/superpowers/worktrees/memory-lane/obsidian-mirror-foundation`
  - deleted `feature/obsidian-mirror-foundation`
  - removed `~/.config/superpowers/worktrees/memory-lane/obsidian-mirror-status-warnings`
  - deleted `feature/obsidian-mirror-status-warnings`

Post-merge verification on `main` passed after refreshing workspace links with:

```bash
sfw pnpm install
pnpm build
pnpm test
```

`main` is clean. After the status-warning follow-up merge, it may be ahead of `origin/main` until pushed.

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
- CLI/API approve/reject/delete status transition warnings also surface when mirror sync warns.
- Config writes now preserve nested existing settings via deep merge.

Known accepted Phase 1 limitations:

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

Expected current uncommitted files before committing the import-contract docs:

- `ROADMAP.md` — updated to make the next active slice the Controlled Obsidian Import Contract.
- `CONTEXT.md` — updated with Obsidian import area/importable note terminology.
- `HANDOFF.md` — updated to reflect the merged status-warning follow-up and import-contract docs.
- `docs/adr/0003-controlled-obsidian-import-contract.md` — new ADR for the controlled import boundary.
- `docs/superpowers/specs/2026-06-03-obsidian-import-contract.md` — new detailed import contract spec.

No code changes are expected before the next implementation plan is approved.

## Suggested next steps

1. Commit the import-contract documentation updates.
2. Write an implementation plan for the first import implementation slice, keeping it to five todos.
3. Implement import with TDD in a feature worktree.
4. Continue real-world soak/testing of Codex Desktop hook integration before implementing `SessionStart` baseline injection.
5. Plan future MCP server support for Claude Desktop and other clients after mirror/import foundations are clear.

## Suggested skills

A fresh agent should consider invoking:

- `using-superpowers` — required at conversation start in this environment.
- `writing-plans` — before implementing any roadmap phase.
- `test-driven-development` — for Obsidian import, MCP, or mirror follow-up implementation.
- `systematic-debugging` — if hook/storage/mirror behavior is surprising.
- `requesting-code-review` — before merging new feature work.
- `verification-before-completion` — before claiming implementation is complete.
- `using-git-worktrees` — if starting a new feature branch/worktree.
