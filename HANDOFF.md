# Memory Lane Handoff

## Current state

- Branch context: `main` is synced through `bc02d04 feat(core): add structured memory descriptors (#72)`. Local and remote `docs/session-start-descriptor-slice-b` branches were cleaned up after merge.
- Latest release: `v0.2.40` at tag `v0.2.40` / commit `7578bb5`; release workflow `28419273491` passed and published 8 assets.
- Phase 21 `Handoff-Free Sessions` is complete and dogfooded. Fresh-thread prompt `where are we in the project and what should we work on next?` used about 11.8% context, improved from the previous 14.x% range.
- Docs/context-budget slice is merged: root `ROADMAP.md` is now a compact active index, historical roadmap detail through Phase 20.5 is archived, `HANDOFF.md` is a status card, and Memory Lane skill guidance emphasizes bounded reads.
- Retrieval/continuity eval baseline PR #70 merged as `7d5a8a6`; local/remote `feat/retrieval-continuity-eval-baseline` branches are cleaned up. The slice added a sanitized six-scenario corpus, test-only core eval helpers, structural tests, and baseline findings doc.
- SessionStart descriptor index Slice A PR #71 merged as `e0deba1`; local/remote `docs/session-start-descriptor-index` branches are cleaned up. The slice keeps SessionStart schema-free while replacing full-body baseline dumping with tiny always-on memories plus compact descriptor cards under existing char budgets.
- SessionStart descriptor metadata Slice B PR #72 merged as `bc02d04`; local/remote `docs/session-start-descriptor-slice-b` branches are cleaned up. The slice adds optional bounded descriptor metadata and uses it in SessionStart descriptor cards and exact-memory inspection.
- Slice B released in `v0.2.40` (`7578bb5`) and dogfooded through the installed artifact.

## Current decision / next work

Recent product track: **SessionStart descriptor index / context-budget follow-up**.

Slice A is merged and released. Slice B structured descriptor persistence is merged, released, and dogfooded.

Merged Slice B first vertical scope:

1. optional bounded `descriptor` metadata on `MemoryRecord` with `description`, `fetchHint`, and normalized lowercase `keywords`;
2. core save/suggest persistence, duplicate approved-upgrade semantics, and storage normalization validation;
3. preservation through approve/reject/delete/rescope, while replacement successors do not auto-copy stale descriptors;
4. SessionStart descriptor cards prefer structured descriptions and compact fetch hints, with fallback diagnostics updated;
5. exact `show/get` JSON naturally includes descriptors, and human exact show renders a compact descriptor section.

Deferred by design: CLI descriptor authoring flags, descriptor update/clear, Obsidian/YAML frontmatter, token policy changes, embeddings/retrieval changes, and LLM-generated descriptors.

Recommended next decision: decide between Slice C Obsidian/YAML frontmatter, Slice D token-aware policy refinement, pausing this track, or returning to Retrieval Quality / Continuity Evaluation. Do not start the next item until the user approves the direction.

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
- PR #70 merged as `7d5a8a6`; post-merge cleanup synced `main` and deleted local/remote `feat/retrieval-continuity-eval-baseline` branches.
- PR #71 verification before merge: `pnpm --filter @memory-lane/lifecycle test`, `pnpm --filter @memory-lane/cli test`, `pnpm test`, `pnpm build`, `git diff --check`; Opus 4.8 final re-review reported no blockers.
- PR #71 merged as `e0deba1`; post-merge cleanup synced `main` and deleted local/remote `docs/session-start-descriptor-index` branches.
- `v0.2.39` release workflow `28410566489` passed and published 8 assets; installed `memory-lane upgrade --yes` passed and reconfigured Pi.
- Installed SessionStart dogfood passed: real-project `memory-lane codex session-start` emitted 1494 chars under the 1600-char budget, used `## Always-on Memory` plus `## Memory Index`, included fetch guidance, and omitted old `## Relevant Memory`. Isolated fixture proved 8 descriptor cards in 1302 chars with no full-body dump. Policy-only/off and fetch-by-id smokes passed.
- Slice B local verification passed: `pnpm --filter @memory-lane/core test`, `pnpm --filter @memory-lane/lifecycle test`, `pnpm --filter @memory-lane/cli test`, `pnpm build`, `pnpm test`, and `git diff --check`.
- Slice B no-mistakes/PR validation before merge: Opus 4.8 implementation review found no blockers; no-mistakes review found and fixed secret-like keyword pre-normalization and fallback-count-after-trim issues; CodeRabbit inline keyword-limit feedback was fixed by applying the keyword item cap after normalization/deduplication; GitHub PR checks passed (`test` and CodeRabbit). PR #72 merged as `bc02d04`.
- `v0.2.40` release workflow `28419273491` passed and published 8 assets; installed `memory-lane upgrade --yes` passed and reconfigured Pi.
- Installed Slice B dogfood passed: exact human and JSON `show` exposed descriptor metadata, released `memory-lane codex session-start` rendered structured descriptor summaries plus fetch hints, full descriptor-card bodies stayed out of SessionStart, and generated fallback descriptors still worked. Validation: `docs/superpowers/validation/2026-06-30-session-start-descriptor-metadata-dogfood.md`.

## Key references

- Active roadmap/current direction: `ROADMAP.md`
- Historical roadmap archive through Phase 20.5: `docs/superpowers/archive/roadmap-through-phase-20-5.md`
- Full old handoff chronology: `docs/superpowers/archive/2026-06-26-pre-docs-hygiene-handoff.md`
- Docs/context-budget design: `docs/superpowers/specs/2026-06-27-docs-context-budget-design.md`
- Retrieval/continuity eval baseline design: `docs/superpowers/specs/2026-06-27-retrieval-continuity-eval-baseline-design.md`
- Retrieval/continuity eval baseline findings: `docs/superpowers/validation/2026-06-27-retrieval-continuity-eval-baseline.md`
- SessionStart descriptor index design: `docs/superpowers/specs/2026-06-30-session-start-descriptor-index-design.md`
- SessionStart descriptor metadata Slice B design: `docs/superpowers/specs/2026-06-30-session-start-descriptor-metadata-design.md`
- SessionStart descriptor index release/dogfood validation: `docs/superpowers/validation/2026-06-30-session-start-descriptor-index-dogfood.md`
- SessionStart descriptor metadata release/dogfood validation: `docs/superpowers/validation/2026-06-30-session-start-descriptor-metadata-dogfood.md`
- Memory Lane skill guidance: `skills/memory-lane/SKILL.md`
- User-facing package docs: `README.md`
