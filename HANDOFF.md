# Memory Lane Handoff

## Current state

- Branch context: active design branch `eval/external-benchmark-design`; this handoff tracks issue #114 design capture after PR #128.
- PR #127 merged deterministic local long-session synthetic benchmark coverage as main commit `c8c65ea`.
- PR #127 added `pnpm --filter @memory-lane/lifecycle eval:long-session-synthetic`.
- PR #127 added a stable local JSON report with benchmark taxonomy metadata, temp-only MemoryEngine stores, and coverage for temporal currentness, repeated knowledge updates, multi-session continuity, false-premise abstention, cross-scope safety, and bounded long context.
- PR #125 merged benchmark taxonomy and fixture manifest metadata as main commit `f08ba13`.
- PR #123 lifecycle-injection adversarial coverage, PR #120 prompt-routing adversarial coverage, PR #118 eval report contract unification, PR #116 adversarial retrieval benchmark hardening, and PR #105 conflict/update microbench expansion merged before PR #125.
- PR #104 removed internal `docs/` files from repository tracking, kept `docs/plugins/README.md` tracked as user-facing documentation, ignored the rest of on-disk `docs/`, and synced status docs.
- Latest known release: `v0.2.46` from main commit `cadd261`, after PR #99 fixed generated Pi pre-compact bridge session-summary behavior.
- Project-local storage defaults are implemented through Slice 2b: PR #80, PR #89, and PR #94 shipped the write default, legacy diagnostics, and review-first migration protocol.
- Continuity routing/context hygiene shipped in PR #82; duplicate continuity rendering hygiene shipped in PR #97.
- Internal feature specs, validation notes, and archived handoffs under `docs/` are intentionally removed from repository tracking.

## Current decision / next work

The current repo state is issue #114 design capture on branch `eval/external-benchmark-design`.
The design is captured in issue #114 comment `https://github.com/ribbons-digital/memory-lane/issues/114#issuecomment-4888147243`.

The recommended next product action is to review and merge the issue #114 design capture PR once opened.
After that, the next eval/benchmark implementation slice should be a separately approved external benchmark adapter implementation issue.
That implementation issue should stay retrieval/read-model-first unless a new design decision explicitly approves lifecycle injection plus answer generation.
It should keep LongMemEval ingestion details, embeddings, LLM judges, network-dependent runners, external datasets, and production behavior changes out of scope until explicitly approved.

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

- Issue #114 design capture posted to GitHub issue comment `https://github.com/ribbons-digital/memory-lane/issues/114#issuecomment-4888147243`.
  The design selects a retrieval/read-model-first external benchmark adapter, optional manual runner mode, local dataset path only, deterministic retrieval/session-id metrics, no default CI, no model judge, no auto-download, no committed dataset, and no production behavior changes.
- PR #127 long-session synthetic benchmark verification passed `pnpm --filter @memory-lane/lifecycle exec node --test --import tsx test/long-session-synthetic-eval.test.ts` with 13 tests, `pnpm --filter @memory-lane/lifecycle eval:long-session-synthetic` with 6 scenarios, 7 steps, and `satisfactory: true`, `pnpm --filter @memory-lane/lifecycle build`, staged whitespace checks, and Opus 4.8 implementation re-review with no blockers or should-fix items.
- PR #127 merged as `c8c65ea`; post-merge cleanup synced local `main`, deleted local and remote `eval/long-session-synthetic`, and opened a status-sync branch.
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
