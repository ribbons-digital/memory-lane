# Memory Lane Handoff

## Current state

- Branch context for this handoff: `main` is synced through `6d234c3` (`docs: prep v0.2.37 release status`) after PR #68 merged as `5707c6c` (`fix: tighten continuity selection hygiene (#68)`).
- Latest release: `v0.2.37` at tag/commit `6d234c3`. Release workflow `28275316878` passed and published 8 assets.
- Phase 21 Slice 7/8/9 context-hygiene track is complete and dogfooded:
  - Slice 7 (`v0.2.34`) suppresses generated session summaries dominated by operational subagent/orchestrator chatter when no durable project outcome exists, and exposes read-only `reviewHygiene` hints.
  - Slice 8 (`v0.2.35`) suppresses low-signal greeting prompt injection, caps generated Pi bridge automatic recall bodies, preserves meaningful technical recall, and keeps explicit recall/get full-fidelity.
  - Slice 9 (`v0.2.36`) makes Claude/Codex broad project-position/next-work prompt families render continuity guidance without ordinary `## Relevant Memory` recall bodies while preserving topic-specific recall.
- Installed-artifact dogfood after `memory-lane upgrade --yes` passed: broad Claude/Codex `what should we work on next?` emits guidance-only context, `hi` returns `{}`, topic lookup still includes bounded relevant memory, and generated Pi bridge fake-host smoke still routes broad prompts to continuity while preserving technical recall.
- Active Memory Lane store was cleaned during post-v0.2.35 dogfood: oversized/superseded/prompt-dump/global question-fragment memories were deleted or updated with approval, pending queue reached zero, `memory-lane compact` removed tombstones, and `memory-lane reindex` restored semantic coverage to 100%.

## Current decision / next work

PR #67 completed the docs/skill context-hygiene slice:

1. `HANDOFF.md` is now this current-state handoff; the old chronology is archived at `docs/superpowers/archive/2026-06-26-pre-docs-hygiene-handoff.md`.
2. `ROADMAP.md` Phase 21 status is compact and points to specs/validation/archive instead of carrying release-by-release prose inline.
3. `skills/memory-lane/SKILL.md` now gives broad project-status/next-work prompts a bounded fast path: continuity first, compact current-state docs, no subagent Opus 4.8. Long-form guidance moved to `skills/memory-lane/REFERENCE.md`.

PR #68 completed deferred item 4 continuity selection/ranking hygiene and it is released in `v0.2.37`. Design/spec: `docs/superpowers/specs/2026-06-27-phase-21-item-4-continuity-selection-hygiene-design.md`. The slice prevents generic broad next/status queries from surfacing stale workstream candidates, and prevents release/checkpoint-style project facts from appearing as operating guidance. Non-goals held: no retrieval rewrite, embeddings/RRF, schema changes, memory mutation/cleanup, lifecycle injection changes, generated adapter changes, token budget retuning, or persisted workstream IDs. Installed-artifact dogfood after `memory-lane upgrade --yes` passed.

## Load-bearing constraints

- Preserve cross-agent continuity without silent autonomy: bounded context, explicit review, text-free diagnostics where possible, harness-neutral learning, and no silent durable rule mutation.
- For broad prior-work/project-status/next-work questions, use Memory Lane continuity before recall and verify against current repo/docs when available.
- At phase/slice completion, release, merge, or next-work recommendation, sync project status docs before calling work complete. Prefer compact current-state sections first; do not read whole long reference docs unless needed.
- Use Opus 4.8 correctly for Memory Lane design/spec reviews and pre-PR implementation reviews: `claude --model claude-opus-4-8 -p '<review prompt>'`. Do not summon Opus 4.8 through pi subagents or model overrides.
- PR-protected workflow applies: feature branch/worktree → PR → wait for user merge → after merge sync main/delete feature branch/recommend next item.
- Avoid retrieval rewrites, auto-consolidation, silent deletion, schema expansion, raw transcript indexing, or persisted workstream IDs unless a new approved slice explicitly includes them.

