# Memory Lane Handoff

## Current state

- Branch context: clean `main...origin/main` after PR #167 merged issue #141 as main commit `89b0fa8`.
- PR #167 fixed interactive Codex Desktop init with normal TOML config, partial-error reporting for failed selected integrations, and non-zero init exit status on selected integration failure.
- PR #167 used Blaze quickfix mode with Fable 5 implementation review.
- no-mistakes was not run for PR #167 because quickfix mode skips it by default.
- PR #164 synced status docs after PR #163.
- PR #132 merged release version metadata fixes and docs for Windows upgrade behavior.
- PR #131 synced long-memory smoke adapter status docs after PR #130.
- PR #130 merged optional external long-memory smoke adapter coverage as main commit `950a71e`.
- PR #129 merged issue #114 external benchmark adapter design as main commit `bef9230`.
- PR #127 merged deterministic local long-session synthetic benchmark coverage as main commit `c8c65ea`.
- PR #127 added `pnpm --filter @memory-lane/lifecycle eval:long-session-synthetic`.
- PR #125 merged benchmark taxonomy and fixture manifest metadata as main commit `f08ba13`.
- PR #104 removed internal `docs/` files from repository tracking, kept `docs/plugins/README.md` tracked as user-facing documentation, ignored the rest of on-disk `docs/`, and synced status docs.
- Project-local storage defaults are implemented through Slice 2b: PR #80, PR #89, and PR #94 shipped the write default, legacy diagnostics, and review-first migration protocol.
- Continuity routing/context hygiene shipped in PR #82; duplicate continuity rendering hygiene shipped in PR #97.
- Internal feature specs, validation notes, and archived handoffs under `docs/` are intentionally removed from repository tracking.

## Current decision / next work

The current repo state is post-PR #167 on clean `main`.
PR #167 fixed issue #141 so interactive Codex Desktop init no longer parses normal `~/.codex/config.toml` as JSON.
Failed selected init integrations now print a partial-error banner and exit non-zero, while user-declined overwrite skips remain non-fatal through a structured skip flag.
PR #167 used Fable 5 for implementation review and Blaze quickfix mode.
no-mistakes was not run for PR #167 because quickfix mode skips it by default.
The latest release remains `v0.2.47`.
The release workflow for tag `v0.2.47` passed as GitHub Actions run `28768281598`.
Released asset `memory-lane-darwin-arm64.tar.gz` was downloaded from GitHub Releases, extracted, and verified with `status --json` reporting `meta.version: "0.2.47"`.

Issue #115 is closed with comment `Closed by PR #130, main commit 950a71e.`
The issue #115 adapter added `pnpm --filter @memory-lane/core eval:long-memory-smoke -- --dataset <path>`.
It requires a local dataset path by `--dataset` or `MEMORY_LANE_LONG_MEMORY_SMOKE_DATASET`, does not auto-download data, and reports `networkRequired: false`, `modelRequired: false`, and `judgeRequired: false`.
It supports a tiny LongMemEval-compatible smoke subset using `question_id`, `haystack_session_ids`, `haystack_sessions`, `haystack_dates`, `answer_session_ids`, and `_abs` abstention records.
It evaluates deterministic retrieval session-id recall only, maps categories back to the test-only benchmark taxonomy, skips abstention records into `abstentionResults`, writes only temp MemoryEngine stores, and leaves production retrieval and lifecycle code unchanged.
no-mistakes fixed three review findings before PR #130 merged: preserve haystack dates, make temporal smoke records exercise currentness, and size temporary retrieval `topK` to requested `k`.
The project goal for evals is to improve Memory Lane behavior, not to add decorative scaffolding.
Each eval slice should state whether it ran deterministic fixtures, live Memory Lane store data, embeddings, synthetic long-session benchmarks, or external benchmarks.

## Load-bearing constraints

- For broad prior-work, project-status, or next-work questions, call Memory Lane continuity first and verify against compact repo state when available.
- At phase, slice, release, merge, or next-work boundaries, sync `ROADMAP.md` and `HANDOFF.md` before calling work complete.
- Keep `docs/plugins/README.md` tracked because it is user-facing and linked from `README.md`.
- Keep internal feature notes out of tracked `docs/` unless a future user decision explicitly reintroduces them.
- Use Fable 5 for explicit Fable 5 follow-up planning and code review with `claude --model claude-fable-5 -p '<review prompt>'`.
- Use Opus 4.8 with `claude --model claude-opus-4-8 -p '<review prompt>'` for ordinary Memory Lane design/spec and pre-PR implementation reviews unless Fable 5 is mentioned or specified.
- PR-protected workflow applies: feature branch or worktree, PR, wait for user merge, sync main, delete feature branch, recommend next item.
- Avoid retrieval rewrites, auto-consolidation, silent deletion, schema expansion, raw transcript indexing, token retuning, public eval commands, production eval APIs, or persisted workstream IDs unless a new approved slice explicitly includes them.

