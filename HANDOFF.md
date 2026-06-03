# Memory Lane Handoff

## Current state

Memory Lane is on `main` at commit `00c382f feat(claude): add hook adapter`.

Recent completed work:

- Added and merged a thin Claude Code CLI hook adapter.
- Confirmed the Claude adapter is for **Claude Code CLI hooks only**, not Claude Desktop.
- Cleaned up the feature worktree and branch after merge.
- Added `ROADMAP.md` at the project root for planned Obsidian mirror/import, MCP server, and experimental Obsidian-backed storage work.

Post-merge verification on `main` passed after refreshing workspace links with:

```bash
sfw pnpm install
pnpm build
pnpm test
```

## Important references

Do not duplicate these artifacts; read them directly:

- Roadmap: `ROADMAP.md`
- Claude Code integration docs: `examples/harness-integrations/claude-code.md`
- Codex integration docs: `examples/harness-integrations/codex-cli.md`
- Memory Lane skill docs: `skills/memory-lane/SKILL.md`
- Claude adapter package: `packages/claude-adapter/`
- Shared lifecycle handlers: `packages/lifecycle/src/handlers.ts`
- CLI entrypoint: `packages/cli/src/index.ts`

External comparison references discussed:

- Basic Memory: https://github.com/basicmachines-co/basic-memory
- obsidian-mind: https://github.com/breferrari/obsidian-mind
- User's Obsidian setup summary: `/Users/shiang/Desktop/obsidian_codex_memory_types.md`

## Key decisions from discussion

- Obsidian support should be **optional**, not enabled by default.
- First Obsidian implementation should be a **mirror/import flow**, not an immediate primary storage backend.
- JSONL should remain the operational source of truth for the initial Obsidian work.
- Obsidian mirror/import should provide human-readable, editable Markdown memory surfaces.
- Hooks should remain silent and deterministic; do **not** prompt users from `UserPromptSubmit` to enable Obsidian.
- Preferred onboarding should be explicit commands such as:
  - `memory-lane setup`
  - `memory-lane obsidian init --vault <path>`
- MCP support should be developed after Obsidian mirror/import foundations, before experimental Obsidian-backed primary storage.

## Current uncommitted changes

At handoff creation time, the expected uncommitted files are:

- `ROADMAP.md` — newly created roadmap.
- `HANDOFF.md` — this handoff document.

No code changes are expected beyond those docs.

## Suggested next steps

1. Review `ROADMAP.md` for wording and sequencing.
2. Decide whether to commit `ROADMAP.md` and `HANDOFF.md`, or keep `HANDOFF.md` local only.
3. If starting implementation, begin with Phase 1 in `ROADMAP.md`: Obsidian mirror foundation.
4. Before coding, write a focused implementation plan for Phase 1 and use TDD.

## Suggested skills

A fresh agent should consider invoking:

- `using-superpowers` — required at conversation start in this environment.
- `writing-plans` — before implementing any roadmap phase.
- `test-driven-development` — for Obsidian mirror/import or MCP implementation.
- `systematic-debugging` — if hook/storage behavior is surprising.
- `requesting-code-review` — before merging new feature work.
- `verification-before-completion` — before claiming implementation is complete.
- `using-git-worktrees` — if starting a new feature branch/worktree.