## Current verification evidence

Latest release/dogfood evidence:

```text
v0.2.37 release workflow: 28275316878 passed, 8 assets published
Local pre-release verification: pnpm build, pnpm test, git diff --check
Installed upgrade: memory-lane upgrade --yes passed and reconfigured Pi
Installed broad next-work continuity: latestProgress present, workstreamCandidates empty, warnings=no-topic
Installed operating guidance excludes stale release/checkpoint ids 1098781c, 7eab3ad9, 0b56ed5d
Installed topic-specific continuity query still returns workstream candidates
```

Prior v0.2.36 context-hygiene dogfood also passed: broad Claude/Codex prompt emitted guidance-only context, `hi` returned `{}`, topic lookup preserved bounded relevant memory, and generated Pi bridge fake-host smoke preserved continuity routing plus technical recall.

## Key references

- Roadmap/current product direction: `ROADMAP.md`
- Memory Lane skill guidance: `skills/memory-lane/SKILL.md`
- Full pre-compaction handoff chronology archive: `docs/superpowers/archive/2026-06-26-pre-docs-hygiene-handoff.md`
- Phase 21 post-v0.2.35 validation: `docs/superpowers/validation/2026-06-26-phase-21-post-v0.2.35-memory-cleanup-exit-validation.md`
- Slice 8 design: `docs/superpowers/specs/2026-06-26-phase-21-slice-8-context-pollution-hardening-design.md`
- Slice 9 design: `docs/superpowers/specs/2026-06-26-phase-21-slice-9-broad-continuity-injection-hygiene-design.md`
- Memory-as-a-Tool review, for future consolidation/retrieval ideas only: `MEMORY_AS_TOOL_REVIEW.md`
- Package overview and user-facing docs: `README.md`

## Package overview

- `@memory-lane/core` — storage, validation, lifecycle operations, recall/search, embeddings, mirror integration hooks.
- `@memory-lane/lifecycle` — harness-neutral memory automation policy.
- `@memory-lane/cli` — command-line interface.
- `@memory-lane/mcp-server` — local stdio MCP server exposing explicit Memory Lane tools.
- `@memory-lane/obsidian-mirror` — optional JSONL → generated Markdown mirror.
- `@memory-lane/obsidian-import` — standalone Markdown import parser/planner.
- `@memory-lane/claude-adapter` — Claude Code CLI hook adapter.
- `@memory-lane/codex-adapter` — OpenAI Codex CLI hook adapter.
- `@memory-lane/pi-adapter` — pi extension adapter.
- `@memory-lane/plugin-api` and `@memory-lane/plugin-obsidian-wiki` — plugin API and bundled Obsidian/Garden plugin.

## Integration semantics to preserve

- MCP server is explicit tool access, not lifecycle automation. It exposes memory save/suggest/recall/status/list/review/approve/reject/delete/get tools over local stdio and should not write diagnostics to stdout.
- Claude/Codex hooks support `session-start`, `user-prompt-submit`, `stop`, and `post-tool-use`; Claude also has confirmation-gated `session-end`. Hook debug logs remain privacy-safe.
- Pi supports explicit Memory Lane tools/commands plus low-noise lifecycle writes. Automatic pi `agent_end`, `session_shutdown`, or compaction summarization remains out of scope without a separate supported-event design.
- Project identity is `.memory-lane-scope` first, then Git common-dir identity, then no project scope/global fallback.
- Obsidian mirror/import remain explicit and JSONL remains the operational source of truth.

## Suggested next steps

1. Save a release checkpoint memory for `v0.2.37`.
2. Recommend declaring Phase 21 complete unless the user wants another evidence-backed follow-up.
3. If Phase 21 is complete, choose the next approved roadmap track through the normal planning/review gate before implementation.
