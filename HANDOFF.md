# Memory Lane Handoff

## Current state

- Branch context: no active product branch; this handoff tracks post-PR #125 state.
- PR #125 merged benchmark taxonomy and fixture manifest metadata as main commit `f08ba13`.
- PR #125 added test-only `benchmark: { ability, lane }` metadata to retrieval, conflict/update, prompt-routing, and lifecycle-injection eval fixtures, copied it into report results, and added shared metadata assertion helpers.
- PR #123 lifecycle-injection adversarial coverage, PR #120 prompt-routing adversarial coverage, PR #118 eval report contract unification, PR #116 adversarial retrieval benchmark hardening, and PR #105 conflict/update microbench expansion merged before PR #125.
- PR #104 removed internal `docs/` files from repository tracking, kept `docs/plugins/README.md` tracked as user-facing documentation, ignored the rest of on-disk `docs/`, and synced status docs.
- Latest known release: `v0.2.46` from main commit `cadd261`, after PR #99 fixed generated Pi pre-compact bridge session-summary behavior.
- Project-local storage defaults are implemented through Slice 2b: PR #80, PR #89, and PR #94 shipped the write default, legacy diagnostics, and review-first migration protocol.
- Continuity routing/context hygiene shipped in PR #82; duplicate continuity rendering hygiene shipped in PR #97.
- Generated Pi pre-compact bridge parity shipped in PR #99 and is no longer the next implementation slice.
- Internal feature specs, validation notes, and archived handoffs under `docs/` are intentionally removed from repository tracking.
- User-facing plugin documentation remains at `docs/plugins/README.md` and is linked from the main README.

## Current decision / next work

The current repo state is post-PR #125 cleanup on `main`.
There is no active implementation branch.

The recommended next product slice stays on the eval/benchmark track.
The next slice should be deterministic local long-session synthetic benchmark coverage from issue #113.
It should build bounded multi-session histories using existing Memory Lane engine and lifecycle surfaces, emit the unified eval report contract with taxonomy metadata from PR #125, and avoid network access, embeddings, LLM judges, and default CI wiring unless explicitly approved.

The project goal for evals is to improve Memory Lane behavior, not to add decorative scaffolding.
Each eval slice should state whether it ran deterministic fixtures, live Memory Lane store data, embeddings, synthetic long-session benchmarks, or external benchmarks.

## Load-bearing constraints

- For broad prior-work, project-status, or next-work questions, call Memory Lane continuity first and verify against compact repo state when available.
- At phase, slice, release, merge, or next-work boundaries, sync `ROADMAP.md` and `HANDOFF.md` before calling work complete.
- Keep `docs/plugins/README.md` tracked because it is user-facing and linked from `README.md`.
- Keep internal feature notes out of tracked `docs/` unless a future user decision explicitly reintroduces them.
- Use Fable 5 for explicit Fable 5 follow-up planning and code review with `claude --model claude-fable-5 -p '<review prompt>'`.
- Use Opus 4.8 for ordinary Memory Lane design/spec and pre-PR implementation reviews outside the Fable 5 wave with `claude --model claude-opus-4-8 -p '<review prompt>'`.
- PR-protected workflow applies: feature branch or worktree, PR, wait for user merge, sync main, delete feature branch, recommend next item.
- Avoid retrieval rewrites, auto-consolidation, silent deletion, schema expansion, raw transcript indexing, token retuning, public eval commands, production eval APIs, or persisted workstream IDs unless a new approved slice explicitly includes them.

## Current verification evidence

- PR #125 benchmark taxonomy verification passed targeted core eval tests, targeted lifecycle eval tests, all four eval runner commands, `pnpm --filter @memory-lane/core build`, `pnpm --filter @memory-lane/lifecycle build`, `git diff --check`, and CodeRabbit uncommitted review with 0 findings after the shared-helper nitpick follow-up.
- PR #125 merged as `f08ba13`; post-merge cleanup synced local `main`, deleted local and remote `eval/fixture-taxonomy`, and confirmed clean `main...origin/main` before this status-sync branch was created.
- PR #123 lifecycle-injection adversarial coverage verification passed `pnpm --filter @memory-lane/lifecycle exec node --test --import tsx test/lifecycle-injection-eval.test.ts` with 11 tests.
- PR #123 lifecycle-injection adversarial coverage verification passed `pnpm --filter @memory-lane/lifecycle eval:lifecycle-injection` with 12 scenarios, 12 passes, 0 failures, and `satisfactory: true`.
- PR #123 lifecycle-injection adversarial coverage verification passed `pnpm --filter @memory-lane/lifecycle build`, `git diff --check`, and CodeRabbit uncommitted review after one fixture nit was fixed.
- PR #123 merged as `1e28794`; post-merge cleanup synced local `main` and deleted local and remote `eval/lifecycle-injection-adversarial`.
- PR #116 adversarial retrieval benchmark hardening verification passed `pnpm --filter @memory-lane/core eval:retrieval`, `pnpm --filter @memory-lane/core eval:conflict-update`, targeted core eval tests, `pnpm --filter @memory-lane/core build`, and `git diff --check`.
- PR #116 merged as `5a291b8`; post-merge cleanup synced local `main`, deleted local and remote `eval/retrieval-adversarial-hardening`, and confirmed clean `main...origin/main`.
- PR #104 first pass verification: `pnpm build` passed.
- PR #104 first pass verification: `pnpm test` passed.
- PR #104 first pass verification: targeted CLI Pi dogfood tests passed from `packages/cli` with 122 tests.
- PR #104 first pass verification: installed-artifact generated Pi extension smoke passed from `packages/cli/dist/index.js`, called `memory-lane pi pre-compact --json --project <tmp-project>`, and returned without blocking compaction.
- PR #103 conflict/update recall eval baseline merged before this PR branch was created.
- PR #102 prompt-routing eval baseline merged before PR #103.
- PR #99 generated Pi pre-compact bridge parity released in `v0.2.46`; local pre-release verification passed `pnpm build`, `pnpm test`, and `git diff --check`.

## Key references

- Active roadmap/current direction: `ROADMAP.md`
- User-facing plugin documentation: `docs/plugins/README.md`
- Memory Lane skill guidance: `skills/memory-lane/SKILL.md`
- User-facing package documentation: `README.md`
- Latest release reference: `v0.2.46` / commit `cadd261`
- Current repo status: clean `main` after PR #125 cleanup; no active implementation branch before this status-sync branch.
- Latest deterministic eval baselines: PR #102, PR #103, PR #105, PR #116, PR #118, PR #120, PR #123, and PR #125.
