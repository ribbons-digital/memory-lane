# Memory Lane Handoff

## Current state

Memory Lane is on feature branch `feature/obsidian-import-implementation` for the explicit Obsidian import slice.

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
- Implemented explicit, non-destructive Obsidian Markdown import:
  - new `@memory-lane/obsidian-import` parser/planner package;
  - core `MemoryEngine.update` support for import updates;
  - CLI `memory-lane obsidian import [--dry-run]` dry-run/apply flow;
  - import discovery under `<vault>/<folder>/imports/` only;
  - `memory_lane: true` opt-in and `memory_lane_mirror: true` generated-file skip.

Task 5 verification on the import feature branch passed with:

```bash
pnpm build
pnpm test
```

The parent session still needs to request final review before merge. Do not merge this branch without review and user/maintainer approval.

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
- Import is explicit only; it is not automatic sync or bidirectional sync, and source notes are not rewritten.
- No Obsidian-backed storage or index pages yet.
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

No uncommitted changes are expected after the Obsidian import documentation commit. The parent session still needs to request final review before merge.

## Suggested next steps

1. Parent requests final review of the Obsidian import implementation against `docs/superpowers/specs/2026-06-03-obsidian-import-contract.md`.
2. Fix any review findings with tests first, then rerun `pnpm build` and `pnpm test`.
3. Merge only after final review approval and user/maintainer approval.
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
