# Memory Lane Handoff

## Current state

- Branch context: `main` is synced through `4ebf447 docs: reduce roadmap context budget (#69)`.
- Latest release: `v0.2.37` at tag/commit `6d234c3`; release workflow `28275316878` passed and published 8 assets.
- Phase 21 `Handoff-Free Sessions` is complete and dogfooded. Fresh-thread prompt `where are we in the project and what should we work on next?` used about 11.8% context, improved from the previous 14.x% range.
- Docs/context-budget slice is merged: root `ROADMAP.md` is now a compact active index, historical roadmap detail through Phase 20.5 is archived, `HANDOFF.md` is a status card, and Memory Lane skill guidance emphasizes bounded reads.

## Current decision / next work

Recommended product track: **Retrieval Quality / Continuity Evaluation**.

1. build a small reproducible eval corpus from real dogfooded Memory Lane records;
2. add labeled continuity/recall queries;
3. measure current recall@k, precision@k, and failure cases;
4. write findings before changing retrieval/ranking.

## Load-bearing constraints

- For broad prior-work/project-status/next-work questions, call Memory Lane continuity first and verify against compact repo state when available.
- At phase/slice completion, release, merge, or next-work recommendation, sync status docs before calling work complete.
- Use Opus 4.8 for Memory Lane design/spec and pre-PR implementation reviews with: `claude --model claude-opus-4-8 -p '<review prompt>'`.
- PR-protected workflow applies: feature branch/worktree → PR → wait for user merge → sync main/delete feature branch/recommend next item.
- Avoid retrieval rewrites, auto-consolidation, silent deletion, schema expansion, raw transcript indexing, token retuning, or persisted workstream IDs unless a new approved slice explicitly includes them.

## Current verification evidence

- `v0.2.37` release workflow passed; installed upgrade via `memory-lane upgrade --yes` passed and reconfigured Pi.
- Installed broad next-work continuity returned latest progress, empty workstream candidates, and `no-topic`.
- Installed operating guidance excluded stale release/checkpoint ids `1098781c`, `7eab3ad9`, and `0b56ed5d`.
- Installed topic-specific continuity query still returned workstream candidates.
- Phase 21 completion checkpoint memory: `2e8348f6`.
- PR #69 merged as `4ebf447`; local/remote `docs/context-budget` branches were cleaned up.

## Key references

- Active roadmap/current direction: `ROADMAP.md`
- Historical roadmap archive through Phase 20.5: `docs/superpowers/archive/roadmap-through-phase-20-5.md`
- Full old handoff chronology: `docs/superpowers/archive/2026-06-26-pre-docs-hygiene-handoff.md`
- Docs/context-budget design: `docs/superpowers/specs/2026-06-27-docs-context-budget-design.md`
- Memory Lane skill guidance: `skills/memory-lane/SKILL.md`
- User-facing package docs: `README.md`