## Current verification evidence

- PR #161 verification passed `pnpm --filter @memory-lane/core build && pnpm --filter @memory-lane/cli build`, `pnpm --filter @memory-lane/core exec node --test --import tsx test/config.test.ts`, `pnpm --filter @memory-lane/cli exec node --test --import tsx test/cli.test.ts`, isolated original issue reproduction with temp storage, `pnpm build`, `pnpm test`, and `git diff --check`.
- PR #161 used Fable 5 for diagnosis and implementation review.
- PR #161 used the Blaze fallback PR path because no-mistakes could not start for the branch with `error: "no run started for \"fix/config-set-validation-137\": no previous run for branch fix/config-set-validation-137"`.
- PR #163 verification passed focused detector, engine, Claude runner, Codex runner, and CLI tests; post-fix CLI reproduction saved `Deploy from branch release/JIRA-2024-blueGreenRollout-phase3`; `pnpm build`, `pnpm test`, and `git diff --check` passed.
- PR #163 used Fable 5 for diagnosis and implementation review because the user explicitly requested Fable 5 review.
- PR #163 used the Blaze fallback PR path because no-mistakes could not start for `fix/secret-detector-138` after gate-remote push and quick-start consultation.
- PR #167 verification passed `pnpm --filter @memory-lane/cli build`, `node --test --import tsx packages/cli/test/init.test.ts` with 32 tests and 0 failures, `HOME=<temp-home> pnpm --filter @memory-lane/cli test` with 191 tests and 0 failures, and `git diff --check`.
- PR #167 used Fable 5 for implementation review and returned approve with no blockers.
- PR #167 ran in Blaze quickfix mode and skipped no-mistakes by quickfix mode.
- PR #165 verification passed `pnpm --filter @memory-lane/cli build`, `pnpm --filter @memory-lane/cli test` with 187 tests and 0 failures, manual `--version`, `-v`, and `version` smoke checks with `MEMORY_LANE_VERSION=v1.2.3`, and `git diff --check`.
- PR #165 used Opus 4.8 for implementation review and returned PASS.
- Release `v0.2.47` pre-release verification passed `pnpm build`, `pnpm test`, `git diff --check`, `MEMORY_LANE_VERSION=v0.2.47 pnpm build:binary`, and `pnpm smoke:binary`.
- GitHub Actions release run `28768281598` passed for tag `v0.2.47`, including build, tests, binary build, current-platform binary smoke, release notes, and release creation.
- Released `memory-lane-darwin-arm64.tar.gz` asset was downloaded and extracted; `status --json` reported `meta.version: "0.2.47"`.
- PR #132 no-mistakes gate reached `outcome: checks-passed` with no findings after review-comment fixes.
- PR #130 no-mistakes gate reached `outcome: checks-passed`, opened PR #130, and CI passed before merge.
- PR #130 no-mistakes review fixed three findings: preserve LongMemEval haystack dates, exercise temporal smoke currentness dates, and fix smoke recall `topK` sizing.
- PR #130 test evidence included `pnpm --filter @memory-lane/core exec node --test --import tsx test/external-long-memory-smoke.test.ts`, a manual `eval:long-memory-smoke` run against a LongMemEval-compatible fixture, an explicit missing-dataset failure check, and `pnpm --filter @memory-lane/core test`.
- Issue #115 closed with comment `Closed by PR #130, main commit 950a71e.`
- Issue #114 design capture posted to GitHub issue comment `https://github.com/ribbons-digital/memory-lane/issues/114#issuecomment-4888147243`.
  The design selects a retrieval/read-model-first external benchmark adapter, optional manual runner mode, local dataset path only, deterministic retrieval/session-id metrics, no default CI, no model judge, no auto-download, no committed dataset, and no production behavior changes.
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
- Latest release reference: `v0.2.47` / commit `28e5961`.
- Current repo status: post-PR #167 on clean `main...origin/main`.
- Latest deterministic eval baselines: PR #102, PR #103, PR #105, PR #116, PR #118, PR #120, PR #123, PR #125, PR #127, and PR #130.
