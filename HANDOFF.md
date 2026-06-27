# Memory Lane Handoff

## Current state

- Branch context: `main` is synced through `9cb921e docs: sync v0.2.38 release status`.
- Latest release: `v0.2.38` at tag/commit `3576417`; release workflow `28276304985` passed and published 8 assets.
- Phase 21 `Handoff-Free Sessions` is complete and dogfooded. Fresh-thread prompt `where are we in the project and what should we work on next?` used about 11.8% context, improved from the previous 14.x% range.
- Docs/context-budget slice is merged: root `ROADMAP.md` is now a compact active index, historical roadmap detail through Phase 20.5 is archived, `HANDOFF.md` is a status card, and Memory Lane skill guidance emphasizes bounded reads.
- Retrieval/continuity eval baseline is implemented on `feat/retrieval-continuity-eval-baseline`: sanitized six-scenario corpus, test-only core eval helpers, structural tests, and baseline findings doc.

## Current decision / next work

Active product track: **Retrieval Quality / Continuity Evaluation**.

Current slice is ready for implementation review and PR.

Implemented scope:

1. sanitized six-scenario eval corpus for continuity and explicit recall lanes;
2. test-only eval helpers and structural core tests in `packages/core/test/retrieval-continuity-eval.test.ts`;
3. baseline recall@k, precision@k, continuity slot correctness, and failure cases;
4. findings in `docs/superpowers/validation/2026-06-27-retrieval-continuity-eval-baseline.md` before any retrieval/ranking change.

## Load-bearing constraints

- For broad prior-work/project-status/next-work questions, call Memory Lane continuity first and verify against compact repo state when available.
- At phase/slice completion, release, merge, or next-work recommendation, sync status docs before calling work complete.
- Use Opus 4.8 for Memory Lane design/spec and pre-PR implementation reviews with: `claude --model claude-opus-4-8 -p '<review prompt>'`.
- PR-protected workflow applies: feature branch/worktree → PR → wait for user merge → sync main/delete feature branch/recommend next item.
- Avoid retrieval rewrites, auto-consolidation, silent deletion, schema expansion, raw transcript indexing, token retuning, public eval commands, production eval APIs, or persisted workstream IDs unless a new approved slice explicitly includes them.

## Current verification evidence

- `v0.2.37` release workflow passed; installed upgrade via `memory-lane upgrade --yes` passed and reconfigured Pi.
- Installed broad next-work continuity returned latest progress, empty workstream candidates, and `no-topic`.
- Installed operating guidance excluded stale release/checkpoint ids `1098781c`, `7eab3ad9`, and `0b56ed5d`.
- Installed topic-specific continuity query still returned workstream candidates.
- Phase 21 completion checkpoint memory: `2e8348f6`.
- PR #69 merged as `4ebf447`; local/remote `docs/context-budget` branches were cleaned up.
- `v0.2.38` release completed; installed upgrade via `memory-lane upgrade --yes` passed and reconfigured Pi.
- Retrieval/continuity eval baseline design passed `git diff --check`; Opus 4.8 re-review said no outstanding required changes remain and the spec is ready for user approval; user approved it.
- Narrow eval test passed: `node --test --import tsx packages/core/test/retrieval-continuity-eval.test.ts`.
- Core package test passed via `pnpm --filter @memory-lane/core test -- retrieval-continuity-eval.test.ts`; note the package script ran the full core suite (304 tests) rather than narrowing to the filename.
- Full workspace test passed via `pnpm test`.
- `git diff --check` passed.
- Opus 4.8 pre-PR implementation review and final re-review found no correctness or scope blockers after baseline precision docs were corrected; final note was operational: commit files before PR.

## Key references

- Active roadmap/current direction: `ROADMAP.md`
- Historical roadmap archive through Phase 20.5: `docs/superpowers/archive/roadmap-through-phase-20-5.md`
- Full old handoff chronology: `docs/superpowers/archive/2026-06-26-pre-docs-hygiene-handoff.md`
- Docs/context-budget design: `docs/superpowers/specs/2026-06-27-docs-context-budget-design.md`
- Retrieval/continuity eval baseline design: `docs/superpowers/specs/2026-06-27-retrieval-continuity-eval-baseline-design.md`
- Retrieval/continuity eval baseline findings: `docs/superpowers/validation/2026-06-27-retrieval-continuity-eval-baseline.md`
- Memory Lane skill guidance: `skills/memory-lane/SKILL.md`
- User-facing package docs: `README.md`
