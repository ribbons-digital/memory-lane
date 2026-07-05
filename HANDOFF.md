# Memory Lane Handoff

## Current state

- Branch context: active implementation branch `eval/conflict-update-microbench`.
- PR #104 merged as `425fcac`, removed internal `docs/` files from repository tracking, kept `docs/plugins/README.md` tracked as user-facing documentation, ignored the rest of on-disk `docs/`, and synced status docs.
- Latest known release: `v0.2.46` from main commit `cadd261`, after PR #99 fixed generated Pi pre-compact bridge session-summary behavior.
- Project-local storage defaults are implemented through Slice 2b: PR #80, PR #89, and PR #94 shipped the write default, legacy diagnostics, and review-first migration protocol.
- Continuity routing/context hygiene shipped in PR #82; duplicate continuity rendering hygiene shipped in PR #97.
- Generated Pi pre-compact bridge parity shipped in PR #99 and is no longer the next implementation slice.
- Prompt-routing eval baseline merged in PR #102.
- Conflict/update recall eval baseline merged in PR #103.
- Conflict/update microbench expansion is in progress on `eval/conflict-update-microbench`.
- Internal feature specs, validation notes, and archived handoffs under `docs/` are intentionally removed from repository tracking.
- User-facing plugin documentation remains at `docs/plugins/README.md` and is linked from the main README.

## Current decision / next work

The active slice is conflict/update microbench expansion.
It is deterministic, local-fixture-only, and read-only unless a fixture exposes a real production recall bug.
Do not add LongMemEval, embeddings, LLM judges, production ranking rewrites, or auto-consolidation in this slice.

Current acceptance shape:

1. Conflict/update corpus includes same-id update coverage using duplicate raw record ids so folding must select the current version.
2. Conflict/update corpus includes explicit correction-record coverage.
3. Conflict/update corpus includes multiple-supersession-chain coverage.
4. Conflict/update corpus includes cross-scope false-premise coverage.
5. Conflict/update summary reports current-fact-first rate, false-premise safety rate, stale-fact leak rate, and superseded-memory leak rate.
6. Tests assert the same-id scenario returns the current folded text, not only the duplicate id.
7. Verification keeps semantic retrieval disabled and shows zero zero-tolerance failures.

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

- Conflict/update microbench expansion verification: `pnpm --filter @memory-lane/core eval:conflict-update` passed with 6 scenarios, 6 passes, `zeroToleranceFailures: 0`, `currentFactFirstRate: 1`, `falsePremiseSafetyRate: 1`, `staleFactLeakRate: 0`, and `supersededMemoryLeakRate: 0`.
- Conflict/update microbench expansion verification: `pnpm --filter @memory-lane/core test -- conflict-update-eval.test.ts` passed; because the package script uses the `test/*.test.ts` glob, it ran the core test suite with 396 passing tests.
- Conflict/update microbench expansion verification: `pnpm --filter @memory-lane/core build` passed.
- Conflict/update microbench expansion verification: `pnpm build` passed.
- Conflict/update microbench expansion verification: `git diff --check` passed.
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
- Current implementation branch: `eval/conflict-update-microbench`
- Latest deterministic eval baselines: PR #102 and PR #103, plus the active conflict/update microbench expansion branch.
